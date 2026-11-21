//! One-shot things that happen during a tick, for effects and sound. Events only ever carry
//! public information. They are not state: dropping one never changes the match.

use crate::payout::MatchResult;
use crate::types::GateOp;

/// Mirrors `MatchEvent` in packages/client/src/types.ts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    /// A cannon fired a cohort (SPEC §6).
    Volley {
        side: u8,
        cohort_id: u32,
        x: i16,
        count: u32,
    },
    /// A gate on `side`'s grid flipped face-up (SPEC §4). `op` is what the cohort got.
    Reveal {
        side: u8,
        cell: u8,
        op: GateOp,
        gold: bool,
    },
    /// A cohort passed a gate and its count changed from `before` to `after` (SPEC §4).
    Gate {
        side: u8,
        cell: u8,
        cohort_id: u32,
        before: u32,
        after: u32,
    },
    /// `side`'s stream hit the trap that `rigged_by` planted (SPEC §5).
    Gotcha { side: u8, cell: u8, rigged_by: u8 },
    /// Two opposing cohorts met and subtracted (SPEC §6). `y` is measured from side 0's cannon;
    /// `killed[s]` = units side `s` lost.
    Clash { x: i16, y: i16, killed: [u32; 2] },
    /// `side`'s cannon was hit for `damage` and has `hp` left (SPEC §6).
    Hit { side: u8, damage: u32, hp: u32 },
    /// A plant window started (SPEC §3).
    Plant { phase: u8 },
    /// All 18 gates were replaced with a fresh deal (SPEC §3).
    Redeal { phase: u8 },
    /// Fire rate doubled (SPEC §3).
    Surge,
    /// KO or timer (SPEC §7).
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

/// Enough for any realistic tick (≈2 volleys, a few gates, clashes and hits). Extra events are
/// dropped and counted, never stored past the end.
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
            buf: [Event::Surge; N],
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
        ev.push(Event::Surge);
        ev.push(Event::Plant { phase: 1 });
        ev.push(Event::Redeal { phase: 1 });
        assert_eq!(ev.as_slice(), &[Event::Surge, Event::Plant { phase: 1 }]);
        assert_eq!(ev.dropped(), 1);
        ev.clear();
        assert!(ev.as_slice().is_empty());
        assert_eq!(ev.dropped(), 0);
    }
}
