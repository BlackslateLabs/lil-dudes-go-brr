//! M3 step 4: the TEE instructions (seed, start, advance, set_aim), with refused cases and the
//! compute of real `advance` calls.

mod common;

use common::game::*;
use common::*;
use lil_dudes_sim::{MatchOptions, MatchState, LANE_WIDTH, MATCH_TICKS};
use magicsvm::TransactionTarget::Ephemeral;
use solana_keypair::Keypair;
use solana_signer::Signer;

const PID: &str = "4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa";

fn u64_at(d: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(d[at..at + 8].try_into().unwrap())
}

#[test]
fn seed_needs_permissions_both_salts_and_mixes_them() {
    let mut g = Game::new(10);
    let (w0, w1) = (g.wallet(0), g.wallet(1));
    let b1 = g.players[1].burner.pubkey();
    g.base(g.create_ix(0), &[&w0]).unwrap();
    g.base(g.join_ix(0, b1), &[&w1]).unwrap();
    g.base(g.delegate_ix(w0.pubkey()), &[&w0]).unwrap();
    let (a, b) = (g.burner(0), g.burner(1));
    // No salts before the permissions exist (Secrets would still be public).
    assert!(g.er(g.request_seed_ix(a.pubkey(), [1; 32]), &[&a]).is_err());
    g.er(g.init_permissions_ix(a.pubkey()), &[&a]).unwrap();
    // Before the seed: empty sides, cannons centred, no layout dealt.
    let p = g.public(Ephemeral);
    assert!(p
        .sides
        .iter()
        .all(|s| s.cannon_x == 1_500 && s.towers == [0; 2]));
    // Not a player.
    let stranger = Keypair::new();
    assert!(g
        .er(g.request_seed_ix(stranger.pubkey(), [9; 32]), &[&stranger])
        .is_err());
    // One salt: no VRF request yet.
    g.er(g.request_seed_ix(a.pubkey(), [1; 32]), &[&a]).unwrap();
    let slot = g.slot(Ephemeral);
    g.svm.warp_to_slot(slot + 3);
    assert_eq!(g.status(Ephemeral), status::READY);
    // A second salt from the same side is ignored (salts are set once).
    g.er(g.request_seed_ix(a.pubkey(), [5; 32]), &[&a]).unwrap();
    g.er(g.request_seed_ix(b.pubkey(), [2; 32]), &[&b]).unwrap();
    let slot = g.slot(Ephemeral);
    g.svm.warp_to_slot(slot + 2);
    assert_eq!(g.status(Ephemeral), status::SEEDED);
    // seed = sha256(vrf ‖ salt0 ‖ salt1)[..8]; the initial state is dealt from it.
    let acc = g.svm.get_shared_account_for(Ephemeral, &g.secrets).unwrap();
    let d = magicblock_account::ReadableAccount::data(&acc).to_vec();
    let (vrf, s0, s1) = (&d[16..48], &d[48..80], &d[80..112]);
    assert_eq!(s0, &[1u8; 32]);
    assert_eq!(s1, &[2u8; 32]);
    let h = solana_sha256_hasher::hashv(&[vrf, s0, s1]).to_bytes();
    let seed = u64::from_le_bytes(h[..8].try_into().unwrap());
    let secret = g.secret_raw(Ephemeral);
    assert_eq!(secret.seed, seed);
    assert_eq!(secret.values, lil_dudes_sim::Deal::new(seed).values);
    // The initial state is exactly the sim's: the seed's layout, both players in the Plant of
    // Fight 1. The public part shows every gate face-down and not the seed.
    let fresh = MatchState::new(seed, MatchOptions::default());
    assert_eq!(secret, fresh.secret);
    let p = g.public(Ephemeral);
    assert_eq!(p, fresh.public);
    assert_eq!(p.layout, lil_dudes_sim::layout_for(seed));
    assert!(p
        .sides
        .iter()
        .all(|s| s.gates.iter().all(|x| x.revealed.is_none())));
    assert_eq!(u64_at(&g.match_data(Ephemeral), off::SEED), 0);
    // Only the VRF program identity may call the callback.
    let fake = g.idl.ix(
        "callback_seed",
        &[3u8; 32],
        &[
            ("vrf_program_identity", a.pubkey()),
            ("secrets", g.secrets),
            ("game", g.game),
        ],
    );
    assert!(g.er(fake, &[&a]).is_err(), "forged VRF callback accepted");
}

#[test]
fn start_advance_caps_and_set_aim() {
    let mut g = Game::new(11);
    g.to_ready(0, 0);
    // start before the seed is refused.
    let a = g.burner(0);
    assert!(g.er(g.start_ix(a.pubkey()), &[&a]).is_err());
    for side in 0..2 {
        let b = g.burner(side);
        g.er(g.request_seed_ix(b.pubkey(), [side as u8; 32]), &[&b])
            .unwrap();
    }
    let slot = g.slot(Ephemeral);
    g.svm.warp_to_slot(slot + 2);
    // Only a player may start; only once.
    let stranger = Keypair::new();
    assert!(g.er(g.start_ix(stranger.pubkey()), &[&stranger]).is_err());
    g.er(g.start_ix(a.pubkey()), &[&a]).unwrap();
    assert!(
        g.er(g.start_ix(a.pubkey()), &[&a]).is_err(),
        "started twice"
    );
    let start = u64_at(&g.match_data(Ephemeral), off::START_SLOT);
    assert!(start > 0);

    // Catch-up cap: jump the ER clock past the crank (no crank runs) and call advance by hand.
    let s = g.slot(Ephemeral);
    g.svm.ephemeral_mut().warp_to_slot(s + 5 * 30);
    let t0 = g.public(Ephemeral).tick;
    let logs = g.er(g.advance_ix(), &[&a]).unwrap();
    let t1 = g.public(Ephemeral).tick;
    assert_eq!(t1 - t0, 3, "crank catch-up cap");
    println!("advance, 3-tick catch-up: {} CU", consumed(&logs, PID));
    // A second advance in the same slot keeps catching up; when current it is a cheap no-op.
    g.er(g.advance_ix(), &[&a]).unwrap();
    assert_eq!(g.public(Ephemeral).tick - t1, 3);

    // set_aim: players only, clamped, public, and the cannon follows.
    let b = g.burner(1);
    assert!(g
        .er(g.set_aim_ix(stranger.pubkey(), 100), &[&stranger])
        .is_err());
    g.er(g.set_aim_ix(b.pubkey(), 31_000), &[&b]).unwrap();
    g.er(g.set_aim_ix(a.pubkey(), -5), &[&a]).unwrap();
    let p = g.public(Ephemeral);
    assert_eq!(p.sides[1].aim, (LANE_WIDTH - 1) as i16);
    assert_eq!(p.sides[0].aim, 0);
    let logs = g.er(g.set_aim_ix(a.pubkey(), 700), &[&a]).unwrap();
    println!("set_aim: {} CU", consumed(&logs, PID));
    // Let the crank run the match a while: every crank tx succeeds, the sim keeps up.
    let s = g.slot(Ephemeral);
    let results = g.svm.warp_to_slot(s + 2_000);
    assert!(results.iter().all(|r| r.is_ok()), "crank failures");
    let cus: Vec<u64> = results
        .iter()
        .filter_map(|r| r.as_ref().ok())
        .map(|m| m.compute_units_consumed)
        .collect();
    let mut sorted = cus.clone();
    sorted.sort_unstable();
    println!(
        "crank advance CU over {} runs: p50 {} max {}",
        sorted.len(),
        sorted[sorted.len() / 2],
        sorted[sorted.len() - 1]
    );
    let p = g.public(Ephemeral);
    let target = ((g.slot(Ephemeral) - start) / 5).min(u64::from(MATCH_TICKS));
    assert!(
        u64::from(p.tick) + 1 >= target || p.result.is_some(),
        "sim lags: {} vs {target}",
        p.tick
    );
    assert_eq!(p.sides[0].cannon_x, 700);
}

#[test]
fn match_runs_to_the_end_on_the_crank_and_advance_stops() {
    let mut g = Game::new(12);
    g.to_ready(0, 0);
    g.to_playing();
    // MagicSVM slots are 50 ms (the TEE's are ~10 ms), so the crank's runs cover only part of
    // the match here: once they are used up, `advance` by hand (permissionless) to the end.
    let s = g.slot(Ephemeral);
    let results = g.svm.warp_to_slot(s + 5 * (MATCH_TICKS as u64 + 50));
    assert!(results.iter().all(|r| r.is_ok()));
    let a = g.burner(0);
    // Up to (3,600 − 5,400 crank runs / 5) / 8 ≈ 315 calls if nobody dies first.
    let mut guard = 0;
    while g.public(Ephemeral).result.is_none() {
        g.er(g.advance_ix(), &[&a]).unwrap();
        guard += 1;
        assert!(guard < 600, "advance did not reach the end");
    }
    let p = g.public(Ephemeral);
    let r = p.result.expect("match ended");
    assert_eq!(
        r,
        lil_dudes_sim::payout(
            0,
            [p.sides[0].dead, p.sides[1].dead],
            [p.sides[0].gold, p.sides[1].gold]
        )
    );
    println!(
        "ended at tick {} stage {:?} dead {:?} gold {:?} result {:?}",
        p.tick,
        [p.sides[0].stage, p.sides[1].stage],
        [p.sides[0].dead, p.sides[1].dead],
        [p.sides[0].gold, p.sides[1].gold],
        r
    );
    // After the end advance is a no-op and set_aim is refused.
    let before = g.match_data(Ephemeral);
    g.er(g.advance_ix(), &[&a]).unwrap();
    assert_eq!(g.match_data(Ephemeral), before);
    assert!(g.er(g.set_aim_ix(a.pubkey(), 10), &[&a]).is_err());
}
