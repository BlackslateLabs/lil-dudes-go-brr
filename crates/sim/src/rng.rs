//! Deterministic randomness. The only entropy is the match seed (VRF on-chain) and, for the bot,
//! its own seed. SplitMix64 is small, fast, integer-only and well distributed.

/// SplitMix64 finaliser: a bijective 64-bit mix.
pub const fn mix64(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub const fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        mix64(self.state)
    }

    /// Uniform in `0..n` (multiply-shift; bias < n / 2^64). Returns 0 when `n == 0`.
    pub fn below(&mut self, n: u64) -> u64 {
        let wide = u128::from(self.next_u64()).wrapping_mul(u128::from(n));
        (wide >> 64) as u64
    }

    /// Uniform in `lo..=hi` (returns `lo` if `hi < lo`).
    pub fn range_inclusive(&mut self, lo: u32, hi: u32) -> u32 {
        let span = u64::from(hi.saturating_sub(lo)).saturating_add(1);
        lo.saturating_add(self.below(span) as u32)
    }
}

/// The RNG for the gate values of stage `stage` (SPEC §6: dealt per stage from the VRF seed;
/// TECH §4: values = f(seed, stage)).
pub const fn deal_rng(seed: u64, stage: u8) -> SplitMix64 {
    SplitMix64::new(mix64(seed ^ mix64(stage as u64 + 1)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitmix_reference_values() {
        // Reference outputs of SplitMix64 seeded with 0 (Vigna's reference implementation).
        let mut r = SplitMix64::new(0);
        assert_eq!(r.next_u64(), 0xE220_A839_7B1D_CDAF);
        assert_eq!(r.next_u64(), 0x6E78_9E6A_A1B9_65F4);
    }

    #[test]
    fn below_stays_in_range() {
        let mut r = SplitMix64::new(42);
        for n in 1..50u64 {
            for _ in 0..200 {
                assert!(r.below(n) < n);
            }
        }
        assert_eq!(r.below(0), 0);
        for _ in 0..1000 {
            let v = r.range_inclusive(20, 60);
            assert!((20..=60).contains(&v));
        }
    }

    #[test]
    fn deal_rngs_differ_by_stage() {
        let a = deal_rng(7, 0).next_u64();
        let b = deal_rng(7, 1).next_u64();
        let c = deal_rng(8, 0).next_u64();
        assert_ne!(a, b);
        assert_ne!(a, c);
    }
}
