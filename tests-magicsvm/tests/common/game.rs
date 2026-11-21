//! A test fixture for `lil_dudes` in MagicSVM: the program (test build, feature "magicsvm"),
//! two funded players with their burners, and IDL-driven instruction builders (account order,
//! writable/signer flags and fixed addresses come from target/idl/lil_dudes.json).
#![allow(dead_code)]

use super::*;
use lil_dudes_sim::codec::{decode_public, decode_secret};
use lil_dudes_sim::{MatchState, PublicState, SecretState};
use magicsvm::{MagicSVM, TransactionTarget};
use serde_json::Value;
use solana_address::Address;
use solana_instruction::{account_meta::AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use std::collections::HashMap;

pub const PROGRAM: Address =
    Address::from_str_const("4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa");
pub const DLP: Address = Address::from_str_const("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
pub const PERMISSION_PROGRAM: Address =
    Address::from_str_const("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
/// Test-build treasury (state.rs, feature "magicsvm").
pub const TREASURY: Address = Address::new_from_array([7; 32]);
pub const SOL: u64 = 1_000_000_000;

pub const MATCH_LEN: usize = 8 + 1_368;
/// Byte offsets in the Match account (8-byte discriminator + repr(C) fields, state.rs).
pub mod off {
    pub const STAKE: usize = 8 + 8;
    pub const READY_SLOT: usize = 8 + 48;
    pub const START_SLOT: usize = 8 + 64;
    pub const SEED: usize = 8 + 72;
    pub const STATUS: usize = 8 + 272;
    pub const FLAGS: usize = 8 + 273;
    pub const GOTCHA: usize = 8 + 280;
    pub const HISTORY: usize = 8 + 288;
    pub const STATE: usize = 8 + 322;
}
pub const SECRETS_STATE: usize = 8 + 104;
pub mod status {
    pub const OPEN: u8 = 0;
    pub const JOINED: u8 = 1;
    pub const READY: u8 = 2;
    pub const SEEDED: u8 = 3;
    pub const PLAYING: u8 = 4;
    pub const FINISHED: u8 = 5;
    pub const SETTLED: u8 = 6;
}

pub struct Idl {
    ixs: HashMap<String, Vec<(String, bool, bool, Option<Address>)>>,
}

impl Idl {
    pub fn load() -> Self {
        let raw = std::fs::read_to_string(repo().join("target/idl/lil_dudes.json"))
            .expect("run `anchor build --ignore-keys` first (target/idl/lil_dudes.json)");
        let v: Value = serde_json::from_str(&raw).unwrap();
        let mut ixs = HashMap::new();
        for ix in v["instructions"].as_array().unwrap() {
            let accounts = ix["accounts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| {
                    (
                        a["name"].as_str().unwrap().to_string(),
                        a["writable"].as_bool().unwrap_or(false),
                        a["signer"].as_bool().unwrap_or(false),
                        a["address"].as_str().map(|s| s.parse::<Address>().unwrap()),
                    )
                })
                .collect();
            ixs.insert(ix["name"].as_str().unwrap().to_string(), accounts);
        }
        Self { ixs }
    }

    /// Builds `name` with `args` (Borsh bytes); accounts by name from `keys`, else the IDL's
    /// fixed address. Panics on a missing account (a test bug).
    pub fn ix(&self, name: &str, args: &[u8], keys: &[(&str, Address)]) -> Instruction {
        let map: HashMap<&str, Address> = keys.iter().copied().collect();
        let accounts = self.ixs[name]
            .iter()
            .map(|(acc, w, s, fixed)| {
                let key = map
                    .get(acc.as_str())
                    .copied()
                    .or(*fixed)
                    .unwrap_or_else(|| panic!("{name}: no key for account `{acc}`"));
                AccountMeta {
                    pubkey: key,
                    is_signer: *s,
                    is_writable: *w,
                }
            })
            .collect();
        ix(PROGRAM, name, args, accounts)
    }
}

pub fn pda(seeds: &[&[u8]], program: &Address) -> Address {
    Address::find_program_address(seeds, program).0
}

pub struct Player {
    pub wallet: Keypair,
    pub burner: Keypair,
}

pub struct Game {
    pub svm: MagicSVM,
    pub idl: Idl,
    pub id: u64,
    pub players: [Player; 2],
    pub game: Address,
    pub secrets: Address,
    pub peeks: [Address; 2],
    pub vault: Address,
}

pub fn name16(s: &str) -> [u8; 16] {
    let mut out = [0u8; 16];
    out[..s.len()].copy_from_slice(s.as_bytes());
    out
}

impl Game {
    pub fn new(id: u64) -> Self {
        let mut svm = MagicSVM::new();
        svm.add_program_from_file(PROGRAM, repo().join("target/magicsvm/lil_dudes.so"))
            .expect(
                "build the test program first: cargo build-sbf --tools-version v1.52 \
                     --manifest-path programs/lil_dudes/Cargo.toml --features magicsvm \
                     --sbf-out-dir target/magicsvm",
            );
        let players = [0, 1].map(|_| Player {
            wallet: Keypair::new(),
            burner: Keypair::new(),
        });
        for p in &players {
            svm.airdrop(&p.wallet.pubkey(), 5 * SOL).unwrap();
        }
        svm.airdrop(&TREASURY, SOL).unwrap();
        let idb = id.to_le_bytes();
        Self {
            game: pda(&[b"match", &idb], &PROGRAM),
            secrets: pda(&[b"secrets", &idb], &PROGRAM),
            peeks: [
                pda(&[b"peek", &idb, &[0]], &PROGRAM),
                pda(&[b"peek", &idb, &[1]], &PROGRAM),
            ],
            vault: pda(&[b"vault", &idb], &PROGRAM),
            svm,
            idl: Idl::load(),
            id,
            players,
        }
    }

    pub fn wallet(&self, side: usize) -> Keypair {
        self.players[side].wallet.insecure_clone()
    }

    pub fn burner(&self, side: usize) -> Keypair {
        self.players[side].burner.insecure_clone()
    }

    pub fn send(
        &mut self,
        target: TransactionTarget,
        ixs: &[Instruction],
        signers: &[&Keypair],
    ) -> Result<Vec<String>, (String, Vec<String>)> {
        self.svm.expire_blockhash_for(target);
        send(&mut self.svm, target, ixs, signers)
    }

    pub fn base(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<Vec<String>, String> {
        self.send(TransactionTarget::Base, &[cu(400_000), ix], signers)
            .map_err(|(e, logs)| format!("{e}\n{}", logs.join("\n")))
    }

    pub fn er(&mut self, ix: Instruction, signers: &[&Keypair]) -> Result<Vec<String>, String> {
        self.send(TransactionTarget::Ephemeral, &[cu(400_000), ix], signers)
            .map_err(|(e, logs)| format!("{e}\n{}", logs.join("\n")))
    }

    // --- instructions ----------------------------------------------------------------------

    pub fn create_ix(&self, pick: u64) -> Instruction {
        let mut args = self.id.to_le_bytes().to_vec();
        args.extend(pick.to_le_bytes());
        args.extend(self.players[0].burner.pubkey().to_bytes());
        args.extend(name16("Alice"));
        self.idl.ix(
            "create_match",
            &args,
            &[
                ("player", self.players[0].wallet.pubkey()),
                ("game", self.game),
                ("secrets", self.secrets),
                ("peek0", self.peeks[0]),
                ("peek1", self.peeks[1]),
                ("vault", self.vault),
            ],
        )
    }

    pub fn join_ix(&self, pick: u64, burner: Address) -> Instruction {
        let mut args = self.id.to_le_bytes().to_vec();
        args.extend(pick.to_le_bytes());
        args.extend(burner.to_bytes());
        args.extend(name16("Bob"));
        self.idl.ix(
            "join_match",
            &args,
            &[
                ("player", self.players[1].wallet.pubkey()),
                ("game", self.game),
                ("peek1", self.peeks[1]),
                ("vault", self.vault),
                ("creator", self.players[0].wallet.pubkey()),
            ],
        )
    }

    pub fn delegate_ix(&self, payer: Address) -> Instruction {
        let mut keys = vec![
            ("payer", payer),
            ("validator", self.svm.validator_identity()),
            ("game", self.game),
            ("secrets", self.secrets),
            ("peek0", self.peeks[0]),
            ("peek1", self.peeks[1]),
        ];
        let names = ["game", "secrets", "peek0", "peek1"];
        let accounts = [self.game, self.secrets, self.peeks[0], self.peeks[1]];
        let mut owned: Vec<(String, Address)> = Vec::new();
        for (n, a) in names.iter().zip(accounts) {
            owned.push((
                format!("buffer_{n}"),
                pda(&[b"buffer", a.as_ref()], &PROGRAM),
            ));
            owned.push((
                format!("delegation_record_{n}"),
                pda(&[b"delegation", a.as_ref()], &DLP),
            ));
            owned.push((
                format!("delegation_metadata_{n}"),
                pda(&[b"delegation-metadata", a.as_ref()], &DLP),
            ));
        }
        let owned_refs: Vec<(&str, Address)> =
            owned.iter().map(|(n, a)| (n.as_str(), *a)).collect();
        keys.extend(owned_refs);
        self.idl.ix("delegate_match", &self.id.to_le_bytes(), &keys)
    }

    pub fn cancel_ix(&self, signer: Address, opponent: Address) -> Instruction {
        self.idl.ix(
            "cancel_match",
            &self.id.to_le_bytes(),
            &[
                ("signer", signer),
                ("game", self.game),
                ("secrets", self.secrets),
                ("peek0", self.peeks[0]),
                ("peek1", self.peeks[1]),
                ("vault", self.vault),
                ("creator", self.players[0].wallet.pubkey()),
                ("opponent", opponent),
            ],
        )
    }

    pub fn init_permissions_ix(&self, payer: Address) -> Instruction {
        let perm = |a: Address| pda(&[b"permission:", a.as_ref()], &PERMISSION_PROGRAM);
        self.idl.ix(
            "init_permissions",
            &[],
            &[
                ("payer", payer),
                ("game", self.game),
                ("secrets", self.secrets),
                ("peek0", self.peeks[0]),
                ("peek1", self.peeks[1]),
                ("secrets_permission", perm(self.secrets)),
                ("peek0_permission", perm(self.peeks[0])),
                ("peek1_permission", perm(self.peeks[1])),
            ],
        )
    }

    pub fn request_seed_ix(&self, payer: Address, salt: [u8; 32]) -> Instruction {
        let identity = pda(&[b"identity"], &PROGRAM);
        self.idl.ix(
            "request_seed",
            &salt,
            &[
                ("payer", payer),
                ("game", self.game),
                ("secrets", self.secrets),
                ("program_identity", identity),
            ],
        )
    }

    pub fn start_ix(&self, payer: Address) -> Instruction {
        self.idl.ix(
            "start",
            &[],
            &[
                ("payer", payer),
                ("game", self.game),
                ("secrets", self.secrets),
            ],
        )
    }

    pub fn advance_ix(&self) -> Instruction {
        self.idl.ix(
            "advance",
            &[],
            &[("game", self.game), ("secrets", self.secrets)],
        )
    }

    pub fn set_aim_ix(&self, player: Address, x: i16) -> Instruction {
        self.idl.ix(
            "set_aim",
            &x.to_le_bytes(),
            &[("player", player), ("game", self.game)],
        )
    }

    pub fn secret_input_ix(
        &self,
        name: &str,
        player: Address,
        peek: Address,
        cell: u8,
    ) -> Instruction {
        self.idl.ix(
            name,
            &[cell],
            &[
                ("player", player),
                ("game", self.game),
                ("secrets", self.secrets),
                ("peek", peek),
            ],
        )
    }

    pub fn finish_ix(&self, payer: Address) -> Instruction {
        self.idl.ix(
            "finish",
            &[],
            &[
                ("payer", payer),
                ("game", self.game),
                ("secrets", self.secrets),
                ("peek0", self.peeks[0]),
                ("peek1", self.peeks[1]),
            ],
        )
    }

    pub fn settle_ix(&self) -> Instruction {
        self.idl.ix(
            "settle",
            &self.id.to_le_bytes(),
            &[
                ("game", self.game),
                ("vault", self.vault),
                ("player0", self.players[0].wallet.pubkey()),
                ("player1", self.players[1].wallet.pubkey()),
                ("treasury", TREASURY),
            ],
        )
    }

    pub fn close_ix(&self) -> Instruction {
        self.idl.ix(
            "close_match",
            &self.id.to_le_bytes(),
            &[
                ("game", self.game),
                ("secrets", self.secrets),
                ("peek0", self.peeks[0]),
                ("peek1", self.peeks[1]),
                ("vault", self.vault),
                ("creator", self.players[0].wallet.pubkey()),
            ],
        )
    }

    // --- reading state ---------------------------------------------------------------------

    pub fn match_data(&self, target: TransactionTarget) -> Vec<u8> {
        self.svm
            .get_account_for(target, &self.game)
            .expect("match account")
            .data
    }

    pub fn status(&self, target: TransactionTarget) -> u8 {
        self.match_data(target)[off::STATUS]
    }

    pub fn public(&self, target: TransactionTarget) -> PublicState {
        let d = self.match_data(target);
        let mut p = MatchState::zeroed().public;
        decode_public(
            d[off::STATE..off::STATE + lil_dudes_sim::PUBLIC_LEN]
                .try_into()
                .unwrap(),
            &mut p,
        );
        p
    }

    /// The secret state, read with the test's god view (bypasses the viewer filter).
    pub fn secret_raw(&self, target: TransactionTarget) -> SecretState {
        let acc = self
            .svm
            .get_shared_account_for(target, &self.secrets)
            .unwrap();
        let d = magicblock_account::ReadableAccount::data(&acc).to_vec();
        let mut s = MatchState::zeroed().secret;
        decode_secret(
            d[SECRETS_STATE..SECRETS_STATE + lil_dudes_sim::SECRET_LEN]
                .try_into()
                .unwrap(),
            &mut s,
        );
        s
    }

    pub fn slot(&self, target: TransactionTarget) -> u64 {
        let ledger = match target {
            TransactionTarget::Base => self.svm.base(),
            TransactionTarget::Ephemeral => self.svm.ephemeral(),
        };
        ledger.get_sysvar::<solana_clock::Clock>().slot
    }

    pub fn balance(&self, a: &Address) -> u64 {
        self.svm.get_balance(a).unwrap_or(0)
    }

    // --- whole steps -------------------------------------------------------------------------

    /// create → join → delegate → init_permissions.
    pub fn to_ready(&mut self, pick_a: u64, pick_b: u64) {
        let (w0, w1) = (self.wallet(0), self.wallet(1));
        let b1 = self.players[1].burner.pubkey();
        self.base(self.create_ix(pick_a), &[&w0]).unwrap();
        self.base(self.join_ix(pick_b, b1), &[&w1]).unwrap();
        self.base(self.delegate_ix(w0.pubkey()), &[&w0]).unwrap();
        let burner = self.burner(0);
        self.er(self.init_permissions_ix(burner.pubkey()), &[&burner])
            .unwrap();
    }

    /// Both salts in, the VRF fulfilled, the match started.
    pub fn to_playing(&mut self) {
        for side in 0..2 {
            let b = self.burner(side);
            let salt = [side as u8 + 1; 32];
            self.er(self.request_seed_ix(b.pubkey(), salt), &[&b])
                .unwrap();
        }
        let slot = self.slot(TransactionTarget::Ephemeral);
        self.svm.warp_to_slot(slot + 2);
        assert_eq!(
            self.status(TransactionTarget::Ephemeral),
            status::SEEDED,
            "VRF callback"
        );
        let b = self.burner(0);
        self.er(self.start_ix(b.pubkey()), &[&b]).unwrap();
    }
}

pub const COMPUTE_BUDGET: Address =
    Address::from_str_const("ComputeBudget111111111111111111111111111111");

pub fn cu(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction {
        program_id: COMPUTE_BUDGET,
        accounts: vec![],
        data,
    }
}
