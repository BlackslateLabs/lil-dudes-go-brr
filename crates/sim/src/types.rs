//! Core value types. Layout is small and fixed-size so it maps onto the Match account.

/// What a gate does to a cohort of `c` units (SPEC §4, integer only).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GateOp {
    /// c * k
    Mul(u8),
    /// c + n
    Add(u8),
    /// max(0, c - n)
    Sub(u8),
    /// floor(c / k)
    Div(u8),
}

impl GateOp {
    // SPEC §4: `×k → c·k`, `+n → c+n`, `−n → max(0, c−n)`, `÷k → floor(c/k)`.
    pub fn apply(self, c: u32) -> u32 {
        match self {
            GateOp::Mul(k) => c.saturating_mul(u32::from(k)),
            GateOp::Add(n) => c.saturating_add(u32::from(n)),
            GateOp::Sub(n) => c.saturating_sub(u32::from(n)),
            GateOp::Div(k) => c.checked_div(u32::from(k)).unwrap_or(0),
        }
    }

    /// Blue (good) vs red (bad) for hints (SPEC §4).
    pub fn is_good(self) -> bool {
        matches!(self, GateOp::Mul(_) | GateOp::Add(_))
    }

    /// `(kind, value)` with kind 0 = mul, 1 = add, 2 = sub, 3 = div (digest and WASM encoding).
    pub fn code(self) -> (u8, u8) {
        match self {
            GateOp::Mul(k) => (0, k),
            GateOp::Add(n) => (1, n),
            GateOp::Sub(n) => (2, n),
            GateOp::Div(k) => (3, k),
        }
    }
}

/// Public hint on an unrevealed gate (SPEC §4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hint {
    /// Grey: no colour shown (also every non-gold gate during a plant window).
    None,
    /// Blue. A rigged gate shows a fake `Good`.
    Good,
    /// Red.
    Bad,
    /// Gold always shows gold.
    Gold,
}

impl Hint {
    /// 0 = none, 1 = good, 2 = bad, 3 = gold (digest and WASM encoding).
    pub fn code(self) -> u8 {
        match self {
            Hint::None => 0,
            Hint::Good => 1,
            Hint::Bad => 2,
            Hint::Gold => 3,
        }
    }
}

/// A group of units moving together (SPEC §6).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Cohort {
    /// Stable for the cohort's life, so the renderer can track it.
    pub id: u32,
    pub count: u32,
    /// Absolute lane position (side 0's view), 0..LANE_WIDTH.
    pub x: i16,
    /// Distance from its own cannon toward the enemy cannon (0..=LANE_LENGTH).
    pub y: i16,
    /// Ticks since it was fired (saturates at 255).
    pub age: u8,
    /// Gate rows already passed (0 = none yet, ROWS = all). A row applies once per cohort.
    pub last_row: u8,
}

/// Where a match is in its timeline (SPEC §3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// 3 s at the start of each phase: cannons hold fire, rigs can be planted.
    Plant,
    Playing,
    Ended,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn op_semantics_match_spec() {
        // SPEC §4
        assert_eq!(GateOp::Mul(3).apply(5), 15);
        assert_eq!(GateOp::Add(6).apply(5), 11);
        assert_eq!(GateOp::Sub(6).apply(5), 0);
        assert_eq!(GateOp::Sub(6).apply(10), 4);
        assert_eq!(GateOp::Div(2).apply(5), 2);
        assert_eq!(GateOp::Div(3).apply(8), 2);
        assert_eq!(GateOp::Div(0).apply(8), 0);
        assert_eq!(GateOp::Mul(3).apply(u32::MAX), u32::MAX);
    }

    #[test]
    fn good_and_bad() {
        assert!(GateOp::Mul(2).is_good() && GateOp::Add(6).is_good());
        assert!(!GateOp::Sub(6).is_good() && !GateOp::Div(2).is_good());
    }
}
