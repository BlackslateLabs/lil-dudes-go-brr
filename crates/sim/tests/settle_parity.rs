//! Payout parity with tools/balance/settle_fuzz.py: the same deposits and HP must move exactly the
//! same lamports. Vectors: tools/balance/settle_vectors.py → settle_vectors.txt (no-Double path).

use lil_dudes_sim::payout;

/// settle_fuzz.settle without a raise: S = min(deposit)/2 (each escrows 2S), then SPEC §7.
fn settle(dep: [u64; 2], hp: [u32; 2]) -> [u64; 3] {
    let s = dep[0].min(dep[1]) / 2;
    let r = payout(s, hp);
    let mut out = [dep[0], dep[1], 0];
    if let Some(w) = r.winner {
        let w = usize::from(w);
        out[1 - w] -= r.moved;
        out[w] += r.moved - r.fee;
        out[2] += r.fee;
    }
    out
}

#[test]
fn payout_matches_settle_fuzz_vectors() {
    let text = include_str!("settle_vectors.txt");
    let mut n = 0;
    for line in text
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
    {
        let (lhs, rhs) = line.split_once("->").expect("vector line");
        let a: Vec<u64> = lhs.split_whitespace().map(|v| v.parse().unwrap()).collect();
        let want: Vec<u64> = rhs.split_whitespace().map(|v| v.parse().unwrap()).collect();
        let got = settle([a[0], a[1]], [a[2] as u32, a[3] as u32]);
        assert_eq!(got.to_vec(), want, "vector {line}");
        assert_eq!(got.iter().sum::<u64>(), a[0] + a[1], "conservation: {line}");
        n += 1;
    }
    assert!(n >= 3000, "only {n} vectors");
}
