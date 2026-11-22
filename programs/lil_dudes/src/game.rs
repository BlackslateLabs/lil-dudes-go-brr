//! Shared game plumbing: sim state in and out of the accounts, catch-up, gotcha records, the
//! Peek view, payout.
use crate::errors::GameError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use lil_dudes_sim::codec::{decode_public, decode_secret, encode_public, encode_secret};
use lil_dudes_sim::{
    step, Event, EventSink, Inputs, MatchResult, MatchState, PublicState, LANE_WIDTH, MATCH_TICKS,
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

/// The state shown before the seed exists: cannons centred, nothing loaded (the layout comes
/// from the seed), both sides empty (`PublicSide::EMPTY`).
pub fn pre_match_public(stake: u64) -> PublicState {
    let mut p = MatchState::zeroed().public;
    p.options.stake = stake;
    for s in p.sides.iter_mut() {
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
            slot,
            rigged_by,
        } = event
        {
            if let Some(g) = self.gotcha.get_mut(usize::from(side)) {
                let [lo, hi] = u16::try_from(self.tick).unwrap_or(NO_TICK).to_le_bytes();
                *g = [lo, hi, slot, rigged_by];
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

/// Rewrites `side`'s Peek from the sim's private view of its current stage (the Peek layout in
/// state.rs). Cheap: no decoding, a few bytes.
pub fn write_peek(m: &MatchState, side: u8, p: &mut Peek) {
    let v = m.private_view(side);
    p.stage = v.stage;
    (p.rig_stage, p.rig_slot) = v.rig.map_or((NONE, NONE), |r| (r.stage, r.slot));
    (p.peek_stage, p.peek_slot, p.peek_op) = v
        .peek
        .map_or((NONE, NONE, 0), |pk| (v.stage, pk.slot, pk.op.to_byte()));
    p._pad = 0;
}

/// What each side and the treasury get out of the vault (SPEC §8). The vault holds 2S.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Split {
    pub to: [u64; 2],
    pub fee: u64,
}

pub fn split(stake: u64, result: Option<MatchResult>) -> Split {
    match result.and_then(|r| r.winner.map(|w| (w, r))) {
        // Draw (equal gold, or both died on the same tick), abort (no result): everyone gets
        // their stake back.
        None => Split {
            to: [stake, stake],
            fee: 0,
        },
        Some((w, r)) => {
            // payout() guarantees fee ≤ moved ≤ stake (moved = S on a death, else the gold
            // ratio's share above S).
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
        let deaths = [[false, true], [true, false], [true, true]];
        let golds = [
            [900, 600],
            [650, 700],
            [1, 0],
            [0, 0],
            [5, 5],
            [u32::MAX, 1],
        ];
        for stake in [0u64, 1, 50_000_000, 100_000_000, 250_000_000] {
            for dead in deaths.iter().chain([[false, false]].iter()) {
                for gold in golds {
                    let r = payout(stake, *dead, gold);
                    let s = split(stake, Some(r));
                    let ctx = format!("{stake} {dead:?} {gold:?}");
                    assert_eq!(s.to[0] + s.to[1] + s.fee, 2 * stake, "{ctx}");
                    if let Some(w) = r.winner {
                        assert!(s.to[usize::from(w)] >= stake, "{ctx}");
                    }
                    if r.ko && r.winner.is_some() {
                        // SPEC §8: a death moves the loser's whole stake.
                        let w = usize::from(r.winner.unwrap_or(0));
                        assert_eq!(s.to[w] + s.fee, 2 * stake, "{ctx}");
                        assert_eq!(s.to[1 - w], 0, "{ctx}");
                    }
                }
            }
            let abort = split(stake, None);
            assert_eq!(abort.to, [stake, stake]);
        }
    }

    #[test]
    fn peek_mirrors_the_private_view() {
        use lil_dudes_sim::{MatchOptions, Peek as SimPeek, Rig};
        let mut m = MatchState::new(5, MatchOptions::default());
        let mut p = Peek {
            id: 1,
            owner: Pubkey::default(),
            side: 0,
            stage: NONE,
            rig_stage: NONE,
            rig_slot: NONE,
            peek_stage: NONE,
            peek_slot: NONE,
            peek_op: 0,
            _pad: 0,
        };
        write_peek(&m, 0, &mut p);
        assert_eq!(
            [
                p.stage,
                p.rig_stage,
                p.rig_slot,
                p.peek_stage,
                p.peek_slot,
                p.peek_op
            ],
            [0, NONE, NONE, NONE, NONE, 0]
        );
        m.public.sides[0].stage = 1;
        m.secret.history[1].rigs[0] = Some(Rig { stage: 2, slot: 3 });
        m.secret.history[1].peeks[0] = Some(SimPeek {
            slot: 4,
            op: lil_dudes_sim::GateOp::Div(2),
        });
        write_peek(&m, 0, &mut p);
        assert_eq!(
            [
                p.stage,
                p.rig_stage,
                p.rig_slot,
                p.peek_stage,
                p.peek_slot,
                p.peek_op
            ],
            [1, 2, 3, 1, 4, 0x82]
        );
        // Side 1 did nothing in its stage 0.
        write_peek(&m, 1, &mut p);
        assert_eq!([p.stage, p.rig_stage, p.peek_stage], [0, NONE, NONE]);
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
