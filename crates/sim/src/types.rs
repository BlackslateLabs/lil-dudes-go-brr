//! Core state types. Layout is kept small and fixed-size so it maps onto the Match account.

/// What a gate does to a cohort of `c` units.
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
    pub fn apply(self, c: u32) -> u32 {
        match self {
            GateOp::Mul(k) => c.saturating_mul(k as u32),
            GateOp::Add(n) => c.saturating_add(n as u32),
            GateOp::Sub(n) => c.saturating_sub(n as u32),
            GateOp::Div(k) => c / (k.max(1) as u32),
        }
    }
}

/// Public hint on an unrevealed gate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hint {
    None,
    Good,
    Bad,
    Gold,
}

/// A group of units moving together.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Cohort {
    pub id: u32,
    pub count: u32,
    /// Lane position, 0..LANE_WIDTH.
    pub x: i16,
    /// Distance from its own cannon toward the enemy cannon, in sim units (0..=LANE_LENGTH).
    pub y: i16,
    pub age: u8,
    /// Last gate row passed (0 = none yet, 1..=3).
    pub last_row: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn op_semantics_match_spec() {
        assert_eq!(GateOp::Mul(3).apply(5), 15);
        assert_eq!(GateOp::Add(6).apply(5), 11);
        assert_eq!(GateOp::Sub(6).apply(5), 0);
        assert_eq!(GateOp::Div(2).apply(5), 2);
    }
}
