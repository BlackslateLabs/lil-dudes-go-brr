//! Accounts and constants (docs/TECH.md §4).
//!
//! Per match `id`, all created on the base layer by `create_match`:
//! - `Match`    public; delegated to the TEE. Header + the sim's public state (codec bytes).
//! - `Secrets`  private (ephemeral permission, no members) once `init_permissions` ran; delegated.
//!   VRF output, both players' salts, the sim's secret state (seed, every stage's true gate
//!   values, the Scout history).
//! - `Peek[s]`  private (member = side s's burner); delegated. That player's own Scout result in
//!   their current stage.
//! - `Vault`    system-owned PDA on the base layer, never delegated: both stakes until settled.
use anchor_lang::prelude::*;
use lil_dudes_sim::{PUBLIC_LEN, SECRET_LEN};

pub const MATCH_SEED: &[u8] = b"match";
pub const SECRETS_SEED: &[u8] = b"secrets";
pub const PEEK_SEED: &[u8] = b"peek";
pub const VAULT_SEED: &[u8] = b"vault";

/// Stake tiers in lamports (MVP §2): Free, 0.05, 0.1, 0.25 devnet SOL.
pub const STAKE_TIERS: [u64; 4] = [0, 50_000_000, 100_000_000, 250_000_000];

/// TECH §4: 1 tick = 5 ER slots (~50 ms on the TEE's ~10 ms slots).
pub const SLOTS_PER_TICK: u64 = 5;
/// Catch-up cap per tx (TECH §4, re-measured in M3: worst tick 38k CU, codec 6k). The crank gets
/// 400k CU per call; player txs run with the default 200k.
pub const CRANK_CATCH_UP: u32 = 8;
pub const PLAYER_CATCH_UP: u32 = 2;
/// Crank: one `advance` every 50 ms of wall time. The tick follows ER slots, so if slots run
/// slower than 10 ms a match outlasts MATCH_TICKS crank runs: schedule 1.5× (covers slots up to
/// 15 ms; later runs are cheap no-ops, and anyone can still `advance` by hand). Rules v4 (as
/// v3, v5): MATCH_TICKS = 3,600 (the 3:00 cap), so 5,400 runs. Only the match length matters
/// here, not the stage count (the Rush runs in place at the end of stage 1).
pub const CRANK_INTERVAL_MS: i64 = 50;
pub const CRANK_ITERATIONS: i64 = lil_dudes_sim::MATCH_TICKS as i64 * 3 / 2;
const _: () = assert!(CRANK_ITERATIONS == 5_400);
/// A match that has not started this long after its permissions were made can be aborted
/// (everyone refunded), ~60 s of 10 ms slots.
pub const ABORT_SLOTS: u64 = 6_000;
/// The VRF request may be repeated if no callback arrived after this many slots (~3 s).
pub const SEED_RETRY_SLOTS: u64 = 300;
/// Base layer: either player may cancel a joined but never delegated match after this long.
pub const JOIN_TIMEOUT_SECS: i64 = 60;
/// Refunds nobody has to be around for (MVP §4): the payees are fixed in the Match, so after a
/// longer wait ANYONE may trigger them (the server's sweeper does). An abandoned open room
/// (refund to the creator), a join that was never delegated (both refunded), and a delegated
/// match that never started (both refunded, ~5 min of 10 ms slots).
pub const OPEN_ANYONE_SECS: i64 = 20 * 60;
pub const JOIN_ANYONE_SECS: i64 = 5 * 60;
pub const ABORT_ANYONE_SLOTS: u64 = 30_000;

/// Peek fields: no stage written yet / no Scout.
pub const NONE: u8 = u8::MAX;

/// Published at `finish`: the codec's history part (2 stages × 2 sides × 2 bytes = 8).
pub const HISTORY_LEN: usize = lil_dudes_sim::codec::HISTORY_LEN;

/// The deployed program only ever delegates to MagicBlock's devnet TEE validator: privacy of
/// Secrets/Peek depends on it (a match on a public ER would expose everything).
pub const TEE_VALIDATOR: Pubkey = pubkey!("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");

/// Fees (SPEC_V5 §7, 5% of the money moved) go here: the deploy wallet on devnet.
#[cfg(not(feature = "magicsvm"))]
pub const TREASURY: Pubkey = pubkey!("FdZLtcw7CMAHk2bsnqesxcYj3Ybjgux3GcqtDy63rfbB");
/// Test build (feature "magicsvm"): a fixed address the tests fund.
#[cfg(feature = "magicsvm")]
pub const TREASURY: Pubkey = Pubkey::new_from_array([7; 32]);

/// `Match.status`.
pub mod status {
    /// Base: created, waiting for player B.
    pub const OPEN: u8 = 0;
    /// Base: both players in; next `delegate_match`, then `init_permissions` on the TEE.
    pub const JOINED: u8 = 1;
    /// TEE: Secrets and Peek are private; next both `request_seed` (salts), then the VRF callback.
    pub const READY: u8 = 2;
    /// TEE: the seed is in Secrets and the initial state is written; next `start`.
    pub const SEEDED: u8 = 3;
    /// TEE: the crank drives `advance`; the result appears in the state at the end.
    pub const PLAYING: u8 = 4;
    /// TEE → base: final (or aborted), seed + history published, committed and undelegated.
    pub const FINISHED: u8 = 5;
    /// Base: paid out by the fallback `settle` (the Magic Action can't write the Match).
    pub const SETTLED: u8 = 6;
}

/// `Match.flags`.
pub mod flags {
    /// Side 0's / side 1's salt is in Secrets.
    pub const SALT0: u8 = 1;
    pub const SALT1: u8 = 2;
    pub const SEED_REQUESTED: u8 = 4;
    /// Finished without a result (never started): everyone gets their stake back.
    pub const ABORTED: u8 = 8;
}

#[account(zero_copy)]
#[repr(C)]
pub struct Match {
    pub id: u64,
    /// Matched stake S in lamports (0 = free). Each player escrows S.
    pub stake: u64,
    /// What each player picked before matching (A's excess is refunded at join).
    pub picks: [u64; 2],
    /// Base-layer unix time of create / join (cancel timeouts).
    pub created_at: i64,
    pub joined_at: i64,
    /// TEE slot when the permissions were made (abort timeout), when the VRF was last requested,
    /// and of tick 0 (0 = not started).
    pub ready_slot: u64,
    pub seed_req_slot: u64,
    pub start_slot: u64,
    /// The VRF seed, published at `finish` (0 until then).
    pub seed: u64,
    /// Wallets that paid the stakes and receive the payout.
    pub players: [Pubkey; 2],
    /// Per-device burner keys that sign on the TEE (they need no SOL there).
    pub burners: [Pubkey; 2],
    pub treasury: Pubkey,
    /// Display names, UTF-8, zero-padded.
    pub names: [[u8; 16]; 2],
    pub status: u8,
    pub flags: u8,
    pub rules_version: u8,
    pub vault_bump: u8,
    /// Bumps of Match, Secrets, Peek[0], Peek[1].
    pub bumps: [u8; 4],
    /// Rules v5: was the rig GOTCHA record (rigs are gone). Zero; kept so the offsets the TS
    /// decoder reads stay put.
    pub _reserved: [u8; 8],
    /// Published at `finish`: every stage's Scouts (codec history layout).
    pub history: [u8; HISTORY_LEN],
    /// Rules v5: the history shrank 16 → 8 bytes; 14 bytes here keep `state` at offset 310.
    pub _pad: [u8; 14],
    /// The sim's public state (crates/sim codec, PUBLIC part).
    pub state: [u8; PUBLIC_LEN],
    /// Rules v5: the public state grew 1,474 → 1,484; 6 bytes keep the struct a multiple of 8
    /// (Pod, no implicit padding).
    pub _tail: [u8; 6],
}

#[account(zero_copy)]
#[repr(C)]
pub struct Secrets {
    pub id: u64,
    /// Raw VRF output (the seed is H(vrf ‖ salt0 ‖ salt1), TECH §4 Randomness).
    pub vrf: [u8; 32],
    pub salts: [[u8; 32]; 2],
    /// The sim's secret state (crates/sim codec, SECRET part).
    pub state: [u8; SECRET_LEN],
}

/// One player's private view (the sim's `PrivateView`): their Scout during their current stage.
/// Rewritten from the sim after each of the owner's `peek_cell` and at `finish`; `stage` says
/// which stage it describes, so one whose `stage` is behind the side's public stage is stale
/// (nothing scouted in the new stage yet).
#[account(zero_copy)]
#[repr(C)]
pub struct Peek {
    pub id: u64,
    /// That side's burner (the permission member).
    pub owner: Pubkey,
    pub side: u8,
    /// The owner's stage when this was last written (NONE before the first write).
    pub stage: u8,
    /// Rules v5: was the rig (stage, slot). Always NONE; kept so the offsets stay put.
    pub _reserved: [u8; 2],
    /// The owner's Scout during that stage: its stage (NONE = none), gate slot and the true op
    /// (`GateOp::to_byte`: k = ×k, 0x40 | n = +n, 0x80 | k = ÷k, 0xC0 | n = −n).
    pub peek_stage: u8,
    pub peek_slot: u8,
    pub peek_op: u8,
    pub _pad: u8,
}

pub const MATCH_SPACE: usize = 8 + core::mem::size_of::<Match>();
pub const SECRETS_SPACE: usize = 8 + core::mem::size_of::<Secrets>();
pub const PEEK_SPACE: usize = 8 + core::mem::size_of::<Peek>();

const _: () = {
    assert!(core::mem::size_of::<Match>() == 1_800);
    assert!(core::mem::size_of::<Secrets>() == 136);
    assert!(core::mem::size_of::<Peek>() == 48);
    // Rules v5 codec sizes the layout below is built for.
    assert!(PUBLIC_LEN == 1_484);
    assert!(SECRET_LEN == 32);
    assert!(HISTORY_LEN == 8);
    // The history is the tail of the secret part (copied as-is at `finish`).
    assert!(SECRET_LEN - HISTORY_LEN == lil_dudes_sim::codec::S_HISTORY);
    // Fixed offsets the TS decoder reads (packages/client), after the 8-byte discriminator.
    assert!(core::mem::offset_of!(Match, _reserved) == 280);
    assert!(core::mem::offset_of!(Match, history) == 288);
    assert!(core::mem::offset_of!(Match, state) == 310);
    assert!(core::mem::offset_of!(Secrets, state) == 104);
    assert!(core::mem::offset_of!(Peek, stage) == 41);
    assert!(core::mem::offset_of!(Peek, _pad) == 47);
};

impl Match {
    /// Which side `key` plays (by burner).
    pub fn side_of_burner(&self, key: &Pubkey) -> Option<u8> {
        self.burners.iter().position(|b| b == key).map(|s| s as u8)
    }

    pub fn has(&self, flag: u8) -> bool {
        self.flags & flag != 0
    }
}

/// Crank task id for a match: task ids are global on validator 1.1.1, so derive one per match.
pub fn task_id(id: u64) -> i64 {
    let h = lil_dudes_sim::rng::mix64(id ^ 0x7A5C_0000_0000_0000);
    // Positive and non-zero.
    ((h >> 1) as i64).max(1)
}
