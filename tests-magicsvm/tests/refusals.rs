//! M3 step 6: the refused cases not covered by flow.rs / tee.rs / endgame.rs, and the deployed
//! build's TEE pin.

mod common;

use common::game::*;
use magicsvm::TransactionTarget::Ephemeral;
use solana_address::Address;
use solana_instruction::account_meta::AccountMeta;
use solana_keypair::Keypair;
use solana_signer::Signer;

#[test]
fn bad_create_join_delegate_close() {
    let mut g = Game::new(30);
    let (w0, w1) = (g.wallet(0), g.wallet(1));
    // create: odd stake, default burner.
    let mut odd = g.create_ix(1);
    assert!(g.base(odd.clone(), &[&w0]).is_err(), "odd stake");
    let burner_at = 8 + 8 + 8; // disc + id + pick
    odd.data[8..16].copy_from_slice(&g.id.to_le_bytes());
    odd.data[16..24].copy_from_slice(&0u64.to_le_bytes());
    odd.data[burner_at..burner_at + 32].fill(0);
    assert!(g.base(odd, &[&w0]).is_err(), "default burner");
    g.base(g.create_ix(0), &[&w0]).unwrap();
    // Creating the same id again fails (the PDAs exist).
    assert!(g.base(g.create_ix(0), &[&w0]).is_err(), "created twice");
    // delegate before anyone joined; close while open.
    assert!(
        g.base(g.delegate_ix(w0.pubkey()), &[&w0]).is_err(),
        "delegated an open match"
    );
    assert!(
        g.base(g.close_ix(), &[&w0]).is_err(),
        "closed an open match"
    );
    // join: the wrong creator account, then twice.
    let b1 = g.players[1].burner.pubkey();
    let mut wrong = g.join_ix(0, b1);
    let stranger = Address::new_unique();
    wrong.accounts[4] = AccountMeta::new(stranger, false);
    assert!(g.base(wrong, &[&w1]).is_err(), "join refunded a stranger");
    g.base(g.join_ix(0, b1), &[&w1]).unwrap();
    let late = Keypair::new();
    g.svm.airdrop(&late.pubkey(), SOL).unwrap();
    let mut again = g.join_ix(0, late.pubkey());
    again.accounts[0] = AccountMeta::new(late.pubkey(), true);
    assert!(g.base(again, &[&late]).is_err(), "joined twice");
}

#[test]
fn settle_action_needs_the_escrow_signature() {
    let mut g = Game::new(31);
    g.to_ready(0, 0);
    let a = g.burner(0);
    // Abort (permissions never used: the JOINED-on-ER path is covered by endgame.rs; here READY).
    let s = g.slot(Ephemeral);
    g.svm.warp_to_slot(s + 6_001);
    g.er(g.finish_ix(a.pubkey()), &[&a]).unwrap();
    let anyone = g.wallet(1);
    // A direct call with a fake escrow can't produce the PDA signature.
    let fake_escrow = Keypair::new();
    let ix = g.idl.ix(
        "settle_action",
        &g.id.to_le_bytes(),
        &[
            ("game", g.game),
            ("vault", g.vault),
            ("player0", g.players[0].wallet.pubkey()),
            ("player1", g.players[1].wallet.pubkey()),
            ("treasury", TREASURY),
            ("escrow_auth", anyone.pubkey()),
            ("escrow", fake_escrow.pubkey()),
        ],
    );
    assert!(
        g.base(ix, &[&anyone, &fake_escrow]).is_err(),
        "settle_action without the delegation program's escrow signature"
    );
}

#[test]
fn the_deployed_build_only_delegates_to_the_tee() {
    // target/deploy/lil_dudes.so = the default build (no "magicsvm" feature).
    let mut g = Game::new(32);
    g.svm
        .add_program_from_file(PROGRAM, repo().join("target/deploy/lil_dudes.so"))
        .unwrap();
    let (w0, w1) = (g.wallet(0), g.wallet(1));
    let b1 = g.players[1].burner.pubkey();
    g.base(g.create_ix(0), &[&w0]).unwrap();
    g.base(g.join_ix(0, b1), &[&w1]).unwrap();
    let err = g.base(g.delegate_ix(w0.pubkey()), &[&w0]).unwrap_err();
    assert!(err.contains("WrongValidator"), "{err}");
}

use common::repo;
