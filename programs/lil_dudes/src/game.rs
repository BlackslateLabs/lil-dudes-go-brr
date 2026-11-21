//! Shared game plumbing: sim state in and out of the accounts, catch-up, gotcha records, payout.
use crate::errors::GameError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use lil_dudes_sim::codec::{decode_public, decode_secret, encode_public, encode_secret};
use lil_dudes_sim::state::phase_at;
use lil_dudes_sim::{
    step, Event, EventSink, Inputs, MatchResult, MatchState, PublicState, HP_MAX, LANE_WIDTH,
    MATCH_TICKS,
};

/// Decodes both parts into a fresh state (cheap: `zeroed` builds nothing).
pub fn load(game: &Match, secrets: &Secrets) -> MatchState {
    let mut m = MatchState::zeroed();
    decode_public(&game.state, &mut m.public);
    decode_secret(&secrets.state, &mut m.secret);
    m
}

pub fn store(m: &MatchState, game: &mut Match, secrets: &mut Secrets) {
    encode_public(&m.public, &mut game.state);
    encode_secret(&m.secret, &mut secrets.state);
}

/// The state shown before the seed exists: full HP, cannons centred, nothing dealt.
pub fn pre_match_public(stake: u64) -> PublicState {
    let mut p = MatchState::zeroed().public;
    p.options.stake = stake;
    for s in p.sides.iter_mut() {
        s.hp = HP_MAX;
        s.cannon_x = (LANE_WIDTH / 2) as i16;
        s.aim = s.cannon_x;
    }
    p.next_cohort_id = 1;
    p
}

/// The tick the slot clock says the match should be at.
pub fn target_tick(game: &Match, slot: u64) -> u32 {
    let t = slot.saturating_sub(game.start_slot) / SLOTS_PER_TICK;
    u32::try_from(t.min(u64::from(MATCH_TICKS))).unwrap_or(MATCH_TICKS)
}

/// Records sprung rigs into the public Match header (events are otherwise dropped on-chain).
struct ChainEvents<'a> {
    tick: u32,
    gotcha: &'a mut [[u8; 4]; 2],
}

impl EventSink for ChainEvents<'_> {
    fn push(&mut self, event: Event) {
        if let Event::Gotcha {
            side,
            cell,
            rigged_by,
        } = event
        {
            if let Some(g) = self.gotcha.get_mut(usize::from(side)) {
                let [lo, hi] = u16::try_from(self.tick).unwrap_or(NO_TICK).to_le_bytes();
                *g = [lo, hi, cell, rigged_by];
            }
        }
    }
}

/// TECH §4 idempotent catch-up: steps `m` from its tick toward the slot clock, at most `cap`
/// ticks. Returns how many ticks ran. No-op before start or after the end.
pub fn catch_up(m: &mut MatchState, game: &mut Match, slot: u64, cap: u32) -> u32 {
    if game.status != status::PLAYING || game.start_slot == 0 {
        return 0;
    }
    let target = target_tick(game, slot);
    let mut ev = ChainEvents {
        tick: 0,
        gotcha: &mut game.gotcha,
    };
    let mut steps = 0u32;
    while m.public.tick < target && steps < cap && m.public.result.is_none() {
        ev.tick = m.public.tick;
        step(m, &Inputs::default(), &mut ev);
        steps = steps.saturating_add(1);
    }
    steps
}

pub fn phase_now(m: &MatchState) -> u8 {
    phase_at(m.public.tick)
}

/// What each side and the treasury get out of the vault (SPEC §7). The vault holds 2S.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Split {
    pub to: [u64; 2],
    pub fee: u64,
}

pub fn split(stake: u64, result: Option<MatchResult>) -> Split {
    match result.and_then(|r| r.winner.map(|w| (w, r))) {
        // Draw, abort (no result): everyone gets their stake back.
        None => Split {
            to: [stake, stake],
            fee: 0,
        },
        Some((w, r)) => {
            // payout() guarantees fee ≤ moved ≤ stake.
            let moved = r.moved.min(stake);
            let fee = r.fee.min(moved);
            let win = stake.saturating_add(moved).saturating_sub(fee);
            let lose = stake.saturating_sub(moved);
            let to = if w == 0 { [win, lose] } else { [lose, win] };
            Split { to, fee }
        }
    }
}

/// The result recorded in a (final) Match, `None` for a draw or an abort.
pub fn final_result(game: &Match) -> Option<MatchResult> {
    if game.has(flags::ABORTED) {
        return None;
    }
    let mut p = MatchState::zeroed().public;
    decode_public(&game.state, &mut p);
    p.result
}

/// Pays the split out of the vault, then sweeps anything left to the treasury.
#[allow(clippy::too_many_arguments)]
pub fn pay_out<'info>(
    game: &Match,
    vault: &AccountInfo<'info>,
    player0: &AccountInfo<'info>,
    player1: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    require_keys_eq!(player0.key(), game.players[0], GameError::WrongRecipient);
    require_keys_eq!(player1.key(), game.players[1], GameError::WrongRecipient);
    require_keys_eq!(treasury.key(), game.treasury, GameError::WrongRecipient);
    let total = game.stake.saturating_mul(2);
    if total == 0 {
        return Ok(());
    }
    // The drained vault is the idempotency guard (the Magic Action can't write the Match).
    require!(vault.lamports() >= total, GameError::AlreadySettled);
    let s = split(game.stake, final_result(game));
    let id = game.id.to_le_bytes();
    let seeds: &[&[u8]] = &[VAULT_SEED, &id, &[game.vault_bump]];
    for (to, amount) in [(player0, s.to[0]), (player1, s.to[1]), (treasury, s.fee)] {
        vault_send(vault, to, amount, seeds, system_program)?;
    }
    let rest = vault.lamports();
    vault_send(vault, treasury, rest, seeds, system_program)
}

pub fn vault_send<'info>(
    vault: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
    seeds: &[&[u8]],
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer {
                from: vault.clone(),
                to: to.clone(),
            },
            &[seeds],
        ),
        amount,
    )
}

pub fn pay<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    transfer(
        CpiContext::new(
            system_program.key(),
            Transfer {
                from: from.clone(),
                to: to.clone(),
            },
        ),
        amount,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use lil_dudes_sim::payout;

    #[test]
    fn split_conserves_the_vault() {
        for stake in [0u64, 1, 50_000_000, 100_000_000, 250_000_000] {
            for hp in [[2200, 0], [0, 1], [1320, 880], [1078, 1122], [5, 5], [0, 0]] {
                let r = payout(stake, hp);
                let s = split(stake, Some(r));
                assert_eq!(s.to[0] + s.to[1] + s.fee, 2 * stake, "{stake} {hp:?}");
                if let Some(w) = r.winner {
                    assert!(s.to[usize::from(w)] >= stake);
                }
            }
            let abort = split(stake, None);
            assert_eq!(abort.to, [stake, stake]);
        }
    }

    #[test]
    fn task_ids_are_positive_and_distinct() {
        let ids: Vec<i64> = (0..1000u64).map(task_id).collect();
        assert!(ids.iter().all(|&t| t > 0));
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), ids.len());
    }
}
