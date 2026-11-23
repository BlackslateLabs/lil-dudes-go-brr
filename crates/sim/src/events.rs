//! One-shot things that happen during a tick, for effects and sound. Events only ever carry
//! public information. They are not state: dropping one never changes the match.

use crate::payout::MatchResult;
use crate::types::{GateOp, Phase};

/// Mirrors `MatchEvent` in packages/client/src/types.ts. `side` is always the lane it happened in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    /// `side`'s cannon fired a cohort (SPEC §7); `champion`: a Champion (SPEC_V5 §4).
    Volley {
        side: u8,
        cohort_id: u32,
        x: i16,
        count: u32,
        champion: bool,
    },
    /// A cohort passed gate `slot` of `side`'s current stage: `before` → `after` (SPEC §6).
    /// `reveal`: this was the first pass, so the gate just flipped face-up showing `op`.
    Gate {
        side: u8,
        slot: u8,
        cohort_id: u32,
        op: GateOp,
        before: u32,
        after: u32,
        reveal: bool,
    },
    /// A crate absorbed `absorbed` dudes and has `hp` left (SPEC §4).
    CrateHit {
        side: u8,
        crate_ix: u8,
        cohort_id: u32,
        absorbed: u32,
        hp: u32,
    },
    /// A crate reached 0: the gate behind it is open (SPEC §4).
    CrateBroken { side: u8, crate_ix: u8 },
    /// Tower `tower` released a wave of `count` (SPEC §4). `merged`: the lane was at ENEMY_CAP,
    /// so it joined existing enemy cohort `enemy_id` instead of spawning.
    Wave {
        side: u8,
        tower: u8,
        enemy_id: u32,
        x: i16,
        count: u32,
        merged: bool,
    },
    /// A cohort of yours and an enemy cohort met and cancelled `killed` each (SPEC §4).
    Clash {
        side: u8,
        x: i16,
        y: i16,
        killed: u32,
    },
    /// A cohort hit tower `tower` for `damage` (SPEC §4); `hp` left, `gold` earned (SPEC §5).
    TowerHit {
        side: u8,
        tower: u8,
        damage: u32,
        hp: u32,
        gold: u32,
    },
    /// v6: tower `tower`'s turret hit cohort `cohort_id` at (`x`, `y`) and `killed` dudes.
    Shot {
        side: u8,
        tower: u8,
        cohort_id: u32,
        x: i16,
        y: i16,
        killed: u32,
    },
    /// Tower `tower` fell (v6: its points came with the hits; `gold` is 0).
    TowerDestroyed { side: u8, tower: u8, gold: u32 },
    /// A Rush cohort of `units` dudes reached the town hall for `gold` (SPEC_V5 §2).
    Loot {
        side: u8,
        cohort_id: u32,
        units: u32,
        gold: u32,
    },
    /// `side` cleared `stage` first (lower match tick) and scores `gold` = FIRST_BONUS
    /// (SPEC_V5 §6). Pushed on the tick of that breach.
    First { side: u8, stage: u8, gold: u32 },
    /// `side`'s Rush ran out: `lost` dudes still on the lane do not count (SPEC_V5 §2). The
    /// lane is cleared and `side` is Done.
    RushEnd { side: u8, lost: u32 },
    /// `side` entered `phase` of `stage` (SPEC §3). Transit already names the next stage.
    Phase { side: u8, stage: u8, phase: Phase },
    /// An enemy reached `side`'s cannon line (SPEC §4).
    Death { side: u8 },
    /// Death, both done, or the time cap (SPEC §3, §8).
    End { result: MatchResult },
}

/// Where `step` reports events. The program can pass `NoEvents`; the client uses `Events<N>`.
pub trait EventSink {
    fn push(&mut self, event: Event);
}

/// Discards every event (on-chain, balance runs).
pub struct NoEvents;

impl EventSink for NoEvents {
    fn push(&mut self, _event: Event) {}
}

/// Enough for any realistic tick (2 volleys, a few gates, waves, clashes and hits per lane).
/// Extra events are dropped and counted, never stored past the end.
pub const EVENT_CAP: usize = 256;

/// A fixed-capacity event buffer (no allocation).
#[derive(Clone, Debug)]
pub struct Events<const N: usize = EVENT_CAP> {
    buf: [Event; N],
    len: usize,
    dropped: u32,
}

impl<const N: usize> Events<N> {
    pub const fn new() -> Self {
        Self {
            buf: [Event::Death { side: 0 }; N],
            len: 0,
            dropped: 0,
        }
    }

    pub fn clear(&mut self) {
        self.len = 0;
        self.dropped = 0;
    }

    pub fn as_slice(&self) -> &[Event] {
        self.buf.get(..self.len).unwrap_or(&[])
    }

    /// Events that did not fit since the last `clear`.
    pub fn dropped(&self) -> u32 {
        self.dropped
    }
}

impl<const N: usize> Default for Events<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> EventSink for Events<N> {
    fn push(&mut self, event: Event) {
        match self.buf.get_mut(self.len) {
            Some(slot) => {
                *slot = event;
                self.len = self.len.saturating_add(1);
            }
            None => self.dropped = self.dropped.saturating_add(1),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffer_drops_past_capacity() {
        let mut ev = Events::<2>::new();
        ev.push(Event::Death { side: 1 });
        ev.push(Event::CrateBroken {
            side: 0,
            crate_ix: 1,
        });
        ev.push(Event::Death { side: 0 });
        assert_eq!(
            ev.as_slice(),
            &[
                Event::Death { side: 1 },
                Event::CrateBroken {
                    side: 0,
                    crate_ix: 1
                }
            ]
        );
        assert_eq!(ev.dropped(), 1);
        ev.clear();
        assert!(ev.as_slice().is_empty());
        assert_eq!(ev.dropped(), 0);
    }
}
