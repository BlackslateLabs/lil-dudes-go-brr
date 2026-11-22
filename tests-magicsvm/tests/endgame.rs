//! M3 step 5: rig, peek (private), finish (publish + commit + undelegate + Magic Action), the
//! permissionless settle fallback, abort, close; with every refused case the step lists.

mod common;

use common::game::*;
use lil_dudes_sim::{payout, LANE_WIDTH, MATCH_TICKS, PLANT_TICKS};
use magicsvm::TransactionTarget::{Base, Ephemeral};
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

fn peek_bytes(
    g: &mut Game,
    side: usize,
    viewer: Option<solana_address::Address>,
) -> Option<Vec<u8>> {
    g.svm.set_authorized_user(viewer);
    let d = g
        .svm
        .get_account_for(Ephemeral, &g.peeks[side])
        .map(|a| a.data);
    g.svm.set_authorized_user(None);
    d
}

#[test]
fn rig_and_peek_are_private_and_refused_when_invalid() {
    let mut g = Game::new(20);
    g.to_ready(0, 0);
    g.to_playing();
    let (a, b) = (g.burner(0), g.burner(1));
    let gold = g.secret_raw(Ephemeral).deal.gold_cell;
    let cell = (gold + 1) % 9;
    let rig = |g: &Game, who: &Keypair, side: usize, c: u8| {
        g.secret_input_ix("plant_rig", who.pubkey(), g.peeks[side], c)
    };
    // Refused: the gold gate, a bad cell, a stranger, someone else's Peek.
    assert!(g.er(rig(&g, &a, 0, gold), &[&a]).is_err(), "rigged gold");
    assert!(g.er(rig(&g, &a, 0, 9), &[&a]).is_err(), "rigged cell 9");
    let stranger = Keypair::new();
    assert!(
        g.er(rig(&g, &stranger, 0, cell), &[&stranger]).is_err(),
        "stranger rigged"
    );
    assert!(
        g.er(rig(&g, &a, 1, cell), &[&a]).is_err(),
        "rigged through the opponent's Peek"
    );
    // Plant window: the rig takes, lands in Secrets and in my Peek only.
    g.er(rig(&g, &a, 0, cell), &[&a]).unwrap();
    assert_eq!(g.secret_raw(Ephemeral).rigs[0], Some(cell));
    assert!(g.public(Ephemeral).sides[0].rig_used);
    let mine = peek_bytes(&mut g, 0, Some(a.pubkey())).expect("my Peek is visible to me");
    assert_eq!(
        (mine[8 + 41], mine[8 + 42]),
        (0, cell),
        "rig phase, rig cell"
    );
    assert!(
        peek_bytes(&mut g, 0, Some(b.pubkey())).is_none(),
        "opponent reads my Peek"
    );
    assert!(
        peek_bytes(&mut g, 0, None).is_none(),
        "anyone reads my Peek"
    );
    // Rig twice: refused.
    assert!(
        g.er(rig(&g, &a, 0, (cell + 1) % 9), &[&a]).is_err(),
        "rigged twice"
    );
    // Peek in the plant window: refused.
    let peek = |g: &Game, who: &Keypair, side: usize, c: u8| {
        g.secret_input_ix("peek_cell", who.pubkey(), g.peeks[side], c)
    };
    assert!(
        g.er(peek(&g, &b, 1, 0), &[&b]).is_err(),
        "peeked in the plant"
    );

    // Play: rigging is refused; peeking works once, on an unrevealed own cell.
    run_to_tick(&mut g, PLANT_TICKS + 1);
    assert!(
        g.er(rig(&g, &b, 1, 0), &[&b]).is_err(),
        "rigged during play"
    );
    // Side 1 aims at column 0 so row 0 col 0 (cell 0) gets revealed soon.
    g.er(g.set_aim_ix(b.pubkey(), 500), &[&b]).unwrap();
    run_to_tick(&mut g, PLANT_TICKS + 40);
    let revealed: Vec<u8> = (0..9u8)
        .filter(|&c| {
            g.public(Ephemeral).sides[1].gates[c as usize]
                .revealed
                .is_some()
        })
        .collect();
    assert!(!revealed.is_empty(), "nothing revealed on side 1 yet");
    assert!(
        g.er(peek(&g, &b, 1, revealed[0]), &[&b]).is_err(),
        "peeked a revealed cell"
    );
    assert!(
        !g.public(Ephemeral).sides[1].peek_used,
        "a refused peek used the peek"
    );
    let hidden = (0..9u8).find(|c| !revealed.contains(c)).unwrap();
    g.er(peek(&g, &b, 1, hidden), &[&b]).unwrap();
    let theirs = peek_bytes(&mut g, 1, Some(b.pubkey())).unwrap();
    let truth = g.secret_raw(Ephemeral).true_op(1, hidden).code();
    assert_eq!(
        (theirs[8 + 43], theirs[8 + 44]),
        (0, hidden),
        "peek phase, cell"
    );
    assert_eq!((theirs[8 + 45], theirs[8 + 46]), truth, "peek value");
    assert!(peek_bytes(&mut g, 1, Some(a.pubkey())).is_none());
    assert!(
        g.er(peek(&g, &b, 1, (hidden + 1) % 9), &[&b]).is_err(),
        "peeked twice"
    );
}

#[test]
fn finish_publishes_settles_by_action_and_refuses_a_second_settle() {
    const S: u64 = 100_000_000;
    let mut g = Game::new(21);
    g.to_ready(S, S);
    g.to_playing();
    let (a, b) = (g.burner(0), g.burner(1));
    // Spread the cannons so someone wins on HP; rig in phase 1 so the history has something.
    let gold = g.secret_raw(Ephemeral).deal.gold_cell;
    g.er(
        g.secret_input_ix("plant_rig", a.pubkey(), g.peeks[0], (gold + 3) % 9),
        &[&a],
    )
    .unwrap();
    g.er(g.set_aim_ix(a.pubkey(), 500), &[&a]).unwrap();
    g.er(g.set_aim_ix(b.pubkey(), (LANE_WIDTH - 500) as i16), &[&b])
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
    assert_eq!(r, payout(S, [p.sides[0].hp, p.sides[1].hp]));
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
    assert_eq!(
        d[off::HISTORY],
        (gold + 3) % 9,
        "phase 1 rig of side 0 published"
    );
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
    println!("result {r:?}, deltas {got:?}");

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
