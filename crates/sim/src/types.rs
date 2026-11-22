//! Core value types. Small and fixed-size so they map onto the Match account.

/// What a gate does to a cohort of `c` units (SPEC §6, integer only).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GateOp {
    /// c · k (saturating)
    Mul(u8),
    /// floor(c / k): the trap
    Div(u8),
}

impl GateOp {
    // SPEC §6: `×k → c·k`, `÷k → floor(c/k)`.
    pub fn apply(self, c: u32) -> u32 {
        match self {
            GateOp::Mul(k) => c.saturating_mul(u32::from(k)),
            GateOp::Div(k) => c.checked_div(u32::from(k)).unwrap_or(0),
        }
    }

    /// `(kind, value)` with kind 0 = mul, 1 = div.
    pub fn code(self) -> (u8, u8) {
        match self {
            GateOp::Mul(k) => (0, k),
            GateOp::Div(k) => (1, k),
        }
    }

    /// One byte: `k` for ×k, `0x80 | k` for ÷k (k < 128). 0 is free for "none".
    pub fn to_byte(self) -> u8 {
        match self {
            GateOp::Mul(k) => k & 0x7F,
            GateOp::Div(k) => 0x80 | (k & 0x7F),
        }
    }

    pub fn from_byte(b: u8) -> Self {
        if b & 0x80 != 0 {
            GateOp::Div(b & 0x7F)
        } else {
            GateOp::Mul(b)
        }
    }

    /// Signed form for JS: `+k` for ×k, `−k` for ÷k.
    pub fn signed(self) -> i32 {
        match self {
            GateOp::Mul(k) => i32::from(k),
            GateOp::Div(k) => i32::from(k).saturating_neg(),
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
    /// 3 s: gates face-down, cannon holds fire (rig allowed, as in every phase but Done).
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
        // SPEC §6
        assert_eq!(GateOp::Mul(3).apply(5), 15);
        assert_eq!(GateOp::Div(2).apply(5), 2);
        assert_eq!(GateOp::Div(2).apply(1), 0);
        assert_eq!(GateOp::Div(0).apply(8), 0);
        assert_eq!(GateOp::Mul(10).apply(u32::MAX), u32::MAX);
    }

    #[test]
    fn op_byte_roundtrip() {
        for k in 0..128u8 {
            for op in [GateOp::Mul(k), GateOp::Div(k)] {
                assert_eq!(GateOp::from_byte(op.to_byte()), op);
            }
        }
        assert_eq!(GateOp::Div(2).signed(), -2);
        assert_eq!(GateOp::Mul(8).signed(), 8);
    }

    #[test]
    fn phase_codes_roundtrip() {
        for c in 0..5 {
            assert_eq!(Phase::from_code(c).code(), c);
        }
        assert!(Phase::Fight.active() && Phase::Raid.active() && !Phase::Plant.active());
    }
}
