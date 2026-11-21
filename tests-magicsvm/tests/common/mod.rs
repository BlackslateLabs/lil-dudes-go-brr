//! Shared helpers: program loading, hand-built Anchor instructions, CU log parsing.
#![allow(dead_code)]

pub mod game;

use magicsvm::{MagicSVM, TransactionTarget};
use solana_address::Address;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::path::PathBuf;

pub fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// Anchor instruction discriminator: sha256("global:<name>")[..8].
pub fn disc(name: &str) -> [u8; 8] {
    let h = solana_sha256_hasher::hash(format!("global:{name}").as_bytes());
    let mut d = [0u8; 8];
    d.copy_from_slice(&h.to_bytes()[..8]);
    d
}

/// Anchor account discriminator: sha256("account:<Name>")[..8].
pub fn account_disc(name: &str) -> [u8; 8] {
    let h = solana_sha256_hasher::hash(format!("account:{name}").as_bytes());
    let mut d = [0u8; 8];
    d.copy_from_slice(&h.to_bytes()[..8]);
    d
}

pub fn ix(program: Address, name: &str, args: &[u8], accounts: Vec<AccountMeta>) -> Instruction {
    let mut data = disc(name).to_vec();
    data.extend_from_slice(args);
    Instruction {
        program_id: program,
        accounts,
        data,
    }
}

pub fn send(
    svm: &mut MagicSVM,
    target: TransactionTarget,
    ixs: &[Instruction],
    signers: &[&Keypair],
) -> Result<Vec<String>, (String, Vec<String>)> {
    let payer = signers[0].pubkey();
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&payer),
        signers,
        svm.latest_blockhash_for(target),
    );
    match svm.send_transaction_to(target, tx) {
        Ok(meta) => Ok(meta.logs),
        Err(e) => Err((format!("{:?}", e.err), e.meta.logs)),
    }
}

/// "Program consumption: N units remaining" values, in order.
pub fn cu_marks(logs: &[String]) -> Vec<u64> {
    logs.iter()
        .filter_map(|l| {
            let rest = l.split("Program consumption: ").nth(1)?;
            rest.split(' ').next()?.parse().ok()
        })
        .collect()
}

/// Differences between consecutive CU marks (the cost of each phase).
pub fn cu_phases(logs: &[String]) -> Vec<u64> {
    cu_marks(logs).windows(2).map(|w| w[0] - w[1]).collect()
}

/// CU used by `program` in a tx's logs ("Program <id> consumed N of M compute units").
pub fn consumed(logs: &[String], program: &str) -> u64 {
    logs.iter()
        .filter_map(|l| {
            let rest = l.strip_prefix(&format!("Program {program} consumed "))?;
            rest.split(' ').next()?.parse::<u64>().ok()
        })
        .sum()
}
