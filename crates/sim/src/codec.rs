//! Compact little-endian codec for the on-chain accounts (TECH §4): the public part lives in the
//! public Match account, the secret part in the private Secrets account. Offsets are fixed (the
//! TS decoder in packages/client/src/codec.ts reads the same layout), but only live cohorts are
//! copied and free cohort slots are zero in the buffer. Built for SBF compute: no allocation, no
//! cursor, constant offsets, nothing rebuilt on decode (decode into `MatchState::zeroed()`).
//!
//! Lossless for every state the rules can reach: cohort ids, HP and the tick fit their narrower
//! fields (checked at compile time below). Decoding never panics on garbage; it clamps.
//!
//! PUBLIC (PUBLIC_LEN = 1,046 bytes)
//! ```text
//!   0  u8   CODEC_VERSION
//!   1  u8   flags: 1 bot side 0 | 2 bot side 1 | 4 tutorial | 8 has result | 16 ko
//!   2  u8   winner (0, 1; 2 = draw or no result)
//!   3  u8   0 (reserved)
//!   4  u32  tick
//!   8  u64  stake
//!  16  u64  moved
//!  24  u64  fee
//!  32  u16  next_cohort_id
//!  34  side 0, then side 1 at 34 + SIDE_LEN, SIDE_LEN = 506 each:
//!        0 u16 hp | 2 i16 cannon_x | 4 i16 aim | 6 u8 cohort_len | 7 u8 flags (1 rig used, 2 peek used)
//!        8 gates 9 × 2 B: [hint | gold << 2 | revealed << 3 | kind << 4, value]
//!       26 cohorts 40 × 12 B: [u16 id, u32 count, i16 x, i16 y, u8 age, u8 last_row]
//! ```
//! hint: 0 none, 1 good, 2 bad, 3 gold. kind: 0 mul, 1 add, 2 sub, 3 div.
//!
//! SECRET (SECRET_LEN = 85 bytes)
//! ```text
//!   0  u64  seed
//!   8  deal ops 9 × [kind, value]
//!  26  u8   gold cell
//!  27  hints 2 × 9 × u8 (side 0 first)
//!  45  rigs 2 × u8 (255 = none)
//!  47  peeks 2 × [cell (255 = none), kind, value, gold]
//!  55  history 3 phases × 2 sides × [rig (255 = none), peek cell (255 = none), kind, value, gold]
//! ```

use crate::constants::{
    CELLS, COHORT_CAP, FIRE_TICKS_SURGE, HP_MAX, MATCH_TICKS, PHASES, PLANT_TICKS,
};
use crate::payout::MatchResult;
use crate::state::{
    MatchOptions, Peek, PhaseLog, PublicGate, PublicSide, PublicState, SecretState,
};
use crate::types::{Cohort, GateOp, Hint};

/// Bump when either layout changes (the TS decoder checks byte 0 of the public part).
pub const CODEC_VERSION: u8 = 1;

pub const HEADER_LEN: usize = 34;
pub const GATE_LEN: usize = 2;
pub const COHORT_LEN: usize = 12;
pub const SIDE_GATES: usize = 8;
pub const SIDE_COHORTS: usize = SIDE_GATES + CELLS * GATE_LEN;
pub const SIDE_LEN: usize = SIDE_COHORTS + COHORT_CAP * COHORT_LEN;
pub const PUBLIC_LEN: usize = HEADER_LEN + 2 * SIDE_LEN;

const PEEK_LEN: usize = 4;
const LOG_LEN: usize = 1 + PEEK_LEN;
const S_OPS: usize = 8;
const S_GOLD: usize = S_OPS + CELLS * 2;
const S_HINTS: usize = S_GOLD + 1;
const S_RIGS: usize = S_HINTS + 2 * CELLS;
const S_PEEKS: usize = S_RIGS + 2;
const S_HISTORY: usize = S_PEEKS + 2 * PEEK_LEN;
pub const SECRET_LEN: usize = S_HISTORY + PHASES * 2 * LOG_LEN;

const NONE: u8 = u8::MAX;
const F_BOT0: u8 = 1;
const F_BOT1: u8 = 2;
const F_TUTORIAL: u8 = 4;
const F_RESULT: u8 = 8;
const F_KO: u8 = 16;
const F_RIG: u8 = 1;
const F_PEEK: u8 = 2;

const _: () = {
    assert!(PUBLIC_LEN == 1_046);
    assert!(SECRET_LEN == 85);
    // Lossless narrowing: at most one volley per side every FIRE_TICKS_SURGE ticks, so ids stay
    // far below u16::MAX; HP only goes down from HP_MAX; the tick never passes MATCH_TICKS.
    assert!(2 * (MATCH_TICKS / FIRE_TICKS_SURGE + 1) + 1 < u16::MAX as u32);
    assert!(HP_MAX <= u16::MAX as u32);
    assert!(PLANT_TICKS < MATCH_TICKS);
    assert!(COHORT_CAP < NONE as usize);
    assert!(CELLS < NONE as usize);
};

// --- byte helpers (constant-size copies; inlined at the sim's opt-level) ---------------------

#[inline(always)]
fn put<const N: usize>(buf: &mut [u8], at: usize, bytes: [u8; N]) {
    if let Some(dst) = buf.get_mut(at..at.saturating_add(N)) {
        dst.copy_from_slice(&bytes);
    }
}

#[inline(always)]
fn get<const N: usize>(buf: &[u8], at: usize) -> [u8; N] {
    let mut out = [0u8; N];
    if let Some(src) = buf.get(at..at.saturating_add(N)) {
        out.copy_from_slice(src);
    }
    out
}

#[inline(always)]
fn byte(buf: &[u8], at: usize) -> u8 {
    buf.get(at).copied().unwrap_or(0)
}

#[inline(always)]
fn set(buf: &mut [u8], at: usize, v: u8) {
    if let Some(b) = buf.get_mut(at) {
        *b = v;
    }
}

fn op_from(kind: u8, value: u8) -> GateOp {
    match kind & 3 {
        0 => GateOp::Mul(value),
        1 => GateOp::Add(value),
        2 => GateOp::Sub(value),
        _ => GateOp::Div(value),
    }
}

fn hint_from(code: u8) -> Hint {
    match code & 3 {
        1 => Hint::Good,
        2 => Hint::Bad,
        3 => Hint::Gold,
        _ => Hint::None,
    }
}

fn narrow_u16(v: u32) -> [u8; 2] {
    u16::try_from(v).unwrap_or(u16::MAX).to_le_bytes()
}

// --- public part -----------------------------------------------------------------------------

/// Writes the public state into the Match account's state bytes.
pub fn encode_public(p: &PublicState, out: &mut [u8; PUBLIC_LEN]) {
    let o = &p.options;
    let r = p.result;
    let flags = (if o.bot[0] { F_BOT0 } else { 0 })
        | (if o.bot[1] { F_BOT1 } else { 0 })
        | (if o.tutorial { F_TUTORIAL } else { 0 })
        | (if r.is_some() { F_RESULT } else { 0 })
        | (if r.is_some_and(|r| r.ko) { F_KO } else { 0 });
    let (head, sides) = out.split_at_mut(HEADER_LEN);
    put(
        head,
        0,
        [
            CODEC_VERSION,
            flags,
            r.and_then(|r| r.winner).unwrap_or(2),
            0,
        ],
    );
    put(head, 4, p.tick.to_le_bytes());
    put(head, 8, o.stake.to_le_bytes());
    put(head, 16, r.map_or(0, |r| r.moved).to_le_bytes());
    put(head, 24, r.map_or(0, |r| r.fee).to_le_bytes());
    put(head, 32, narrow_u16(p.next_cohort_id));
    for (side, buf) in p.sides.iter().zip(sides.chunks_exact_mut(SIDE_LEN)) {
        encode_side(side, buf);
    }
}

fn encode_side(s: &PublicSide, buf: &mut [u8]) {
    put(buf, 0, narrow_u16(s.hp));
    put(buf, 2, s.cannon_x.to_le_bytes());
    put(buf, 4, s.aim.to_le_bytes());
    let live = s.cohorts();
    let flags = (if s.rig_used { F_RIG } else { 0 }) | (if s.peek_used { F_PEEK } else { 0 });
    put(buf, 6, [live.len() as u8, flags]);
    let (head, cohorts) = buf.split_at_mut(SIDE_COHORTS);
    for (g, at) in s.gates.iter().zip((SIDE_GATES..).step_by(GATE_LEN)) {
        let (kind, value) = g.revealed.map_or((0, 0), GateOp::code);
        let packed = g.hint.code()
            | (u8::from(g.gold) << 2)
            | (u8::from(g.revealed.is_some()) << 3)
            | ((kind & 3) << 4);
        put(head, at, [packed, value]);
    }
    let mut chunks = cohorts.chunks_exact_mut(COHORT_LEN);
    for (c, rec) in live.iter().zip(chunks.by_ref()) {
        put(rec, 0, narrow_u16(c.id));
        put(rec, 2, c.count.to_le_bytes());
        put(rec, 6, c.x.to_le_bytes());
        put(rec, 8, c.y.to_le_bytes());
        put(rec, 10, [c.age, c.last_row]);
    }
    // Free slots are zero (one memset).
    if let Some(rest) = cohorts.get_mut(live.len().saturating_mul(COHORT_LEN)..) {
        rest.fill(0);
    }
}

/// Reads the public state back. Every field of `p` is overwritten.
pub fn decode_public(buf: &[u8; PUBLIC_LEN], p: &mut PublicState) {
    let (head, sides) = buf.split_at(HEADER_LEN);
    let flags = byte(head, 1);
    let winner = byte(head, 2);
    p.tick = u32::from_le_bytes(get(head, 4));
    p.options = MatchOptions {
        stake: u64::from_le_bytes(get(head, 8)),
        bot: [flags & F_BOT0 != 0, flags & F_BOT1 != 0],
        tutorial: flags & F_TUTORIAL != 0,
    };
    p.result = (flags & F_RESULT != 0).then(|| MatchResult {
        winner: (winner < 2).then_some(winner),
        ko: flags & F_KO != 0,
        moved: u64::from_le_bytes(get(head, 16)),
        fee: u64::from_le_bytes(get(head, 24)),
    });
    p.next_cohort_id = u32::from(u16::from_le_bytes(get(head, 32)));
    for (side, buf) in p.sides.iter_mut().zip(sides.chunks_exact(SIDE_LEN)) {
        decode_side(buf, side);
    }
}

fn decode_side(buf: &[u8], s: &mut PublicSide) {
    s.hp = u32::from(u16::from_le_bytes(get(buf, 0)));
    s.cannon_x = i16::from_le_bytes(get(buf, 2));
    s.aim = i16::from_le_bytes(get(buf, 4));
    let len = byte(buf, 6).min(COHORT_CAP as u8);
    let flags = byte(buf, 7);
    s.rig_used = flags & F_RIG != 0;
    s.peek_used = flags & F_PEEK != 0;
    let (head, cohorts) = buf.split_at(SIDE_COHORTS.min(buf.len()));
    for (g, at) in s.gates.iter_mut().zip((SIDE_GATES..).step_by(GATE_LEN)) {
        let [packed, value] = get(head, at);
        *g = PublicGate {
            hint: hint_from(packed),
            gold: packed & 4 != 0,
            revealed: (packed & 8 != 0).then(|| op_from(packed >> 4, value)),
        };
    }
    s.cohort_len = len;
    let live = usize::from(len);
    for (c, rec) in s
        .cohorts
        .iter_mut()
        .zip(cohorts.chunks_exact(COHORT_LEN))
        .take(live)
    {
        let [age, last_row] = get(rec, 10);
        *c = Cohort {
            id: u32::from(u16::from_le_bytes(get(rec, 0))),
            count: u32::from_le_bytes(get(rec, 2)),
            x: i16::from_le_bytes(get(rec, 6)),
            y: i16::from_le_bytes(get(rec, 8)),
            age,
            last_row,
        };
    }
    if let Some(rest) = s.cohorts.get_mut(live..) {
        rest.fill(Cohort::default());
    }
}

// --- secret part -----------------------------------------------------------------------------

fn put_peek(buf: &mut [u8], at: usize, pk: Option<Peek>) {
    put(
        buf,
        at,
        match pk {
            None => [NONE, 0, 0, 0],
            Some(pk) => {
                let (kind, value) = pk.op.code();
                [pk.cell, kind, value, u8::from(pk.gold)]
            }
        },
    );
}

fn get_peek(buf: &[u8], at: usize) -> Option<Peek> {
    let [cell, kind, value, gold] = get(buf, at);
    (cell != NONE).then(|| Peek {
        cell,
        op: op_from(kind, value),
        gold: gold != 0,
    })
}

fn opt_cell(v: u8) -> Option<u8> {
    (v != NONE).then_some(v)
}

/// Writes the secret state into the Secrets account's state bytes.
pub fn encode_secret(x: &SecretState, out: &mut [u8; SECRET_LEN]) {
    put(out, 0, x.seed.to_le_bytes());
    for (op, at) in x.deal.ops.iter().zip((S_OPS..).step_by(2)) {
        let (kind, value) = op.code();
        put(out, at, [kind, value]);
    }
    set(out, S_GOLD, x.deal.gold_cell);
    for (h, at) in x.deal.hints.iter().flatten().zip(S_HINTS..) {
        set(out, at, h.code());
    }
    for (r, at) in x.rigs.iter().zip(S_RIGS..) {
        set(out, at, r.unwrap_or(NONE));
    }
    for (pk, at) in x.peeks.iter().zip((S_PEEKS..).step_by(PEEK_LEN)) {
        put_peek(out, at, *pk);
    }
    let logs = x
        .history
        .iter()
        .flat_map(|l| l.rigs.iter().zip(l.peeks.iter()));
    for ((rig, pk), at) in logs.zip((S_HISTORY..).step_by(LOG_LEN)) {
        set(out, at, rig.unwrap_or(NONE));
        put_peek(out, at.saturating_add(1), *pk);
    }
}

/// Reads the secret state back. Every field of `x` is overwritten.
pub fn decode_secret(buf: &[u8; SECRET_LEN], x: &mut SecretState) {
    x.seed = u64::from_le_bytes(get(buf, 0));
    for (op, at) in x.deal.ops.iter_mut().zip((S_OPS..).step_by(2)) {
        let [kind, value] = get(buf, at);
        *op = op_from(kind, value);
    }
    x.deal.gold_cell = byte(buf, S_GOLD);
    for (h, at) in x.deal.hints.iter_mut().flatten().zip(S_HINTS..) {
        *h = hint_from(byte(buf, at));
    }
    for (r, at) in x.rigs.iter_mut().zip(S_RIGS..) {
        *r = opt_cell(byte(buf, at));
    }
    for (pk, at) in x.peeks.iter_mut().zip((S_PEEKS..).step_by(PEEK_LEN)) {
        *pk = get_peek(buf, at);
    }
    for (phase, at) in x.history.iter_mut().zip((S_HISTORY..).step_by(2 * LOG_LEN)) {
        let side1 = at.saturating_add(LOG_LEN);
        *phase = PhaseLog {
            rigs: [opt_cell(byte(buf, at)), opt_cell(byte(buf, side1))],
            peeks: [
                get_peek(buf, at.saturating_add(1)),
                get_peek(buf, side1.saturating_add(1)),
            ],
        };
    }
}

/// The history part of an encoded secret (published in the Match account at the end).
pub fn history_bytes(buf: &[u8; SECRET_LEN]) -> &[u8] {
    buf.get(S_HISTORY..).unwrap_or(&[])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::SplitMix64;
    use crate::state::{Inputs, MatchState, SideInput};
    use crate::{step, NoEvents, Warlord, LANE_WIDTH};

    fn roundtrip(m: &MatchState) {
        let mut pub_buf = [0u8; PUBLIC_LEN];
        let mut sec_buf = [0u8; SECRET_LEN];
        encode_public(&m.public, &mut pub_buf);
        encode_secret(&m.secret, &mut sec_buf);
        // Decode into garbage, not zeroes, to prove every field is overwritten.
        let mut back = MatchState::new(0xDEAD, MatchOptions::default());
        back.public.sides[0].cohorts = [Cohort {
            id: 9,
            count: 9,
            x: 9,
            y: 9,
            age: 9,
            last_row: 9,
        }; COHORT_CAP];
        decode_public(&pub_buf, &mut back.public);
        decode_secret(&sec_buf, &mut back.secret);
        assert_eq!(back, *m, "roundtrip at tick {}", m.public.tick);
        let mut again = [0u8; PUBLIC_LEN];
        encode_public(&back.public, &mut again);
        assert_eq!(again, pub_buf);
    }

    #[test]
    fn roundtrip_whole_matches() {
        for seed in 0..40u64 {
            let mut m = MatchState::new(
                seed,
                MatchOptions {
                    stake: seed * 1_000_003,
                    bot: [seed % 2 == 0, seed % 3 == 0],
                    tutorial: seed % 5 == 0,
                },
            );
            let mut bots = [Warlord::new(0, seed ^ 7), Warlord::new(1, seed ^ 9)];
            let mut rng = SplitMix64::new(seed);
            roundtrip(&m);
            while m.public.result.is_none() {
                let mut inputs = Inputs {
                    sides: [bots[0].decide(&m.public), bots[1].decide(&m.public)],
                };
                if rng.below(10) == 0 {
                    inputs.sides[0] = SideInput {
                        aim: Some(rng.below(LANE_WIDTH as u64) as i32),
                        rig: Some(rng.below(9) as u8),
                        peek: Some(rng.below(9) as u8),
                    };
                }
                step(&mut m, &inputs, &mut NoEvents);
                if m.public.tick % 7 == 0 || m.public.result.is_some() {
                    roundtrip(&m);
                }
            }
            assert!(m
                .secret
                .history
                .iter()
                .any(|l| l.rigs.iter().any(Option::is_some)));
        }
    }

    #[test]
    fn zeroed_decodes_like_new() {
        let m = MatchState::new(77, MatchOptions::default());
        let mut pub_buf = [0u8; PUBLIC_LEN];
        let mut sec_buf = [0u8; SECRET_LEN];
        encode_public(&m.public, &mut pub_buf);
        encode_secret(&m.secret, &mut sec_buf);
        let mut z = MatchState::zeroed();
        decode_public(&pub_buf, &mut z.public);
        decode_secret(&sec_buf, &mut z.secret);
        assert_eq!(z, m);
        assert_eq!(pub_buf[0], CODEC_VERSION);
    }

    #[test]
    fn garbage_never_panics() {
        let mut rng = SplitMix64::new(3);
        let mut m = MatchState::zeroed();
        for _ in 0..500 {
            let mut pub_buf = [0u8; PUBLIC_LEN];
            let mut sec_buf = [0u8; SECRET_LEN];
            pub_buf.iter_mut().for_each(|b| *b = rng.next_u64() as u8);
            sec_buf.iter_mut().for_each(|b| *b = rng.next_u64() as u8);
            decode_public(&pub_buf, &mut m.public);
            decode_secret(&sec_buf, &mut m.secret);
            assert!(m
                .public
                .sides
                .iter()
                .all(|s| usize::from(s.cohort_len) <= COHORT_CAP));
            step(&mut m, &Inputs::default(), &mut NoEvents);
        }
    }
}
