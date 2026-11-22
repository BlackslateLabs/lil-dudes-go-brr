//! Compute bench (TECH §4): the v3 codec (crates/sim) and the v3 tick on heavy states, in
//! MagicSVM. Needs the bench build of the program:
//!   cargo build-sbf --tools-version v1.52 --manifest-path programs/lil_dudes/Cargo.toml \
//!     --features bench --sbf-out-dir target/bench
//! Run: cargo +stable test --manifest-path tests-magicsvm/Cargo.toml --test bench -- --nocapture
//! (Rules v3 replaced the whole state, so the M2 spike build can no longer run the same states;
//! TECH §4 keeps its old numbers for reference.)

mod common;

use common::*;
use lil_dudes_sim::codec::{encode_public, encode_secret};
use lil_dudes_sim::rng::mix64;
use lil_dudes_sim::*;
use magicsvm::{MagicSVM, TransactionTarget};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;

const PROGRAM_ID: Address = Address::from_str_const("4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa");
const COMPUTE_BUDGET: Address =
    Address::from_str_const("ComputeBudget111111111111111111111111111111");

fn cu_limit(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction {
        program_id: COMPUTE_BUDGET,
        accounts: vec![],
        data,
    }
}

/// Both lanes full: COHORT_CAP cohorts of 40 past the gates (homing) and ENEMY_CAP enemy cohorts
/// of 40, interleaved in y (every pair crossed or about to), `dx` apart in x. With dx just over
/// CLASH_REACH nobody clashes on the first tick but every pair is checked; small dx clashes.
fn crowded(seed: u64, dx: i16) -> MatchState {
    let mut m = MatchState::new(
        seed,
        MatchOptions {
            stake: 1_000_000,
            bot: [true, true],
            tutorial: false,
        },
    );
    m.public.tick = 400;
    let rows = layouts::stage(m.public.layout, 0).rows.len() as u8;
    let mut id = 1u32;
    for side in m.public.sides.iter_mut() {
        side.phase = Phase::Fight;
        side.phase_ticks = 300;
        side.cannon_x = 1_000;
        side.aim = 1_000;
        // Oldest (front-most, highest y) first.
        for (i, c) in side.cohorts.iter_mut().enumerate() {
            *c = Cohort {
                id,
                count: 40,
                x: 1_000,
                y: 6_800 - (i as i16) * 20,
                age: 50,
                last_row: rows,
            };
            id += 1;
        }
        side.cohort_len = COHORT_CAP as u8;
        // Oldest (furthest down, lowest y) first.
        for (j, e) in side.enemies.iter_mut().enumerate() {
            *e = Enemy {
                id,
                count: 40,
                x: 1_000 + dx,
                y: 5_800 + (j as i16) * 60,
                tower: 0,
            };
            id += 1;
        }
        side.enemy_len = ENEMY_CAP as u8;
    }
    m.public.next_cohort_id = id;
    m
}

/// The busiest tick (most live cohorts + enemy cohorts) of a real bot-vs-bot match.
fn busiest(seed: u64) -> MatchState {
    let mut m = MatchState::new(seed, MatchOptions::default());
    let mut bots = [
        Warlord::new(0, mix64(seed ^ 1)),
        Warlord::new(1, mix64(seed ^ 2)),
    ];
    let mut best = (0usize, m);
    while m.public.result.is_none() {
        let inputs = Inputs {
            sides: [bots[0].decide(&m.public), bots[1].decide(&m.public)],
        };
        step(&mut m, &inputs, &mut NoEvents);
        let live: usize = m
            .public
            .sides
            .iter()
            .map(|s| usize::from(s.cohort_len) + usize::from(s.enemy_len))
            .sum();
        if live > best.0 {
            best = (live, m);
        }
    }
    best.1
}

fn bench_bytes(m: &MatchState) -> Vec<u8> {
    let mut p = [0u8; PUBLIC_LEN];
    let mut s = [0u8; SECRET_LEN];
    encode_public(&m.public, &mut p);
    encode_secret(&m.secret, &mut s);
    [p.as_slice(), s.as_slice()].concat()
}

struct Bench {
    svm: MagicSVM,
    payer: Keypair,
    acc: Address,
}

impl Bench {
    fn new() -> Self {
        let mut svm = MagicSVM::new();
        svm.add_program_from_file(PROGRAM_ID, repo().join("target/bench/lil_dudes.so"))
            .expect("build the bench program first (see the header of this file)");
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
        Self {
            svm,
            payer,
            acc: Address::new_unique(),
        }
    }

    /// CU phases: [zeroed, decode public, decode secret, n ticks, encode public, encode
    /// secret]; None if the tx failed (over budget).
    fn run(&mut self, m: &MatchState, n: u16, bot: bool) -> Option<Vec<u64>> {
        self.svm
            .set_account(
                self.acc,
                Account {
                    lamports: 1_000_000_000,
                    data: bench_bytes(m),
                    owner: PROGRAM_ID,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
        let mut args = n.to_le_bytes().to_vec();
        args.push(u8::from(bot));
        let bench = ix(
            PROGRAM_ID,
            "bench",
            &args,
            vec![AccountMeta::new(self.acc, false)],
        );
        self.svm.expire_blockhash_for(TransactionTarget::Base);
        let payer = self.payer.insecure_clone();
        match send(
            &mut self.svm,
            TransactionTarget::Base,
            &[cu_limit(1_400_000), bench],
            &[&payer],
        ) {
            Ok(logs) => Some(cu_phases(&logs)),
            Err((e, logs)) => {
                println!("n={n} failed: {e}\n{}", logs.join("\n"));
                None
            }
        }
    }
}

/// Largest n with fixed + n·per_tick ≤ budget.
fn ticks_in(budget: u64, fixed: u64, per_tick: u64) -> u64 {
    budget.saturating_sub(fixed) / per_tick.max(1)
}

#[test]
fn codec_and_tick_compute() {
    let mut b = Bench::new();
    let states = [
        (
            "full lanes, crossed, dx 450 (checked, no clash yet)",
            crowded(7, 450),
        ),
        ("full lanes, crossed, dx 200 (clashing)", crowded(7, 200)),
        ("busiest tick of a bot match", busiest(11)),
    ];
    println!();
    for (name, m) in &states {
        let live: Vec<[u8; 2]> = m
            .public
            .sides
            .iter()
            .map(|s| [s.cohort_len, s.enemy_len])
            .collect();
        let zero = b.run(m, 0, true).expect("n=0");
        let five = b.run(m, 5, true).expect("n=5");
        let five_nobot = b.run(m, 5, false).expect("n=5 no bot");
        let codec = zero[0] + zero[1] + zero[2] + zero[4] + zero[5];
        let tick = five[3] / 5;
        println!("{name}: [cohorts, enemies] per side {live:?}");
        println!(
            "  codec {codec:>6} CU (zeroed {} + dec pub {} + dec sec {} + enc pub {} + enc sec {})",
            zero[0], zero[1], zero[2], zero[4], zero[5]
        );
        println!(
            "  tick  {tick:>6} CU/tick (bots on), {:>6} (no bots)",
            five_nobot[3] / 5
        );
        println!(
            "  ticks per tx (fixed ≈ codec + 6k Anchor): 200k → {}, 400k → {}, 1.4M → {}",
            ticks_in(200_000, codec + 6_000, tick),
            ticks_in(400_000, codec + 6_000, tick),
            ticks_in(1_400_000, codec + 6_000, tick),
        );
    }
}
