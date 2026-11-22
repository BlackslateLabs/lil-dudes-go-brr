//! M3 step 5, rules v4: rig and peek by gate slot (private; a rig in any phase on my own current
//! stage of the opponent's copy, refused once they are past it, on revealed or missing gates and
//! twice a stage; a peek only in my Fight / Raid), finish (publish + commit + undelegate + Magic
//! Action), the permissionless settle fallback, abort, close.

mod common;

use common::game::*;
use lil_dudes_sim::codec::{encode_secret, HEADER_LEN, SECRET_LEN, SIDE_LEN, S_HISTORY};
use lil_dudes_sim::deal::RIG_OP;
use lil_dudes_sim::layouts::stage;
use lil_dudes_sim::{payout, Peek, Phase, Rig, LANE_WIDTH, MATCH_TICKS, PLANT_TICKS};
use magicsvm::TransactionTarget::{Base, Ephemeral};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_signer::Signer;

/// Crank + manual `advance` until the match has a result (MagicSVM slots are 50 ms, so the crank
/// alone covers only part of a match; see tee.rs).
fn run_to_end(g: &mut Game) {
    let a = g.burner(0);
    for _ in 0..2_000 {
        if g.public(Ephemeral).result.is_some() {
            return;
        }
        let s = g.slot(Ephemeral);
        g.svm.warp_to_slot(s + 40);
        g.er(g.advance_ix(), &[&a]).unwrap();
    }
    panic!("match did not end");
}

/// Crank until the sim reaches `tick`.
fn run_to_tick(g: &mut Game, tick: u32) {
    while g.public(Ephemeral).tick < tick {
        let s = g.slot(Ephemeral);
        g.svm.warp_to_slot(s + 5);
    }
}

fn rig_ix(g: &Game, who: &Keypair, side: usize, slot: u8) -> Instruction {
    g.secret_input_ix("plant_rig", who.pubkey(), g.peeks[side], slot)
}

fn peek_ix(g: &Game, who: &Keypair, side: usize, slot: u8) -> Instruction {
    g.secret_input_ix("peek_cell", who.pubkey(), g.peeks[side], slot)
}

/// Test surgery: puts `side` on `stage` (codec side byte 0) without touching anything else.
fn set_stage(g: &mut Game, side: usize, stage: u8) {
    let at = off::STATE + HEADER_LEN + side * SIDE_LEN;
    let game = g.game;
    g.poke_ephemeral(&game, at, &[stage]);
}

/// The 7 view bytes of a Peek: [stage, rig stage, rig slot, peek stage, peek slot, peek op, pad].
fn view(peek: &[u8]) -> [u8; 7] {
    peek[peek_off::STAGE..peek_off::STAGE + 7]
        .try_into()
        .unwrap()
}

#[test]
fn rig_and_peek_follow_the_v4_rules_and_stay_private() {
    let mut g = Game::new(20);
    g.to_ready(0, 0);
    g.to_playing();
    let (a, b) = (g.burner(0), g.burner(1));
    let p = g.public(Ephemeral);
    for s in &p.sides {
        assert_eq!(
            (s.stage, s.phase),
            (0, Phase::Plant),
            "both start in the Plant"
        );
    }
    let gates = stage(p.layout, 0).gates.len() as u8;
    // B fires at a gate it is sure to pass; A rigs a gate of B's off that path when it can.
    let (aim_slot, aim_x) = sure_gate(p.layout, 0).expect("a sure gate in stage 0");
    let rig_slot = off_path_gate(p.layout, 0, aim_x, aim_slot).unwrap_or((aim_slot + 1) % gates);
    g.er(g.set_aim_ix(b.pubkey(), aim_x), &[&b]).unwrap();
    // Nobody has written their Peek yet.
    let theirs = g.peek_bytes(1, Some(b.pubkey())).unwrap();
    assert_eq!((theirs[peek_off::SIDE], theirs[peek_off::STAGE]), (1, NONE));

    // Plant: peeking is refused.
    assert!(
        g.er(peek_ix(&g, &b, 1, rig_slot), &[&b]).is_err(),
        "peeked in the plant"
    );
    // Refused rigs: a slot the stage does not have, a stranger, someone else's Peek.
    assert!(
        g.er(rig_ix(&g, &a, 0, gates), &[&a]).is_err(),
        "rigged a missing slot"
    );
    let stranger = Keypair::new();
    assert!(
        g.er(rig_ix(&g, &stranger, 0, rig_slot), &[&stranger])
            .is_err(),
        "stranger rigged"
    );
    assert!(
        g.er(rig_ix(&g, &a, 1, rig_slot), &[&a]).is_err(),
        "rigged through the opponent's Peek"
    );
    // A revealed gate (test surgery: B's aim gate shown face-up with its true value).
    let truth = g.secret_raw(Ephemeral).values[0][usize::from(aim_slot)];
    g.reveal_gate(1, aim_slot, truth.to_byte());
    assert_eq!(
        g.public(Ephemeral).sides[1].gates[usize::from(aim_slot)].revealed,
        Some(truth)
    );
    assert!(
        g.er(rig_ix(&g, &a, 0, aim_slot), &[&a]).is_err(),
        "rigged a revealed gate"
    );
    assert!(
        !g.public(Ephemeral).sides[0].rig_used,
        "a refused rig was spent"
    );

    // A valid rig: under A's stage 0, naming B's stage 0, in A's Peek only.
    g.er(rig_ix(&g, &a, 0, rig_slot), &[&a]).unwrap();
    let secret = g.secret_raw(Ephemeral);
    assert_eq!(
        secret.history[0].rigs[0],
        Some(Rig {
            stage: 0,
            slot: rig_slot
        })
    );
    assert_eq!(
        secret.true_op(1, 0, rig_slot),
        RIG_OP,
        "B's gate is a trap now"
    );
    assert!(g.public(Ephemeral).sides[0].rig_used);
    let mine = g
        .peek_bytes(0, Some(a.pubkey()))
        .expect("my Peek is visible to me");
    assert_eq!(mine[peek_off::SIDE], 0);
    assert_eq!(
        view(&mine),
        [0, 0, rig_slot, NONE, NONE, 0, 0],
        "A's Peek after the rig"
    );
    assert!(
        g.peek_bytes(0, Some(b.pubkey())).is_none(),
        "opponent reads my Peek"
    );
    assert!(g.peek_bytes(0, None).is_none(), "anyone reads my Peek");
    // A second rig in the same stage: refused.
    let other = (0..gates)
        .find(|&s| s != rig_slot && s != aim_slot)
        .unwrap_or(rig_slot);
    assert!(
        g.er(rig_ix(&g, &a, 0, other), &[&a]).is_err(),
        "rigged twice in a stage"
    );

    // Fight: rigging still works (rules v4: any phase), on a gate still face-down in A's copy
    // of our shared stage; peeking works once per stage, on an unrevealed gate.
    run_to_tick(&mut g, PLANT_TICKS + 2);
    let p = g.public(Ephemeral);
    assert_eq!(p.sides[1].phase, Phase::Fight, "B's plant is over");
    let a_x = p.sides[0].aim;
    let a_down = |s: u8| p.sides[0].gates[usize::from(s)].revealed.is_none();
    let b_rig = off_path_gate(p.layout, 0, a_x, NONE)
        .filter(|&s| a_down(s))
        .or_else(|| (0..gates).find(|&s| a_down(s)))
        .expect("a face-down gate in A's copy");
    g.er(rig_ix(&g, &b, 1, b_rig), &[&b])
        .expect("a rig during my Fight is accepted");
    let secret = g.secret_raw(Ephemeral);
    assert_eq!(
        secret.history[0].rigs[1],
        Some(Rig {
            stage: 0,
            slot: b_rig
        })
    );
    assert_eq!(
        secret.true_op(0, 0, b_rig),
        RIG_OP,
        "A's gate is a trap now"
    );
    assert!(g.public(Ephemeral).sides[1].rig_used);
    assert!(
        g.er(peek_ix(&g, &b, 1, aim_slot), &[&b]).is_err(),
        "peeked a revealed gate"
    );
    assert!(
        g.er(peek_ix(&g, &b, 1, gates), &[&b]).is_err(),
        "peeked a missing slot"
    );
    assert!(
        !g.public(Ephemeral).sides[1].peek_used,
        "a refused peek was spent"
    );
    // The rigged gate peeks as the trap (it is off B's path, so still face-down) unless this
    // layout had no off-path gate and it got revealed.
    let p = g.public(Ephemeral);
    let face_down = |s: u8| p.sides[1].gates[usize::from(s)].revealed.is_none();
    let target = if face_down(rig_slot) {
        rig_slot
    } else {
        (0..gates)
            .find(|&s| face_down(s))
            .expect("a face-down gate")
    };
    g.er(peek_ix(&g, &b, 1, target), &[&b]).unwrap();
    let secret = g.secret_raw(Ephemeral);
    let truth = secret.true_op(1, 0, target);
    if target == rig_slot {
        assert_eq!(truth, RIG_OP, "a rigged gate peeks as ÷2");
    }
    assert_eq!(
        secret.history[0].peeks[1],
        Some(Peek {
            slot: target,
            op: truth
        })
    );
    assert!(g.public(Ephemeral).sides[1].peek_used);
    let theirs = g.peek_bytes(1, Some(b.pubkey())).unwrap();
    assert_eq!(
        view(&theirs),
        [0, 0, b_rig, 0, target, truth.to_byte(), 0],
        "B's Peek after the rig and the peek"
    );
    assert!(
        g.peek_bytes(1, Some(a.pubkey())).is_none(),
        "A reads B's Peek"
    );
    // A's Peek is untouched by B's peek.
    assert_eq!(
        view(&g.peek_bytes(0, Some(a.pubkey())).unwrap()),
        view(&mine)
    );
    let again = (0..gates)
        .find(|&s| s != target && face_down(s))
        .unwrap_or(target);
    assert!(
        g.er(peek_ix(&g, &b, 1, again), &[&b]).is_err(),
        "peeked twice in a stage"
    );
}

#[test]
fn rig_reaches_ahead_but_not_behind_the_opponent() {
    // Rules v4: my rig names a gate of MY current stage in the opponent's copy. Refused (and not
    // spent) once they have moved past that stage; accepted for a stage they have not reached
    // yet (it springs when they get there). Stages are set by test surgery at tick 0.
    let mut g = Game::new(26);
    g.to_ready(0, 0);
    g.to_playing();
    let a = g.burner(0);
    let layout = g.public(Ephemeral).layout;
    let slot = 0u8;
    assert!(usize::from(slot) < stage(layout, 1).gates.len());

    // B is already on stage 1 while A is on stage 0: A cannot rig B's (finished) stage 0.
    set_stage(&mut g, 1, 1);
    assert_eq!(
        [
            g.public(Ephemeral).sides[0].stage,
            g.public(Ephemeral).sides[1].stage
        ],
        [0, 1]
    );
    assert!(
        g.er(rig_ix(&g, &a, 0, slot), &[&a]).is_err(),
        "rigged a stage the opponent already passed"
    );
    assert!(
        !g.public(Ephemeral).sides[0].rig_used,
        "a refused rig was spent"
    );
    assert_eq!(g.secret_raw(Ephemeral).history[0].rigs[0], None);

    // A on stage 1, B still on stage 0: the rig lands on B's stage 1, ahead of them.
    set_stage(&mut g, 1, 0);
    set_stage(&mut g, 0, 1);
    let before = g.secret_raw(Ephemeral).true_op(1, 0, slot);
    g.er(rig_ix(&g, &a, 0, slot), &[&a])
        .expect("a rig on a stage the opponent has not reached");
    let secret = g.secret_raw(Ephemeral);
    assert_eq!(secret.history[1].rigs[0], Some(Rig { stage: 1, slot }));
    assert_eq!(
        secret.true_op(1, 1, slot),
        RIG_OP,
        "B's stage-1 gate is a trap"
    );
    assert_eq!(
        secret.true_op(1, 0, slot),
        before,
        "B's current stage untouched"
    );
    assert!(g.public(Ephemeral).sides[0].rig_used);
    let mine = g.peek_bytes(0, Some(a.pubkey())).unwrap();
    assert_eq!(view(&mine), [1, 1, slot, NONE, NONE, 0, 0], "A's Peek");
}

#[test]
fn finish_publishes_settles_by_action_and_refuses_a_second_settle() {
    const S: u64 = 100_000_000;
    let mut g = Game::new(21);
    g.to_ready(S, S);
    g.to_playing();
    let (a, b) = (g.burner(0), g.burner(1));
    // A rigs the gate B fires through: B's first cohort springs it (GOTCHA), and the history
    // has something to publish.
    let layout = g.public(Ephemeral).layout;
    let (slot, x) = sure_gate(layout, 0).expect("a sure gate in stage 0");
    g.er(rig_ix(&g, &a, 0, slot), &[&a]).unwrap();
    g.er(g.set_aim_ix(b.pubkey(), x), &[&b]).unwrap();
    g.er(g.set_aim_ix(a.pubkey(), (LANE_WIDTH / 2) as i16), &[&a])
        .unwrap();
    // Too early.
    assert!(
        g.er(g.finish_ix(a.pubkey()), &[&a]).is_err(),
        "finished mid-match"
    );
    run_to_end(&mut g);
    let p = g.public(Ephemeral);
    let r = p.result.unwrap();
    assert!(p.tick <= MATCH_TICKS);
    let dead = [p.sides[0].dead, p.sides[1].dead];
    let gold = [p.sides[0].gold, p.sides[1].gold];
    assert_eq!(r, payout(S, dead, gold), "SPEC §8 v3 payout");
    if r.ko && r.winner.is_some() {
        assert_eq!(r.moved, S, "a death moves the loser's whole stake");
    }
    let d = g.match_data(Ephemeral);
    let gotcha = &d[off::GOTCHA + 4..off::GOTCHA + 8];
    assert_ne!(
        u16::from_le_bytes([gotcha[0], gotcha[1]]),
        u16::MAX,
        "GOTCHA on B"
    );
    assert_eq!((gotcha[2], gotcha[3]), (slot, 0), "B's gate, rigged by A");
    let secret = g.secret_raw(Ephemeral);
    let w = [g.players[0].wallet.pubkey(), g.players[1].wallet.pubkey()];
    let before = [g.balance(&w[0]), g.balance(&w[1]), g.balance(&TREASURY)];
    assert_eq!(g.balance(&g.vault), 2 * S);

    // Anyone may finish a match with a result; it lands on the base layer, paid by the action.
    let stranger = Keypair::new();
    g.er(g.finish_ix(stranger.pubkey()), &[&stranger]).unwrap();
    let d = g.match_data(Base);
    assert_eq!(
        g.svm.get_account(&g.game).unwrap().owner,
        PROGRAM,
        "undelegated"
    );
    assert_eq!(d[off::STATUS], status::FINISHED);
    let seed = u64::from_le_bytes(d[off::SEED..off::SEED + 8].try_into().unwrap());
    assert_eq!(seed, secret.seed, "seed published");
    let mut encoded = [0u8; SECRET_LEN];
    encode_secret(&secret, &mut encoded);
    let history = &d[off::HISTORY..off::HISTORY + (SECRET_LEN - S_HISTORY)];
    assert_eq!(history, &encoded[S_HISTORY..], "history published");
    assert_eq!(
        history[..4],
        [0, slot, NONE, 0],
        "stage 0 of side 0: the rig, no peek"
    );
    // Both Peeks were refreshed to each side's final stage and committed with the rest.
    for (side, peek) in g.peeks.iter().enumerate() {
        let data = g.svm.get_account(peek).expect("Peek on base").data;
        assert_eq!(
            data[peek_off::STAGE],
            p.sides[side].stage,
            "Peek[{side}] stage"
        );
    }
    assert_eq!(g.balance(&g.vault), 0, "vault drained by the Magic Action");
    let after = [g.balance(&w[0]), g.balance(&w[1]), g.balance(&TREASURY)];
    let got: Vec<i128> = (0..3)
        .map(|i| after[i] as i128 - before[i] as i128)
        .collect();
    let (moved, fee) = (r.moved as i128, r.fee as i128);
    let s = S as i128;
    let expect = match r.winner {
        Some(0) => [s + moved - fee, s - moved, fee],
        Some(1) => [s - moved, s + moved - fee, fee],
        _ => [s, s, 0],
    };
    assert_eq!(
        got, expect,
        "payout split (winner {:?}, moved {moved}, fee {fee})",
        r.winner
    );
    println!("result {r:?}, dead {dead:?}, gold {gold:?}, deltas {got:?}");

    // Double settle: the fallback is refused once the action paid.
    let anyone = g.wallet(1);
    assert!(g.base(g.settle_ix(), &[&anyone]).is_err(), "settled twice");
    // A second finish on the ER: the match is gone from the rollup.
    assert!(
        g.er(g.finish_ix(a.pubkey()), &[&a]).is_err(),
        "finished twice"
    );
    // Close: the creator gets the rent back; nothing stays behind.
    let rent_before = g.balance(&w[0]);
    g.base(g.close_ix(), &[&anyone]).unwrap();
    assert!(g.svm.get_account(&g.game).is_none() && g.svm.get_account(&g.secrets).is_none());
    assert!(g.balance(&w[0]) - rent_before > 10_000_000, "rent back");
}

#[test]
fn fallback_settle_pays_once() {
    // The Magic Action can be skipped on the real rollup (Stage 0 check 6). In MagicSVM it always
    // runs, so simulate a skipped action by putting the stakes back in the vault after finish.
    const S: u64 = 50_000_000;
    let mut g = Game::new(22);
    g.to_ready(S, S);
    g.to_playing();
    run_to_end(&mut g);
    let r = g.public(Ephemeral).result.unwrap();
    let a = g.burner(0);
    g.er(g.finish_ix(a.pubkey()), &[&a]).unwrap();
    g.clear_delegation_leftovers();
    g.svm.airdrop(&g.vault, 2 * S).unwrap();
    let w0 = g.players[0].wallet.pubkey();
    let before = g.balance(&w0);
    let third = Keypair::new();
    g.svm.airdrop(&third.pubkey(), 1_000_000_000).unwrap();
    g.base(g.settle_ix(), &[&third]).unwrap();
    assert_eq!(g.status(Base), status::SETTLED);
    assert_eq!(g.balance(&g.vault), 0);
    let gain = g.balance(&w0) - before;
    let expect = match r.winner {
        Some(0) => S + r.moved - r.fee,
        Some(1) => S - r.moved,
        _ => S,
    };
    assert_eq!(gain, expect);
    g.svm.airdrop(&g.vault, 2 * S).unwrap();
    assert!(g.base(g.settle_ix(), &[&third]).is_err(), "settled twice");
}

#[test]
fn a_match_that_never_starts_can_be_aborted_and_refunds() {
    const S: u64 = 50_000_000;
    let mut g = Game::new(23);
    g.to_ready(S, S);
    let (a, stranger) = (g.burner(0), Keypair::new());
    assert!(
        g.er(g.finish_ix(a.pubkey()), &[&a]).is_err(),
        "aborted too early"
    );
    let s = g.slot(Ephemeral);
    g.svm.warp_to_slot(s + 6_001);
    assert!(
        g.er(g.finish_ix(stranger.pubkey()), &[&stranger]).is_err(),
        "stranger aborted"
    );
    let w = [g.players[0].wallet.pubkey(), g.players[1].wallet.pubkey()];
    let before = [g.balance(&w[0]), g.balance(&w[1])];
    g.er(g.finish_ix(a.pubkey()), &[&a]).unwrap();
    assert_eq!(g.status(Base), status::FINISHED);
    assert_eq!(g.match_data(Base)[off::FLAGS] & 8, 8, "aborted flag");
    assert_eq!(g.balance(&g.vault), 0);
    assert_eq!(g.balance(&w[0]) - before[0], S);
    assert_eq!(g.balance(&w[1]) - before[1], S);
}

#[test]
fn free_match_finishes_and_closes() {
    let mut g = Game::new(24);
    g.to_ready(0, 0);
    g.to_playing();
    run_to_end(&mut g);
    let a = g.burner(1);
    g.er(g.finish_ix(a.pubkey()), &[&a]).unwrap();
    g.clear_delegation_leftovers();
    let anyone = g.wallet(1);
    g.base(g.settle_ix(), &[&anyone]).unwrap();
    assert_eq!(g.status(Base), status::SETTLED);
    assert!(g.base(g.settle_ix(), &[&anyone]).is_err(), "settled twice");
    g.base(g.close_ix(), &[&anyone]).unwrap();
}

#[test]
fn anyone_aborts_a_delegated_match_that_never_started() {
    // Both players gone after delegation (no second salt): after ABORT_ANYONE_SLOTS a stranger
    // with 0 SOL (the sweeper's burner) aborts; the settle action refunds both stakes.
    const S: u64 = 100_000_000;
    let mut g = Game::new(25);
    g.to_ready(S, S);
    let stranger = Keypair::new();
    let s = g.slot(Ephemeral);
    g.svm.warp_to_slot(s + 29_000);
    assert!(
        g.er(g.finish_ix(stranger.pubkey()), &[&stranger]).is_err(),
        "stranger aborted before ABORT_ANYONE_SLOTS"
    );
    g.svm.warp_to_slot(s + 30_001);
    let w = [g.players[0].wallet.pubkey(), g.players[1].wallet.pubkey()];
    let before = [g.balance(&w[0]), g.balance(&w[1])];
    g.er(g.finish_ix(stranger.pubkey()), &[&stranger]).unwrap();
    assert_eq!(g.status(Base), status::FINISHED);
    assert_eq!(g.match_data(Base)[off::FLAGS] & 8, 8, "aborted flag");
    assert_eq!(g.balance(&g.vault), 0);
    assert_eq!(g.balance(&w[0]) - before[0], S);
    assert_eq!(g.balance(&w[1]) - before[1], S);
}
