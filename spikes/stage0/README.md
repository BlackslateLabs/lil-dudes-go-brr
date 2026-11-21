# Stage 0 spike (M2): MagicBlock TEE checks

Throwaway. Results and rerun commands: [RESULTS.md](RESULTS.md). Not part of the main Cargo or pnpm
workspace.

```bash
cd spikes/stage0
pnpm install --ignore-workspace
anchor build                      # generates target/deploy/stage0-keypair.json on first build
anchor keys sync && anchor build  # if the keypair is new
solana program deploy target/deploy/stage0.so --program-id target/deploy/stage0-keypair.json -u devnet
npx tsx scripts/setup.ts          # one run: init + delegate to the TEE + ephemeral permissions
```

Every script takes `--id=N` (defaults to the last `setup.ts` run in `out/run.json`). Burner keys live in
`keys/` (gitignored). Close the program afterwards: `solana program close <ID> --bypass-warning -u devnet`.
