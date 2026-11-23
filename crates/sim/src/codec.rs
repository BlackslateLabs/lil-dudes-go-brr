//! Compact little-endian codec for the on-chain accounts (TECH §4): the public part lives in the
//! public Match account, the secret part in the private Secrets account. Offsets are fixed (the
//! TS decoder in packages/client/src/codec.ts reads the same layout), but only live cohorts and
//! enemies are copied and free slots are zero in the buffer. Built for SBF compute: no
//! allocation, no cursor, constant offsets, nothing rebuilt on decode (decode into
//! `MatchState::zeroed()`).
//!
//! Lossless for every state the rules can reach: ids, tower/crate HP and phase timers fit their
//! narrower fields (checked at compile time below). Decoding never panics on garbage; it clamps.
//!
//! PUBLIC (PUBLIC_LEN = 1,500 bytes, codec v6)
//! ```text
//!   0  u8   CODEC_VERSION
//!   1  u8   flags: 1 bot side 0 | 2 bot side 1 | 4 tutorial | 8 has result | 16 ko
//!   2  u8   winner (0, 1; 2 = draw or no result)
//!   3  u8   layout
//!   4  u32  tick
//!   8  u64  stake
//!  16  u64  moved
//!  24  u64  fee
//!  32  u16  next_cohort_id
//!  34  side 0, then side 1 at 34 + SIDE_LEN, SIDE_LEN = 733 each:
//!        0 u8 stage | 1 u8 flags: phase (bits 0-2) | 8 dead | 16 champion pending | 32 peek used
//!        2 i16 cannon_x | 4 i16 aim | 6 u16 phase_ticks | 8 u32 gold
//!       12 u8 cohort_len | 13 u8 enemy_len
//!       14 towers 2 × u16 hp | 18 crates 3 × u16 hp
//!       24 gates 10 × [i16 x, u8 revealed op (0 = face-down)]
//!       54 cohorts 40 × 12 B: [u16 id, u32 count, i16 x, i16 y, u8 age,
//!                               u8 last_row | 128 champion]
//!      534 enemies 16 × 12 B: [u16 id, u32 count, i16 x, i16 y, u8 tower, u8 1 = giant]
//!      726 u16 rush_ticks | 728 u8 champ_meter | 729 2 × u16 breach_tick (per fight)
//! ```
//! phase: 0 plant, 1 fight, 2 transit, 3 rush, 4 done. Op byte: `k` = ×k, `0x40 | n` = +n,
//! `0x80 | k` = ÷k, `0xC0 | n` = −n.
//!
//! SECRET (SECRET_LEN = 36 bytes)
//! ```text
//!   0  u64  seed
//!   8  values 2 stages × 10 slots × op byte
//!  28  history 2 stages × 2 sides × [peek slot (255 = none), peek op]
//! ```

use crate::constants::{
    COHORT_CAP, CRATES_MAX, ENEMY_CAP, FIRE_TICKS, FIRST_WAVE_TICKS, GATES_MAX, MATCH_TICKS,
    STAGES, TOWERS_MAX, WAVE_GAPS,
};
use crate::payout::MatchResult;
use crate::state::{MatchOptions, Peek, PublicGate, PublicSide, PublicState, SecretState};
use crate::types::{Cohort, Enemy, GateOp, Phase};

/// Bump when either layout changes (the TS decoder checks byte 0 of the public part).
pub const CODEC_VERSION: u8 = 6;

pub const HEADER_LEN: usize = 34;
pub const GATE_LEN: usize = 3;
pub const UNIT_LEN: usize = 12;
pub const SIDE_TOWERS: usize = 14;
pub const SIDE_CRATES: usize = SIDE_TOWERS + TOWERS_MAX * 2;
pub const SIDE_GATES: usize = SIDE_CRATES + CRATES_MAX * 2;
pub const SIDE_COHORTS: usize = SIDE_GATES + GATES_MAX * GATE_LEN;
pub const SIDE_ENEMIES: usize = SIDE_COHORTS + COHORT_CAP * UNIT_LEN;
pub const SIDE_RUSH: usize = SIDE_ENEMIES + ENEMY_CAP * UNIT_LEN;
pub const SIDE_CHAMP: usize = SIDE_RUSH + 2;
pub const SIDE_BREACH: usize = SIDE_CHAMP + 1;
pub const SIDE_LEN: usize = SIDE_BREACH + STAGES * 2;
pub const PUBLIC_LEN: usize = HEADER_LEN + 2 * SIDE_LEN;
/// Offset of the aim inside a side (the program writes it directly).
pub const SIDE_AIM: usize = 4;

const LOG_LEN: usize = 2;
const S_VALUES: usize = 8;
pub const S_HISTORY: usize = S_VALUES + STAGES * GATES_MAX;
pub const HISTORY_LEN: usize = STAGES * 2 * LOG_LEN;
pub const SECRET_LEN: usize = S_HISTORY + HISTORY_LEN;

const NONE: u8 = u8::MAX;
const F_BOT0: u8 = 1;
const F_BOT1: u8 = 2;
const F_TUTORIAL: u8 = 4;
const F_RESULT: u8 = 8;
const F_KO: u8 = 16;
const F_PHASE: u8 = 7;
const F_DEAD: u8 = 8;
const F_CHAMP: u8 = 16;
const F_PEEK: u8 = 32;
/// Cohort `last_row` byte: the Champion flag above the row count.
const C_CHAMP: u8 = 128;

const _: () = {
    assert!(SIDE_LEN == 733);
    assert!(PUBLIC_LEN == 1_500);
    // last_row (≤ ROWS_MAX) never reaches the Champion bit.
    assert!(crate::constants::ROWS_MAX < C_CHAMP as usize);
    assert!(SECRET_LEN == 36);
    assert!(HISTORY_LEN == 8);
    // The on-chain commit limit is 10,240 bytes including the account header.
    assert!(PUBLIC_LEN + 64 < 10_240);
    // Lossless narrowing: one volley per side every FIRE_TICKS and at most one wave per tower
    // per WAVE_GAPS[2] ticks keep ids far below u16::MAX; timers stay below MATCH_TICKS.
    assert!(
        2 * (MATCH_TICKS / FIRE_TICKS + 1)
            + 2 * TOWERS_MAX as u32 * (MATCH_TICKS / WAVE_GAPS[2] + FIRST_WAVE_TICKS)
            + 1
            < u16::MAX as u32
    );
    assert!(MATCH_TICKS < u16::MAX as u32);
    assert!(COHORT_CAP < NONE as usize);
    assert!(ENEMY_CAP < NONE as usize);
    assert!(GATES_MAX < NONE as usize);
    assert!(STAGES < NONE as usize);
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

fn narrow_u16(v: u32) -> [u8; 2] {
    u16::try_from(v).unwrap_or(u16::MAX).to_le_bytes()
}

fn u16_at(buf: &[u8], at: usize) -> u16 {
    u16::from_le_bytes(get(buf, at))
}

fn i16_at(buf: &[u8], at: usize) -> i16 {
    i16::from_le_bytes(get(buf, at))
}

fn u32_at(buf: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(get(buf, at))
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
            p.layout,
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
    let flags = (s.phase.code() & F_PHASE)
        | (if s.dead { F_DEAD } else { 0 })
        | (if s.champ_pending { F_CHAMP } else { 0 })
        | (if s.peek_used { F_PEEK } else { 0 });
    let live = s.cohorts();
    let foes = s.enemies();
    put(buf, 0, [s.stage, flags]);
    put(buf, 2, s.cannon_x.to_le_bytes());
    put(buf, SIDE_AIM, s.aim.to_le_bytes());
    put(buf, 6, s.phase_ticks.to_le_bytes());
    put(buf, 8, s.gold.to_le_bytes());
    put(buf, 12, [live.len() as u8, foes.len() as u8]);
    for (hp, at) in s.towers.iter().zip((SIDE_TOWERS..).step_by(2)) {
        put(buf, at, hp.to_le_bytes());
    }
    for (hp, at) in s.crates.iter().zip((SIDE_CRATES..).step_by(2)) {
        put(buf, at, hp.to_le_bytes());
    }
    for (g, at) in s.gates.iter().zip((SIDE_GATES..).step_by(GATE_LEN)) {
        let [lo, hi] = g.x.to_le_bytes();
        put(buf, at, [lo, hi, g.revealed.map_or(0, GateOp::to_byte)]);
    }
    let (_, units) = buf.split_at_mut(SIDE_COHORTS.min(buf.len()));
    let (cohorts, enemies) = units.split_at_mut((COHORT_CAP * UNIT_LEN).min(units.len()));
    let mut chunks = cohorts.chunks_exact_mut(UNIT_LEN);
    for (c, rec) in live.iter().zip(chunks.by_ref()) {
        put(rec, 0, narrow_u16(c.id));
        put(rec, 2, c.count.to_le_bytes());
        put(rec, 6, c.x.to_le_bytes());
        put(rec, 8, c.y.to_le_bytes());
        let champ = if c.champion { C_CHAMP } else { 0 };
        put(rec, 10, [c.age, c.last_row | champ]);
    }
    if let Some(rest) = cohorts.get_mut(live.len().saturating_mul(UNIT_LEN)..) {
        rest.fill(0);
    }
    let mut chunks = enemies.chunks_exact_mut(UNIT_LEN);
    for (e, rec) in foes.iter().zip(chunks.by_ref()) {
        put(rec, 0, narrow_u16(e.id));
        put(rec, 2, e.count.to_le_bytes());
        put(rec, 6, e.x.to_le_bytes());
        put(rec, 8, e.y.to_le_bytes());
        put(rec, 10, [e.tower, u8::from(e.giant)]);
    }
    if let Some(rest) = enemies.get_mut(foes.len().saturating_mul(UNIT_LEN)..) {
        rest.fill(0);
    }
    put(buf, SIDE_RUSH, s.rush_ticks.to_le_bytes());
    put(buf, SIDE_CHAMP, [s.champ_meter]);
    for (t, at) in s.breach_tick.iter().zip((SIDE_BREACH..).step_by(2)) {
        put(buf, at, t.to_le_bytes());
    }
}

/// Reads the public state back. Every field of `p` is overwritten.
pub fn decode_public(buf: &[u8; PUBLIC_LEN], p: &mut PublicState) {
    let (head, sides) = buf.split_at(HEADER_LEN);
    let flags = byte(head, 1);
    let winner = byte(head, 2);
    p.layout = byte(head, 3);
    p.tick = u32_at(head, 4);
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
    p.next_cohort_id = u32::from(u16_at(head, 32));
    for (side, buf) in p.sides.iter_mut().zip(sides.chunks_exact(SIDE_LEN)) {
        decode_side(buf, side);
    }
}

fn decode_side(buf: &[u8], s: &mut PublicSide) {
    let flags = byte(buf, 1);
    s.stage = byte(buf, 0);
    s.phase = Phase::from_code(flags & F_PHASE);
    s.dead = flags & F_DEAD != 0;
    s.peek_used = flags & F_PEEK != 0;
    s.champ_pending = flags & F_CHAMP != 0;
    s.champ_meter = byte(buf, SIDE_CHAMP);
    for (t, at) in s.breach_tick.iter_mut().zip((SIDE_BREACH..).step_by(2)) {
        *t = u16_at(buf, at);
    }
    s.cannon_x = i16_at(buf, 2);
    s.aim = i16_at(buf, SIDE_AIM);
    s.phase_ticks = u16_at(buf, 6);
    s.rush_ticks = u16_at(buf, SIDE_RUSH);
    s.gold = u32_at(buf, 8);
    s.cohort_len = byte(buf, 12).min(COHORT_CAP as u8);
    s.enemy_len = byte(buf, 13).min(ENEMY_CAP as u8);
    for (hp, at) in s.towers.iter_mut().zip((SIDE_TOWERS..).step_by(2)) {
        *hp = u16_at(buf, at);
    }
    for (hp, at) in s.crates.iter_mut().zip((SIDE_CRATES..).step_by(2)) {
        *hp = u16_at(buf, at);
    }
    for (g, at) in s.gates.iter_mut().zip((SIDE_GATES..).step_by(GATE_LEN)) {
        let op = byte(buf, at.saturating_add(2));
        *g = PublicGate {
            x: i16_at(buf, at),
            revealed: (op != 0).then(|| GateOp::from_byte(op)),
        };
    }
    let units = buf.get(SIDE_COHORTS..).unwrap_or(&[]);
    let (cohorts, enemies) = units.split_at((COHORT_CAP * UNIT_LEN).min(units.len()));
    let live = usize::from(s.cohort_len);
    for (c, rec) in s
        .cohorts
        .iter_mut()
        .zip(cohorts.chunks_exact(UNIT_LEN))
        .take(live)
    {
        let [age, last_row] = get(rec, 10);
        *c = Cohort {
            id: u32::from(u16_at(rec, 0)),
            count: u32_at(rec, 2),
            x: i16_at(rec, 6),
            y: i16_at(rec, 8),
            age,
            last_row: last_row & !C_CHAMP,
            champion: last_row & C_CHAMP != 0,
        };
    }
    if let Some(rest) = s.cohorts.get_mut(live..) {
        rest.fill(Cohort::default());
    }
    let foes = usize::from(s.enemy_len);
    for (e, rec) in s
        .enemies
        .iter_mut()
        .zip(enemies.chunks_exact(UNIT_LEN))
        .take(foes)
    {
        *e = Enemy {
            id: u32::from(u16_at(rec, 0)),
            count: u32_at(rec, 2),
            x: i16_at(rec, 6),
            y: i16_at(rec, 8),
            tower: byte(rec, 10),
            giant: byte(rec, 11) != 0,
        };
    }
    if let Some(rest) = s.enemies.get_mut(foes..) {
        rest.fill(Enemy::default());
    }
}

// --- secret part -----------------------------------------------------------------------------

/// Writes the secret state into the Secrets account's state bytes.
pub fn encode_secret(x: &SecretState, out: &mut [u8; SECRET_LEN]) {
    put(out, 0, x.seed.to_le_bytes());
    for (op, at) in x.values.iter().flatten().zip(S_VALUES..) {
        set(out, at, op.to_byte());
    }
    let logs = x.history.iter().flat_map(|l| l.peeks.iter());
    for (peek, at) in logs.zip((S_HISTORY..).step_by(LOG_LEN)) {
        let (pslot, pop) = peek.map_or((NONE, 0), |p| (p.slot, p.op.to_byte()));
        put(out, at, [pslot, pop]);
    }
}

/// Reads the secret state back. Every field of `x` is overwritten.
pub fn decode_secret(buf: &[u8; SECRET_LEN], x: &mut SecretState) {
    x.seed = u64::from_le_bytes(get(buf, 0));
    for (op, at) in x.values.iter_mut().flatten().zip(S_VALUES..) {
        *op = GateOp::from_byte(byte(buf, at));
    }
    let logs = x.history.iter_mut().flat_map(|l| l.peeks.iter_mut());
    for (peek, at) in logs.zip((S_HISTORY..).step_by(LOG_LEN)) {
        let [pslot, pop] = get(buf, at);
        *peek = (pslot != NONE).then(|| Peek {
            slot: pslot,
            op: GateOp::from_byte(pop),
        });
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
            champion: true,
        }; COHORT_CAP];
        back.public.sides[1].enemies = [Enemy {
            id: 9,
            count: 9,
            x: 9,
            y: 9,
            tower: 9,
            giant: true,
        }; ENEMY_CAP];
        back.secret.history[1].peeks[0] = Some(Peek {
            slot: 9,
            op: GateOp::Div(9),
        });
        decode_public(&pub_buf, &mut back.public);
        decode_secret(&sec_buf, &mut back.secret);
        assert_eq!(back, *m, "roundtrip at tick {}", m.public.tick);
        let mut again = [0u8; PUBLIC_LEN];
        encode_public(&back.public, &mut again);
        assert_eq!(again, pub_buf);
        assert_eq!(&sec_buf[..8], &m.secret.seed.to_le_bytes());
    }

    #[test]
    fn roundtrip_whole_matches() {
        let mut saw = [false; 4]; // a peek, enemies, a Champion, a giant
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
                        peek: Some(rng.below(9) as u8),
                        champion: rng.below(3) == 0,
                    };
                }
                step(&mut m, &inputs, &mut NoEvents);
                saw[1] |= m.public.sides.iter().any(|s| s.enemy_len > 0);
                saw[2] |= m
                    .public
                    .sides
                    .iter()
                    .any(|s| s.cohorts().iter().any(|c| c.champion));
                saw[3] |= m
                    .public
                    .sides
                    .iter()
                    .any(|s| s.enemies().iter().any(|e| e.giant));
                if m.public.tick % 7 == 0 || m.public.result.is_some() {
                    roundtrip(&m);
                }
            }
            for log in &m.secret.history {
                saw[0] |= log.peeks.iter().any(Option::is_some);
            }
        }
        assert_eq!(saw, [true; 4]);
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
        assert_eq!(history_bytes(&sec_buf), &[NONE, 0].repeat(STAGES * 2)[..]);
    }

    #[test]
    fn aim_sits_at_the_documented_offset() {
        let mut m = MatchState::new(3, MatchOptions::default());
        m.public.sides[1].aim = 0x1234;
        let mut buf = [0u8; PUBLIC_LEN];
        encode_public(&m.public, &mut buf);
        let at = HEADER_LEN + SIDE_LEN + SIDE_AIM;
        assert_eq!(&buf[at..at + 2], &0x1234i16.to_le_bytes());
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
                .all(|s| usize::from(s.cohort_len) <= COHORT_CAP
                    && usize::from(s.enemy_len) <= ENEMY_CAP));
            step(&mut m, &Inputs::default(), &mut NoEvents);
            let mut w = Warlord::new(0, 1);
            w.decide(&m.public);
        }
    }
}
