//! Rules v5: Scout by gate slot (private; only in my Fight / Rush, once a stage, never the timing
//! gate), Champion (public; my Fight, a full meter, one at a time; it rides the next volley),
//! finish (publish + commit + undelegate + Magic Action), the permissionless settle fallback,
//! abort, close.

mod common;

use common::game::*;
use lil_dudes_sim::codec::{
    encode_secret, HEADER_LEN, SECRET_LEN, SIDE_CHAMP, SIDE_LEN, S_HISTORY,
};
use lil_dudes_sim::layouts::{stage, Slot};
use lil_dudes_sim::{
    payout, Peek, Phase, CHAMP_COUNT, CHAMP_TICKS, FIRE_TICKS, LANE_WIDTH, MATCH_TICKS,
    PLANT_TICKS,
};
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

fn peek_ix(g: &Game, who: &Keypair, side: usize, slot: u8) -> Instruction {
    g.secret_input_ix("peek_cell", who.pubkey(), g.peeks[side], slot)
}

/// Test surgery: sets `side`'s Champion meter (codec side tail) without touching anything else.
fn set_champ_meter(g: &mut Game, side: usize, meter: u8) {
    let at = off::STATE + HEADER_LEN + side * SIDE_LEN + SIDE_CHAMP;
    let game = g.game;
    g.poke_ephemeral(&game, at, &[meter]);
}

/// The 7 view bytes of a Peek: [stage, reserved ×2, peek stage, peek slot, peek op, pad].
fn view(peek: &[u8]) -> [u8; 7] {
    peek[peek_off::STAGE..peek_off::STAGE + 7]
        .try_into()
        .unwrap()
}

#[test]
fn scout_follows_the_v5_rules_and_stays_private() {
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
    let st = stage(p.layout, 0);
    let gates = st.gates.len() as u8;
    let timing = (0u8..)
        .zip(st.gates.iter())
        .find_map(|(slot, d)| (d.slot == Slot::Timing).then_some(slot))
        .expect("one timing gate per stage");
    // B fires at a gate it is sure to pass; it scouts a gate off that path.
    let (aim_slot, aim_x) = sure_gate(p.layout, 0).expect("a sure gate in stage 0");
    // Scouted at fight tick 2, before any volley reaches row 1, so any other hidden gate is
    // still face-down.
    let target = off_path_gate(p.layout, 0, aim_x, aim_slot)
        .or_else(|| (0..gates).find(|&s| s != aim_slot && s != timing))
        .expect("another hidden gate");
    g.er(g.set_aim_ix(b.pubkey(), aim_x), &[&b]).unwrap();
    // Nobody has written their Peek yet.
    let theirs = g.peek_bytes(1, Some(b.pubkey())).unwrap();
    assert_eq!((theirs[peek_off::SIDE], theirs[peek_off::STAGE]), (1, NONE));

    // Plant: refused.
    assert!(
        g.er(peek_ix(&g, &b, 1, target), &[&b]).is_err(),
        "scouted in the plant"
    );
    run_to_tick(&mut g, PLANT_TICKS + 2);
    assert_eq!(g.public(Ephemeral).sides[1].phase, Phase::Fight);
    // Refused: a missing slot, the timing gate, a stranger, someone else's Peek, a revealed gate.
    assert!(
        g.er(peek_ix(&g, &b, 1, gates), &[&b]).is_err(),
        "scouted a missing slot"
    );
    assert!(
        g.er(peek_ix(&g, &b, 1, timing), &[&b]).is_err(),
        "scouted the timing gate"
    );
    let stranger = Keypair::new();
    assert!(
        g.er(peek_ix(&g, &stranger, 1, target), &[&stranger])
            .is_err(),
        "stranger scouted"
    );
    assert!(
        g.er(peek_ix(&g, &a, 1, target), &[&a]).is_err(),
        "scouted through the opponent's Peek"
    );
    let truth = g.secret_raw(Ephemeral).values[0][usize::from(aim_slot)];
    g.reveal_gate(1, aim_slot, truth.to_byte());
    assert!(
        g.er(peek_ix(&g, &b, 1, aim_slot), &[&b]).is_err(),
        "scouted a revealed gate"
    );
    assert!(
        !g.public(Ephemeral).sides[1].peek_used,
        "a refused scout was spent"
    );

    // A valid Scout: the true value, in B's Peek only.
    g.er(peek_ix(&g, &b, 1, target), &[&b]).unwrap();
    let secret = g.secret_raw(Ephemeral);
    let truth = secret.true_op(0, target);
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
        [0, NONE, NONE, 0, target, truth.to_byte(), 0],
        "B's Peek after the scout"
    );
    assert!(
        g.peek_bytes(1, Some(a.pubkey())).is_none(),
        "A reads B's Peek"
    );
    assert!(g.peek_bytes(1, None).is_none(), "anyone reads B's Peek");
    // A's Peek is untouched.
    let mine = g.peek_bytes(0, Some(a.pubkey())).unwrap();
    assert_eq!(mine[peek_off::PEEK_STAGE], NONE);
    // Once per stage.
    let again = (0..gates)
        .find(|&s| s != target && s != aim_slot && s != timing)
        .unwrap_or(target);
    assert!(
        g.er(peek_ix(&g, &b, 1, again), &[&b]).is_err(),
        "scouted twice in a stage"
    );
}

#[test]
fn champion_follows_the_v5_rules_and_rides_the_next_volley() {
    let mut g = Game::new(26);
    g.to_ready(0, 0);
    g.to_playing();
    let a = g.burner(0);
    // Plant: refused (not a Fight), even with a full meter.
    set_champ_meter(&mut g, 0, CHAMP_TICKS as u8);
    assert!(
        g.er(g.champion_ix(a.pubkey()), &[&a]).is_err(),
        "champion in the plant"
    );
    assert!(!g.public(Ephemeral).sides[0].champ_pending);
    run_to_tick(&mut g, PLANT_TICKS + 2);
    // Fight, meter not full: refused, nothing spent.
    set_champ_meter(&mut g, 0, 10);
    assert_eq!(g.public(Ephemeral).sides[0].phase, Phase::Fight);
    assert!(
        g.er(g.champion_ix(a.pubkey()), &[&a]).is_err(),
        "champion before the meter is full"
    );
    let stranger = Keypair::new();
    assert!(
        g.er(g.champion_ix(stranger.pubkey()), &[&stranger])
            .is_err(),
        "stranger called a champion"
    );
    // Full: accepted; public, pending, the meter empties.
    set_champ_meter(&mut g, 0, CHAMP_TICKS as u8);
    g.er(g.champion_ix(a.pubkey()), &[&a]).unwrap();
    let s = g.public(Ephemeral).sides[0];
    assert!(s.champ_pending, "pending after the call");
    assert_eq!(s.champ_meter, 0);
    assert!(!g.public(Ephemeral).sides[1].champ_pending);
    // Not twice while one is pending.
    set_champ_meter(&mut g, 0, CHAMP_TICKS as u8);
    assert!(
        g.er(g.champion_ix(a.pubkey()), &[&a]).is_err(),
        "two champions pending"
    );
    // The crank fires it: the next volley is a Champion cohort of CHAMP_COUNT.
    let t = g.public(Ephemeral).tick;
    run_to_tick(&mut g, t + FIRE_TICKS + 1);
    let s = g.public(Ephemeral).sides[0];
    assert!(!s.champ_pending, "fired");
    let champ = s
        .cohorts()
        .iter()
        .find(|c| c.champion)
        .expect("a champion cohort on the lane");
    assert!(champ.count >= 1 && champ.count <= CHAMP_COUNT * 10);
}

#[test]
fn finish_publishes_settles_by_action_and_refuses_a_second_settle() {
    const S: u64 = 100_000_000;
    let mut g = Game::new(21);
    g.to_ready(S, S);
    g.to_playing();
    let (a, b) = (g.burner(0), g.burner(1));
    // B fires at a sure gate; A scouts one off its own path in its Fight, so the history has
    // something to publish.
    let layout = g.public(Ephemeral).layout;
    let (_, x) = sure_gate(layout, 0).expect("a sure gate in stage 0");
    let slot = off_path_gate(layout, 0, (LANE_WIDTH / 2) as i16, NONE).expect("an off-path gate");
    g.er(g.set_aim_ix(b.pubkey(), x), &[&b]).unwrap();
    g.er(g.set_aim_ix(a.pubkey(), (LANE_WIDTH / 2) as i16), &[&a])
        .unwrap();
    // Too early.
    assert!(
        g.er(g.finish_ix(a.pubkey()), &[&a]).is_err(),
        "finished mid-match"
    );
    run_to_tick(&mut g, PLANT_TICKS + 2);
    g.er(peek_ix(&g, &a, 0, slot), &[&a]).unwrap();
    run_to_end(&mut g);
    let p = g.public(Ephemeral);
    let r = p.result.unwrap();
    assert!(p.tick <= MATCH_TICKS);
    let dead = [p.sides[0].dead, p.sides[1].dead];
    let gold = [p.sides[0].gold, p.sides[1].gold];
    assert_eq!(r, payout(S, dead, gold), "SPEC_V5 §7 payout");
    if r.ko && r.winner.is_some() {
        assert_eq!(r.moved, S, "a death moves the loser's whole stake");
    }
    let d = g.match_data(Ephemeral);
    assert_eq!(&d[off::RESERVED..off::RESERVED + 8], &[0; 8], "reserved bytes stay zero");
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
    let truth = secret.true_op(0, slot).to_byte();
    assert_eq!(
        history[..4],
        [slot, truth, NONE, 0],
        "stage 0: side 0 scouted, side 1 did not"
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
