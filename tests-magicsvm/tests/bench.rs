//! Compute bench (TECH §4): the new codec (crates/sim) + bucketed clash vs M2's spike build, on
//! the same worst-case states, in MagicSVM. Needs the bench build of the program:
//!   cargo build-sbf --tools-version v1.52 --manifest-path programs/lil_dudes/Cargo.toml \
//!     --features bench --sbf-out-dir target/bench
//! Run: cargo +stable test --manifest-path tests-magicsvm/Cargo.toml --test bench -- --nocapture

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

const NEW_ID: Address = Address::from_str_const("4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa");
const OLD_ID: Address = Address::from_str_const("7BE2WwiCdz8SHMagZ3YSGWrhJhYwh3HZ9MQSWT277HGM");
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

/// M2's bench state (spike codec.rs `worst_case`): 40 v 40, every pair crossed in y, far apart
/// in x (nobody dies), cruising past the gates.
fn m2_worst(seed: u64, x0: i16, x1: i16) -> MatchState {
    let mut m = MatchState::new(
        seed,
        MatchOptions {
            stake: 1_000_000,
            bot: [true, true],
            tutorial: false,
        },
    );
    m.public.tick = 100;
    m.secret.deal = Deal::new(seed, 0);
    let mut id = 1u32;
    for (s, side) in m.public.sides.iter_mut().enumerate() {
        let x = if s == 0 { x0 } else { x1 };
        for (i, c) in side.cohorts.iter_mut().enumerate() {
            *c = Cohort {
                id,
                count: 40,
                x,
                y: 6_390 - (i as i16) * 10,
                age: 50,
                last_row: 3,
            };
            id += 1;
        }
        side.cohort_len = COHORT_CAP as u8;
        side.cannon_x = x;
        side.aim = x;
    }
    m.public.next_cohort_id = id;
    m
}

/// The busiest tick (most live cohorts) of a real bot-vs-bot match, in Surge.
fn surge_peak(seed: u64) -> MatchState {
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
        let live: usize = m.public.sides.iter().map(|s| s.cohort_len as usize).sum();
        if live > best.0 {
            best = (live, m);
        }
    }
    best.1
}

fn new_bytes(m: &MatchState) -> Vec<u8> {
    let mut p = [0u8; PUBLIC_LEN];
    let mut s = [0u8; SECRET_LEN];
    encode_public(&m.public, &mut p);
    encode_secret(&m.secret, &mut s);
    [p.as_slice(), s.as_slice()].concat()
}

/// M2's spike layout (spike codec.rs, 1,307 B) inside its zero-copy `Bench { id, state[1312] }`.
fn old_bytes(m: &MatchState, id: u64) -> Vec<u8> {
    let mut w: Vec<u8> = Vec::new();
    let p = &m.public;
    w.extend(p.tick.to_le_bytes());
    w.extend(p.options.stake.to_le_bytes());
    w.extend([
        u8::from(p.options.bot[0]),
        u8::from(p.options.bot[1]),
        u8::from(p.options.tutorial),
    ]);
    w.extend(p.next_cohort_id.to_le_bytes());
    match p.result {
        None => {
            w.extend([0, 2, 0]);
            w.extend([0u8; 16]);
        }
        Some(r) => {
            w.extend([1, r.winner.unwrap_or(2), u8::from(r.ko)]);
            w.extend(r.moved.to_le_bytes());
            w.extend(r.fee.to_le_bytes());
        }
    }
    for s in &p.sides {
        w.extend(s.hp.to_le_bytes());
        w.extend(s.cannon_x.to_le_bytes());
        w.extend(s.aim.to_le_bytes());
        w.extend([s.cohort_len, u8::from(s.rig_used), u8::from(s.peek_used)]);
        for g in &s.gates {
            w.extend([g.hint.code(), u8::from(g.gold)]);
            match g.revealed {
                None => w.extend([255, 0]),
                Some(op) => {
                    let (k, v) = op.code();
                    w.extend([k, v]);
                }
            }
        }
        for c in &s.cohorts {
            w.extend(c.id.to_le_bytes());
            w.extend(c.count.to_le_bytes());
            w.extend(c.x.to_le_bytes());
            w.extend(c.y.to_le_bytes());
            w.extend([c.age, c.last_row]);
        }
    }
    let x = &m.secret;
    w.extend(x.seed.to_le_bytes());
    for op in x.deal.ops {
        let (k, v) = op.code();
        w.extend([k, v]);
    }
    w.push(x.deal.gold_cell);
    w.extend(x.deal.hints.iter().flatten().map(|h| h.code()));
    w.extend(x.rigs.iter().map(|r| r.unwrap_or(255)));
    for pk in &x.peeks {
        match pk {
            None => w.extend([255, 0, 0, 0]),
            Some(pk) => {
                let (k, v) = pk.op.code();
                w.extend([pk.cell, k, v, u8::from(pk.gold)]);
            }
        }
    }
    assert_eq!(w.len(), 1_307);
    w.resize(1_312, 0);
    let mut out = account_disc("Bench").to_vec();
    out.extend(id.to_le_bytes());
    out.extend(w);
    out
}

struct Bench {
    svm: MagicSVM,
    payer: Keypair,
    new_acc: Address,
    old_acc: Address,
    old_id: u64,
}

impl Bench {
    fn new() -> Self {
        let mut svm = MagicSVM::new();
        let root = repo();
        svm.add_program_from_file(NEW_ID, root.join("target/bench/lil_dudes.so"))
            .expect("build the bench program first (see the header of this file)");
        svm.add_program_from_file(OLD_ID, root.join("spikes/stage0/target/deploy/stage0.so"))
            .expect("M2 spike build (spikes/stage0/target/deploy/stage0.so)");
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
        let old_id = 7u64;
        let old_acc = Address::find_program_address(&[b"bench", &old_id.to_le_bytes()], &OLD_ID).0;
        Self {
            svm,
            payer,
            new_acc: Address::new_unique(),
            old_acc,
            old_id,
        }
    }

    fn set(&mut self, key: Address, owner: Address, data: Vec<u8>) {
        self.svm
            .set_account(
                key,
                Account {
                    lamports: 1_000_000_000,
                    data,
                    owner,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
    }

    /// CU phases of the new build: [zeroed, decode public, decode secret, n ticks, encode
    /// public, encode secret]; None if the tx failed (over budget).
    fn run_new(&mut self, m: &MatchState, n: u16, bot: bool) -> Option<Vec<u64>> {
        self.set(self.new_acc, NEW_ID, new_bytes(m));
        let mut args = n.to_le_bytes().to_vec();
        args.push(u8::from(bot));
        let bench = ix(
            NEW_ID,
            "bench",
            &args,
            vec![AccountMeta::new(self.new_acc, false)],
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
                println!("new n={n} failed: {e}\n{}", logs.join("\n"));
                None
            }
        }
    }

    /// CU phases of the M2 spike build: [decode, n ticks, encode].
    fn run_old(&mut self, m: &MatchState, n: u16, bot: bool) -> Option<Vec<u64>> {
        let data = old_bytes(m, self.old_id);
        self.set(self.old_acc, OLD_ID, data);
        let mut args = self.old_id.to_le_bytes().to_vec();
        args.extend(n.to_le_bytes());
        args.push(u8::from(bot));
        let bench = ix(
            OLD_ID,
            "bench",
            &args,
            vec![AccountMeta::new(self.old_acc, false)],
        );
        self.svm.expire_blockhash_for(TransactionTarget::Base);
        let payer = self.payer.insecure_clone();
        send(
            &mut self.svm,
            TransactionTarget::Base,
            &[cu_limit(1_400_000), bench],
            &[&payer],
        )
        .ok()
        .map(|logs| cu_phases(&logs))
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
            "M2 worst (40v40 crossed, x far apart)",
            m2_worst(7, 150, 2_850),
        ),
        (
            "near miss (40v40 crossed, dx 700)",
            m2_worst(7, 1_000, 1_700),
        ),
        ("surge peak of a bot match", surge_peak(11)),
    ];
    println!();
    for (name, m) in &states {
        let live = [m.public.sides[0].cohort_len, m.public.sides[1].cohort_len];
        let new1 = b.run_new(m, 1, true).expect("new n=1");
        let new0 = b.run_new(m, 0, true).expect("new n=0");
        let new5 = b.run_new(m, 5, true).expect("new n=5");
        let new5_nobot = b.run_new(m, 5, false).expect("new n=5 no bot");
        let old1 = b.run_old(m, 1, true).expect("old n=1");
        let old5 = b.run_old(m, 5, true);
        let codec_new = new0[1] + new0[2] + new0[4] + new0[5] + new0[0];
        let codec_old = old1[0] + old1[2];
        let tick_new = new5[3] / 5;
        let tick_old = old5.as_ref().map_or(old1[1], |o| o[1] / 5);
        println!("{name}: live {live:?}");
        println!(
            "  codec  new {codec_new:>6} CU (zeroed {} + dec pub {} + dec sec {} + enc pub {} + enc sec {})   M2 {codec_old:>6} CU (dec {} + enc {})",
            new0[0], new0[1], new0[2], new0[4], new0[5], old1[0], old1[2]
        );
        println!(
            "  tick   new {tick_new:>6} CU/tick (bots on), {:>6} (no bots)              M2 {tick_old:>6} CU/tick (bots on)",
            new5_nobot[3] / 5
        );
        println!(
            "  ticks per tx (fixed ≈ codec + 6k Anchor): 200k → {} (M2 {}), 400k → {} (M2 {}), 1.4M → {} (M2 {})",
            ticks_in(200_000, codec_new + 6_000, tick_new),
            ticks_in(200_000, codec_old + 6_000, tick_old),
            ticks_in(400_000, codec_new + 6_000, tick_new),
            ticks_in(400_000, codec_old + 6_000, tick_old),
            ticks_in(1_400_000, codec_new + 6_000, tick_new),
            ticks_in(1_400_000, codec_old + 6_000, tick_old),
        );
        let _ = new1;
    }
}
