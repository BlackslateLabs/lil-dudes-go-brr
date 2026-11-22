//! `bench` (feature "bench" only, never deployed): decode → n ticks → encode on a raw account
//! holding `public ‖ secret` codec bytes, logging compute units between the phases. Used by
//! tests-magicsvm/tests/bench.rs to measure the codec and the tick (TECH §4 compute budget).
use anchor_lang::prelude::*;
use lil_dudes_sim::codec::{decode_public, decode_secret, encode_public, encode_secret};
use lil_dudes_sim::rng::mix64;
use lil_dudes_sim::{step, Inputs, MatchState, NoEvents, Warlord, PUBLIC_LEN, SECRET_LEN};

#[derive(Accounts)]
pub struct Bench<'info> {
    /// CHECK: raw bench bytes, set up by the test harness.
    #[account(mut)]
    pub state: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<Bench>, n: u16, with_bot: bool) -> Result<()> {
    let mut data = ctx.accounts.state.try_borrow_mut_data()?;
    let (p, rest) = data.split_at_mut(PUBLIC_LEN);
    let p: &mut [u8; PUBLIC_LEN] = p.try_into().map_err(|_| ProgramError::InvalidAccountData)?;
    let s: &mut [u8; SECRET_LEN] = rest
        .get_mut(..SECRET_LEN)
        .and_then(|s| s.try_into().ok())
        .ok_or(ProgramError::InvalidAccountData)?;
    log_cu();
    let mut m = MatchState::zeroed();
    log_cu();
    decode_public(p, &mut m.public);
    log_cu();
    decode_secret(s, &mut m.secret);
    log_cu();
    for _ in 0..n {
        let inputs = if with_bot {
            let t = u64::from(m.public.tick);
            let mut a = Warlord::new(0, mix64(t ^ 0xB0B0));
            let mut b = Warlord::new(1, mix64(t ^ 0xB1B1));
            Inputs {
                sides: [a.decide(&m.public), b.decide(&m.public)],
            }
        } else {
            Inputs::default()
        };
        step(&mut m, &inputs, &mut NoEvents);
    }
    log_cu();
    encode_public(&m.public, p);
    log_cu();
    encode_secret(&m.secret, s);
    log_cu();
    msg!(
        "bench n={} tick={} live={}/{} enemies={}/{}",
        n,
        m.public.tick,
        m.public.sides[0].cohort_len,
        m.public.sides[1].cohort_len,
        m.public.sides[0].enemy_len,
        m.public.sides[1].enemy_len
    );
    Ok(())
}

/// Logs "Program consumption: N units remaining" (the harness diffs consecutive lines).
pub fn log_cu() {
    #[cfg(target_os = "solana")]
    // SAFETY: a plain syscall with no arguments.
    unsafe {
        solana_define_syscall::definitions::sol_log_compute_units_()
    }
}
