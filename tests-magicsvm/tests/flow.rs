//! The match lifecycle in MagicSVM, instruction by instruction (base layer + the rollup).
//! Build first: `anchor build --ignore-keys` (IDL) and the test program (see common/game.rs).

mod common;

use common::game::*;
use magicsvm::TransactionTarget::{Base, Ephemeral};
use solana_signer::Signer;

#[test]
fn create_join_delegate_permissions() {
    let mut g = Game::new(1);
    let (a0, b0) = (
        g.balance(&g.players[0].wallet.pubkey()),
        g.balance(&g.players[1].wallet.pubkey()),
    );
    g.to_ready(100_000_000, 50_000_000);
    // Matched stake = the lower pick; the vault holds 2S; A got the excess back.
    let d = g.match_data(Ephemeral);
    assert_eq!(
        u64::from_le_bytes(d[off::STAKE..off::STAKE + 8].try_into().unwrap()),
        50_000_000
    );
    assert_eq!(g.balance(&g.vault), 100_000_000);
    assert!(a0 - g.balance(&g.players[0].wallet.pubkey()) > 50_000_000);
    assert!(b0 - g.balance(&g.players[1].wallet.pubkey()) >= 50_000_000);
    assert_eq!(g.status(Ephemeral), status::READY);
    // Privacy (MagicSVM's viewer filter): Secrets is private to nobody, Peek[s] to burner s.
    let (s, p0, p1) = (g.secrets, g.peeks[0], g.peeks[1]);
    for viewer in [
        None,
        Some(g.players[0].burner.pubkey()),
        Some(g.players[1].burner.pubkey()),
    ] {
        g.svm.set_authorized_user(viewer);
        assert!(
            g.svm.get_account_for(Ephemeral, &s).is_none(),
            "Secrets visible to {viewer:?}"
        );
        assert!(
            g.svm.get_account_for(Ephemeral, &g.game).is_some(),
            "Match is public"
        );
    }
    g.svm
        .set_authorized_user(Some(g.players[0].burner.pubkey()));
    assert!(g.svm.get_account_for(Ephemeral, &p0).is_some());
    assert!(g.svm.get_account_for(Ephemeral, &p1).is_none());
    g.svm
        .set_authorized_user(Some(g.players[1].burner.pubkey()));
    assert!(g.svm.get_account_for(Ephemeral, &p0).is_none());
    assert!(g.svm.get_account_for(Ephemeral, &p1).is_some());
    g.svm.set_authorized_user(None);
    // A second init_permissions is refused.
    let b = g.burner(1);
    assert!(g.er(g.init_permissions_ix(b.pubkey()), &[&b]).is_err());
    let _ = Base;
}

#[test]
fn seed_start_and_crank() {
    let mut g = Game::new(2);
    g.to_ready(0, 0);
    g.to_playing();
    assert_eq!(g.status(Ephemeral), status::PLAYING);
    let p = g.public(Ephemeral);
    assert_eq!(p.tick, 0);
    // The crank (50 ms) catches the sim up to (slot − start) / 5.
    let slot = g.slot(Ephemeral);
    let results = g.svm.warp_to_slot(slot + 200);
    let failed = results.iter().filter(|r| r.is_err()).count();
    assert_eq!(failed, 0, "crank failures");
    let t = g.public(Ephemeral).tick;
    assert!(t >= 38 && t <= 40, "tick {t} after 200 slots");
    println!("crank runs: {}, tick {t}", results.len());
}

fn set_unix(g: &mut Game, unix: i64) {
    let mut c = g.svm.base().get_sysvar::<solana_clock::Clock>();
    c.unix_timestamp = unix;
    g.svm.base_mut().set_sysvar(&c);
}

#[test]
fn cancel_refunds_before_the_tee() {
    // Open match: only the creator can cancel; stake + every account's rent come back.
    let mut g = Game::new(3);
    let (w0, w1) = (g.wallet(0), g.wallet(1));
    let start = g.balance(&w0.pubkey());
    g.base(g.create_ix(250_000_000), &[&w0]).unwrap();
    assert!(start - g.balance(&w0.pubkey()) > 250_000_000);
    assert!(
        g.base(g.cancel_ix(w1.pubkey(), w0.pubkey()), &[&w1])
            .is_err(),
        "stranger cancelled"
    );
    g.base(g.cancel_ix(w0.pubkey(), w0.pubkey()), &[&w0])
        .unwrap();
    assert!(g.svm.get_account(&g.game).is_none(), "match closed");
    assert_eq!(g.balance(&g.vault), 0);
    let fees = start - g.balance(&w0.pubkey());
    assert!(fees < 100_000, "lost {fees} lamports to a cancel");

    // Joined but never delegated: either player, only after JOIN_TIMEOUT_SECS; both refunded.
    let mut g = Game::new(4);
    let (w0, w1) = (g.wallet(0), g.wallet(1));
    let b1 = g.players[1].burner.pubkey();
    g.base(g.create_ix(100_000_000), &[&w0]).unwrap();
    // Bad joins are refused: wrong stake tier, the creator's own burner.
    assert!(
        g.base(g.join_ix(7, b1), &[&w1]).is_err(),
        "odd stake accepted"
    );
    let b0 = g.players[0].burner.pubkey();
    assert!(
        g.base(g.join_ix(100_000_000, b0), &[&w1]).is_err(),
        "same burner accepted"
    );
    let now = g
        .svm
        .base()
        .get_sysvar::<solana_clock::Clock>()
        .unix_timestamp;
    g.base(g.join_ix(100_000_000, b1), &[&w1]).unwrap();
    let before1 = g.balance(&w1.pubkey());
    assert!(
        g.base(g.cancel_ix(w1.pubkey(), w1.pubkey()), &[&w1])
            .is_err(),
        "cancelled too early"
    );
    set_unix(&mut g, now + 61);
    g.base(g.cancel_ix(w1.pubkey(), w1.pubkey()), &[&w1])
        .unwrap();
    assert_eq!(g.balance(&g.vault), 0);
    assert!(g.balance(&w1.pubkey()) + 10_000 >= before1 + 100_000_000);
    // A delegated match cannot be cancelled on the base layer (the Match is not ours there).
    let mut g = Game::new(5);
    g.to_ready(0, 0);
    let w0 = g.wallet(0);
    assert!(g
        .base(
            g.cancel_ix(w0.pubkey(), g.players[1].wallet.pubkey()),
            &[&w0]
        )
        .is_err());
}

#[test]
fn anyone_refunds_abandoned_matches_after_the_long_timeouts() {
    // MVP §4: nobody has to come back. The payees are fixed by the Match, so after
    // OPEN_ANYONE_SECS / JOIN_ANYONE_SECS any wallet (the server's sweeper) may trigger the refund.
    let stranger = solana_keypair::Keypair::new();
    // Open room nobody joined: refused before 20 min, then the creator gets everything back.
    let mut g = Game::new(6);
    g.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    let w0 = g.wallet(0);
    let start = g.balance(&w0.pubkey());
    let now = g.svm.base().get_sysvar::<solana_clock::Clock>().unix_timestamp;
    g.base(g.create_ix(100_000_000), &[&w0]).unwrap();
    set_unix(&mut g, now + 19 * 60);
    assert!(
        g.base(g.cancel_ix(stranger.pubkey(), w0.pubkey()), &[&stranger]).is_err(),
        "stranger cancelled an open room before 20 min"
    );
    set_unix(&mut g, now + 20 * 60 + 1);
    g.base(g.cancel_ix(stranger.pubkey(), w0.pubkey()), &[&stranger]).unwrap();
    assert!(g.svm.get_account(&g.game).is_none(), "match closed");
    assert!(start - g.balance(&w0.pubkey()) < 100_000, "creator not refunded");

    // Joined, never delegated: players after 60 s, anyone only after 5 min; both refunded.
    let mut g = Game::new(7);
    g.svm.airdrop(&stranger.pubkey(), SOL).unwrap();
    let (w0, w1) = (g.wallet(0), g.wallet(1));
    let b1 = g.players[1].burner.pubkey();
    g.base(g.create_ix(50_000_000), &[&w0]).unwrap();
    let now = g.svm.base().get_sysvar::<solana_clock::Clock>().unix_timestamp;
    g.base(g.join_ix(50_000_000, b1), &[&w1]).unwrap();
    let before = [g.balance(&w0.pubkey()), g.balance(&w1.pubkey())];
    set_unix(&mut g, now + 61);
    assert!(
        g.base(g.cancel_ix(stranger.pubkey(), w1.pubkey()), &[&stranger]).is_err(),
        "stranger cancelled a join after 61 s"
    );
    set_unix(&mut g, now + 5 * 60 + 1);
    g.base(g.cancel_ix(stranger.pubkey(), w1.pubkey()), &[&stranger]).unwrap();
    assert_eq!(g.balance(&g.vault), 0);
    assert_eq!(g.balance(&w1.pubkey()) - before[1], 50_000_000);
    assert!(g.balance(&w0.pubkey()) - before[0] >= 50_000_000, "creator: stake + rent back");
}
