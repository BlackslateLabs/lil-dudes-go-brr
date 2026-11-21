//! Explicit little-endian layout of `lil_dudes_sim::MatchState` (public + secret parts) so the
//! spike can keep the real sim state in an account and measure the (de)serialisation cost.
//! M3 will split this into the public Match account and the private Secrets account.
//!
//! Layout (STATE_LEN = 1,307 bytes):
//!   header  38 B: tick u32 | stake u64 | bot0 u8 | bot1 u8 | tutorial u8 | next_cohort_id u32 |
//!                 result_tag u8 | winner u8 (2 = none) | ko u8 | moved u64 | fee u64
//!   side ×2 607 B: hp u32 | cannon_x i16 | aim i16 | cohort_len u8 | rig_used u8 | peek_used u8 |
//!                 gates 9 × [hint u8, gold u8, rev_kind u8 (255 = none), rev_val u8] |
//!                 cohorts 40 × [id u32, count u32, x i16, y i16, age u8, last_row u8]
//!   secret  55 B: seed u64 | ops 9 × [kind u8, val u8] | gold_cell u8 | hints 2×9 u8 |
//!                 rigs 2 × u8 (255 = none) | peeks 2 × [cell u8 (255 = none), kind u8, val u8, gold u8]
use lil_dudes_sim::{
    Cohort, Deal, GateOp, Hint, MatchOptions, MatchResult, MatchState, Peek, PublicGate,
    PublicSide, CELLS, COHORT_CAP,
};

pub const HEADER_LEN: usize = 38;
pub const GATE_LEN: usize = 4;
pub const COHORT_LEN: usize = 14;
pub const SIDE_LEN: usize = 11 + CELLS * GATE_LEN + COHORT_CAP * COHORT_LEN;
pub const SECRET_LEN: usize = 8 + CELLS * 2 + 1 + 2 * CELLS + 2 + 2 * 4;
pub const STATE_LEN: usize = HEADER_LEN + 2 * SIDE_LEN + SECRET_LEN;

const _: () = assert!(STATE_LEN == 1_307);

struct W<'a> {
    buf: &'a mut [u8],
    at: usize,
}

impl W<'_> {
    fn bytes(&mut self, b: &[u8]) {
        let end = self.at.saturating_add(b.len());
        if let Some(dst) = self.buf.get_mut(self.at..end) {
            dst.copy_from_slice(b);
        }
        self.at = end;
    }
    fn u8(&mut self, v: u8) {
        self.bytes(&[v]);
    }
    fn u32(&mut self, v: u32) {
        self.bytes(&v.to_le_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.bytes(&v.to_le_bytes());
    }
    fn i16(&mut self, v: i16) {
        self.bytes(&v.to_le_bytes());
    }
    fn op(&mut self, op: GateOp) {
        let (k, v) = op.code();
        self.u8(k);
        self.u8(v);
    }
}

struct R<'a> {
    buf: &'a [u8],
    at: usize,
}

impl R<'_> {
    fn take<const N: usize>(&mut self) -> [u8; N] {
        let end = self.at.saturating_add(N);
        let mut out = [0u8; N];
        if let Some(src) = self.buf.get(self.at..end) {
            out.copy_from_slice(src);
        }
        self.at = end;
        out
    }
    fn u8(&mut self) -> u8 {
        self.take::<1>()[0]
    }
    fn u32(&mut self) -> u32 {
        u32::from_le_bytes(self.take())
    }
    fn u64(&mut self) -> u64 {
        u64::from_le_bytes(self.take())
    }
    fn i16(&mut self) -> i16 {
        i16::from_le_bytes(self.take())
    }
    fn op(&mut self) -> GateOp {
        let k = self.u8();
        let v = self.u8();
        op_from(k, v)
    }
}

fn op_from(kind: u8, val: u8) -> GateOp {
    match kind {
        0 => GateOp::Mul(val),
        1 => GateOp::Add(val),
        2 => GateOp::Sub(val),
        _ => GateOp::Div(val),
    }
}

fn hint_from(code: u8) -> Hint {
    match code {
        1 => Hint::Good,
        2 => Hint::Bad,
        3 => Hint::Gold,
        _ => Hint::None,
    }
}

pub fn encode(m: &MatchState, buf: &mut [u8]) {
    let mut w = W { buf, at: 0 };
    let p = &m.public;
    w.u32(p.tick);
    w.u64(p.options.stake);
    w.u8(u8::from(p.options.bot[0]));
    w.u8(u8::from(p.options.bot[1]));
    w.u8(u8::from(p.options.tutorial));
    w.u32(p.next_cohort_id);
    match p.result {
        None => {
            w.u8(0);
            w.u8(2);
            w.u8(0);
            w.u64(0);
            w.u64(0);
        }
        Some(r) => {
            w.u8(1);
            w.u8(r.winner.unwrap_or(2));
            w.u8(u8::from(r.ko));
            w.u64(r.moved);
            w.u64(r.fee);
        }
    }
    for s in &p.sides {
        w.u32(s.hp);
        w.i16(s.cannon_x);
        w.i16(s.aim);
        w.u8(s.cohort_len);
        w.u8(u8::from(s.rig_used));
        w.u8(u8::from(s.peek_used));
        for g in &s.gates {
            w.u8(g.hint.code());
            w.u8(u8::from(g.gold));
            match g.revealed {
                None => {
                    w.u8(255);
                    w.u8(0);
                }
                Some(op) => w.op(op),
            }
        }
        for c in &s.cohorts {
            w.u32(c.id);
            w.u32(c.count);
            w.i16(c.x);
            w.i16(c.y);
            w.u8(c.age);
            w.u8(c.last_row);
        }
    }
    let x = &m.secret;
    w.u64(x.seed);
    x.deal.ops.iter().for_each(|&op| w.op(op));
    w.u8(x.deal.gold_cell);
    x.deal
        .hints
        .iter()
        .flatten()
        .for_each(|&h| w.u8(h.code()));
    x.rigs.iter().for_each(|&r| w.u8(r.unwrap_or(255)));
    for pk in &x.peeks {
        match pk {
            None => {
                w.u8(255);
                w.u8(0);
                w.u8(0);
                w.u8(0);
            }
            Some(pk) => {
                w.u8(pk.cell);
                w.op(pk.op);
                w.u8(u8::from(pk.gold));
            }
        }
    }
}

/// Decodes into `m` in place (no 1.3 KB temporaries on the 4 KB SBF stack frame).
pub fn decode_into(buf: &[u8], m: &mut MatchState) {
    let mut r = R { buf, at: 0 };
    let p = &mut m.public;
    p.tick = r.u32();
    p.options = MatchOptions {
        stake: r.u64(),
        bot: [r.u8() != 0, r.u8() != 0],
        tutorial: r.u8() != 0,
    };
    p.next_cohort_id = r.u32();
    let tag = r.u8();
    let winner = r.u8();
    let ko = r.u8() != 0;
    let moved = r.u64();
    let fee = r.u64();
    p.result = (tag == 1).then_some(MatchResult {
        winner: (winner < 2).then_some(winner),
        ko,
        moved,
        fee,
    });
    for s in p.sides.iter_mut() {
        decode_side(&mut r, s);
    }
    let x = &mut m.secret;
    x.seed = r.u64();
    for op in x.deal.ops.iter_mut() {
        *op = r.op();
    }
    x.deal.gold_cell = r.u8();
    for h in x.deal.hints.iter_mut().flatten() {
        *h = hint_from(r.u8());
    }
    for rig in x.rigs.iter_mut() {
        let v = r.u8();
        *rig = (v != 255).then_some(v);
    }
    for pk in x.peeks.iter_mut() {
        let cell = r.u8();
        let op = r.op();
        let gold = r.u8() != 0;
        *pk = (cell != 255).then_some(Peek { cell, op, gold });
    }
}

fn decode_side(r: &mut R<'_>, s: &mut PublicSide) {
    s.hp = r.u32();
    s.cannon_x = r.i16();
    s.aim = r.i16();
    s.cohort_len = r.u8();
    s.rig_used = r.u8() != 0;
    s.peek_used = r.u8() != 0;
    for g in s.gates.iter_mut() {
        let hint = hint_from(r.u8());
        let gold = r.u8() != 0;
        let kind = r.u8();
        let val = r.u8();
        *g = PublicGate {
            hint,
            gold,
            revealed: (kind != 255).then(|| op_from(kind, val)),
        };
    }
    for c in s.cohorts.iter_mut() {
        *c = Cohort {
            id: r.u32(),
            count: r.u32(),
            x: r.i16(),
            y: r.i16(),
            age: r.u8(),
            last_row: r.u8(),
        };
    }
}

/// A blank state to decode into (any valid state works; every field is overwritten).
pub fn blank() -> MatchState {
    MatchState::new(0, MatchOptions::default())
}

/// Worst case for `step` (TECH §7 extra b): 40 live cohorts per side, every pair already within
/// reach in y (so the clash loop visits all 1,600 pairs each tick) but in far-apart columns (so
/// nobody dies), past every gate row, cruising, and nowhere near a cannon for ~56 ticks.
pub fn worst_case(seed: u64) -> MatchState {
    let mut m = MatchState::new(
        seed,
        MatchOptions {
            stake: 1_000_000,
            bot: [true, true],
            tutorial: false,
        },
    );
    m.public.tick = 100; // phase 0, playing
    m.secret.deal = Deal::new(seed, 0);
    let mut id = 1u32;
    for (s, side) in m.public.sides.iter_mut().enumerate() {
        let x: i16 = if s == 0 { 150 } else { 2_850 };
        for (i, c) in side.cohorts.iter_mut().enumerate() {
            let i16_i = i16::try_from(i).unwrap_or(0);
            *c = Cohort {
                id,
                count: 40,
                x,
                y: 6_390_i16.saturating_sub(i16_i.saturating_mul(10)),
                age: 50,
                last_row: 3,
            };
            id = id.saturating_add(1);
        }
        side.cohort_len = COHORT_CAP as u8;
        side.cannon_x = x;
        side.aim = x;
    }
    m.public.next_cohort_id = id;
    m
}
