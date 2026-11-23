//! Core value types. Small and fixed-size so they map onto the Match account.

/// What a gate does to a cohort of `c` units (SPEC §6, SPEC_V5 §3; integer only, saturating).
/// A cohort brought to 0 dies.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum GateOp {
    /// c · k
    Mul(u8),
    /// floor(c / k)
    Div(u8),
    /// c + n
    Add(u8),
    /// max(0, c − n)
    Sub(u8),
}

/// Op byte kinds (the top two bits); the value sits in the low six bits.
const OP_MUL: u8 = 0x00;
const OP_ADD: u8 = 0x40;
const OP_DIV: u8 = 0x80;
const OP_SUB: u8 = 0xC0;
const OP_KIND: u8 = 0xC0;
const OP_VALUE: u8 = 0x3F;

impl GateOp {
    // SPEC_V5 §3: `×k: c·k` · `÷k: floor(c/k)` · `+N: c+N` · `−N: max(0, c−N)`.
    pub fn apply(self, c: u32) -> u32 {
        match self {
            GateOp::Mul(k) => c.saturating_mul(u32::from(k)),
            GateOp::Div(k) => c.checked_div(u32::from(k)).unwrap_or(0),
            GateOp::Add(n) => c.saturating_add(u32::from(n)),
            GateOp::Sub(n) => c.saturating_sub(u32::from(n)),
        }
    }

    /// `(kind, value)` with kind 0 = mul, 1 = div, 2 = add, 3 = sub.
    pub fn code(self) -> (u8, u8) {
        match self {
            GateOp::Mul(k) => (0, k),
            GateOp::Div(k) => (1, k),
            GateOp::Add(n) => (2, n),
            GateOp::Sub(n) => (3, n),
        }
    }

    /// Hurts the cohort (÷k or −N): a "bad" gate for the reveal sting.
    pub fn bad(self) -> bool {
        matches!(self, GateOp::Div(_) | GateOp::Sub(_))
    }

    /// One byte (codec, WASM, deals): the kind in the top two bits, the value (< 64) below:
    /// `k` = ×k, `0x40 | n` = +n, `0x80 | k` = ÷k, `0xC0 | n` = −n. 0 is free for "none"
    /// (face-down), since no gate is ×0.
    pub fn to_byte(self) -> u8 {
        match self {
            GateOp::Mul(k) => OP_MUL | (k & OP_VALUE),
            GateOp::Add(n) => OP_ADD | (n & OP_VALUE),
            GateOp::Div(k) => OP_DIV | (k & OP_VALUE),
            GateOp::Sub(n) => OP_SUB | (n & OP_VALUE),
        }
    }

    pub fn from_byte(b: u8) -> Self {
        let v = b & OP_VALUE;
        match b & OP_KIND {
            OP_ADD => GateOp::Add(v),
            OP_DIV => GateOp::Div(v),
            OP_SUB => GateOp::Sub(v),
            _ => GateOp::Mul(v),
        }
    }
}

/// A group of your dudes moving up the lane together (SPEC §7).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Cohort {
    /// Stable for the cohort's life, so the renderer can track it.
    pub id: u32,
    pub count: u32,
    /// 0..LANE_WIDTH.
    pub x: i16,
    /// Distance from the cannon line (0..LANE_LENGTH).
    pub y: i16,
    /// Ticks since it was fired (saturates at 255).
    pub age: u8,
    /// Gate rows of the stage already passed. A row applies once per cohort (SPEC §6).
    pub last_row: u8,
}

/// An enemy troop cohort walking down toward the cannon line (SPEC §4).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Enemy {
    pub id: u32,
    pub count: u32,
    pub x: i16,
    /// Distance from the cannon line; reaching ≤ 0 kills (SPEC §4).
    pub y: i16,
    /// The tower that released it (wave merging, SPEC §7).
    pub tower: u8,
}

/// Where one player is inside the current stage (SPEC §3).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Phase {
    /// 3 s: gates face-down, cannon holds fire.
    #[default]
    Plant,
    /// Until every tower is down: firing, waves, peek allowed.
    Fight,
    /// 2 s: field wiped, the next stage's gates are already in place.
    Transit,
    /// The final stage after its last tower fell: the town hall raid, started in place (no
    /// wipe). Fire for RAID_TICKS more, then wait until no dudes of yours are left.
    Raid,
    /// The raid is over (the lane is empty): waiting for the match to end.
    Done,
}

impl Phase {
    /// 0 plant, 1 fight, 2 transit, 3 raid, 4 done (codec and WASM encoding).
    pub fn code(self) -> u8 {
        match self {
            Phase::Plant => 0,
            Phase::Fight => 1,
            Phase::Transit => 2,
            Phase::Raid => 3,
            Phase::Done => 4,
        }
    }

    pub fn from_code(c: u8) -> Self {
        match c {
            1 => Phase::Fight,
            2 => Phase::Transit,
            3 => Phase::Raid,
            4 => Phase::Done,
            _ => Phase::Plant,
        }
    }

    /// Cannon firing / units moving (Fight, Raid).
    pub fn active(self) -> bool {
        matches!(self, Phase::Fight | Phase::Raid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn op_semantics_match_spec() {
        // SPEC_V5 §3
        assert_eq!(GateOp::Mul(3).apply(5), 15);
        assert_eq!(GateOp::Div(2).apply(5), 2);
        assert_eq!(GateOp::Div(2).apply(1), 0);
        assert_eq!(GateOp::Div(3).apply(8), 2);
        assert_eq!(GateOp::Div(0).apply(8), 0);
        assert_eq!(GateOp::Mul(10).apply(u32::MAX), u32::MAX);
        assert_eq!(GateOp::Add(15).apply(4), 19);
        assert_eq!(GateOp::Add(30).apply(u32::MAX), u32::MAX);
        assert_eq!(GateOp::Sub(5).apply(9), 4);
        assert_eq!(GateOp::Sub(30).apply(9), 0);
        assert!(GateOp::Sub(5).bad() && GateOp::Div(2).bad());
        assert!(!GateOp::Add(5).bad() && !GateOp::Mul(2).bad());
    }

    #[test]
    fn op_byte_roundtrip() {
        for k in 0..64u8 {
            for op in [
                GateOp::Mul(k),
                GateOp::Div(k),
                GateOp::Add(k),
                GateOp::Sub(k),
            ] {
                assert_eq!(GateOp::from_byte(op.to_byte()), op);
            }
        }
        // v4 bytes keep their meaning (×k = k, ÷k = 0x80 | k).
        assert_eq!(GateOp::Mul(8).to_byte(), 8);
        assert_eq!(GateOp::Div(2).to_byte(), 0x82);
        assert_eq!(GateOp::Add(5).to_byte(), 0x45);
        assert_eq!(GateOp::Sub(30).to_byte(), 0xDE);
        assert!((1..=255u8).all(|b| GateOp::from_byte(b).to_byte() == b));
    }

    #[test]
    fn phase_codes_roundtrip() {
        for c in 0..5 {
            assert_eq!(Phase::from_code(c).code(), c);
        }
        assert!(Phase::Fight.active() && Phase::Raid.active() && !Phase::Plant.active());
    }
}
