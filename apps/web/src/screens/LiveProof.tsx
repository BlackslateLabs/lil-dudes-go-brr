import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BASE_EXPLORER, dealsFor, matchResultOf, opLabel, payoutOf, trueOp, type GateOp, type LiveSource, type MatchReveal } from '@lil-dudes/client';
import { refreshBalance, useLive, type FlipLog } from '../live/session';
import { SERVER } from '../live/device';
import { signedSol, sol } from './format';
import './live.css';

/** "Settle now" shows this long after the end if the payout hasn't landed (MVP §3.7). */
const SETTLE_NOW_MS = 20_000;
const COUNT_MS = 1200;

/** The live match's reveal, re-read every second and whenever the settlement lands. */
function useReveal(src: LiveSource | null): MatchReveal | null {
  const settled = useLive((s) => s.settled);
  const [r, setR] = useState<MatchReveal | null>(() => src?.reveal() ?? null);
  useEffect(() => {
    if (!src) return;
    setR(src.reveal());
    const t = setInterval(() => setR(src.reveal()), 1000);
    return () => clearInterval(t);
  }, [src, settled]);
  return r;
}

/**
 * The live half of the result (MVP §3.7–3.8): where the money is (settling → paid out by the Magic
 * Action, or "Settle now"), the payout landing in your burner's balance, Verify (re-derive the
 * match from the revealed seed) and the explorer links.
 */
export function LiveProof({ on }: { on: boolean }) {
  const src = useLive((s) => s.source);
  const before = useLive((s) => s.balanceBefore);
  const reveal = useReveal(src);
  const t0 = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const [after, setAfter] = useState<number | null>(null);
  const [landAt, setLandAt] = useState<number | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  const [verify, setVerify] = useState(false);
  const settled = reveal?.settlement?.state === 'settled';
  const free = (reveal?.payout?.stake ?? 0) === 0;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  // Once the vault is paid out, read the balance it landed in.
  useEffect(() => {
    if (!settled || after !== null) return;
    void refreshBalance().then((b) => {
      if (b === null) return;
      setAfter(b);
      setLandAt(Date.now());
    });
  }, [settled, after]);

  const k = landAt === null ? 0 : Math.min(1, (now - landAt) / COUNT_MS);
  const eased = 1 - Math.pow(1 - k, 3);
  const from = before ?? after ?? 0;
  const shown = after === null ? from : Math.round(from + (after - from) * eased);
  const aborted = reveal?.payout?.kind === 'aborted';
  const settleTx = reveal?.settlement?.signature;

  return (
    <section className={`proof-row live-proof reveal ${on ? 'on' : ''}`}>
      <div className={`lv-settle ${settled ? 'ok' : 'pending'}`}>
        {!reveal ? (
          <span>Waiting for the final state…</span>
        ) : settled ? (
          <span>
            ✓ {free ? 'Free match: nothing to pay out' : reveal.settlement?.by === 'fallback' ? 'Paid out on Solana (settle)' : 'Paid out on Solana by the Magic Action'}
          </span>
        ) : (
          <span className="lv-spin">Settling on Solana…</span>
        )}
        {!settled && !free && reveal && now - t0.current > SETTLE_NOW_MS && (
          <button
            className="link"
            disabled={!!settling && settling.endsWith('…')}
            onClick={async () => {
              if (!src) return;
              setSettling('Settling…');
              const r = await src.settleNow(SERVER).catch((e: unknown) => ({ state: String(e instanceof Error ? e.message : e).slice(0, 80) }));
              setSettling(r.state === 'sent' || r.state === 'settled' ? 'Sent' : r.state === 'not-on-base' ? 'Still leaving the rollup, try again in a few seconds' : String(r.state));
            }}
          >
            Settle now
          </button>
        )}
        {settling && <small>{settling}</small>}
      </div>

      {!free && (
        <div className={`lv-balance ${after !== null ? 'landed' : ''}`}>
          <span>Your balance</span>
          <b>{sol(shown)} SOL</b>
          {after !== null && before !== null && <small className={after >= before ? 'plus' : 'minus'}>{signedSol(after - before)}</small>}
        </div>
      )}

      <div className="lv-row">
        <button className="big" disabled={!reveal || aborted} onClick={() => setVerify(true)} title={aborted ? 'Aborted before the seed: nothing to verify' : 'Re-derive the match from the revealed seed'}>
          Verify
        </button>
        <div className="links">
          {settleTx ? (
            <a href={BASE_EXPLORER(settleTx)} target="_blank" rel="noreferrer">
              Settlement tx ↗
            </a>
          ) : (
            <a aria-disabled title={free ? 'A free match has nothing to settle' : 'Not settled yet'}>
              Settlement tx ↗
            </a>
          )}
          {reveal?.matchUrl ? (
            <a href={reveal.matchUrl} target="_blank" rel="noreferrer">
              Match account ↗
            </a>
          ) : (
            <a aria-disabled>Match account ↗</a>
          )}
        </div>
      </div>
      {verify && reveal && src && <VerifySheet reveal={reveal} src={src} onClose={() => setVerify(false)} />}
    </section>
  );
}

interface Check {
  ok: boolean;
  title: string;
  detail: string;
}

const same = (a: GateOp, b: GateOp) => a.kind === b.kind && a.value === b.value;

/** Every check Verify runs, from public data only: the published seed, the history, the final
 *  on-chain state and the gates that flipped during the match. */
export function verifyChecks(reveal: MatchReveal, src: LiveSource, flips: FlipLog[]): Check[] {
  const state = src.latest.state;
  // Re-derived here, in this browser, with the same Rust code as the program (WASM).
  const deals = dealsFor(reveal.seed);
  const checks: Check[] = [];
  checks.push({
    ok: deals.layout === state.layout,
    title: `Level from the seed: ${deals.layoutName}`,
    detail: deals.layout === state.layout ? 'The seed picks the level you played.' : `The match ran on level ${state.layout}, the seed says ${deals.layout}.`,
  });
  const bad = flips.filter((f) => !same(f.op, trueOp(deals, f.stage, f.slot)));
  checks.push({
    ok: bad.length === 0,
    title: `${flips.length} gate${flips.length === 1 ? '' : 's'} flipped, all match the seed`,
    detail: bad.length
      ? `Mismatch: ${bad.map((f) => `fight ${f.stage + 1} gate ${f.slot + 1} showed ${opLabel(f.op)}, seed says ${opLabel(trueOp(deals, f.stage, f.slot))}`).join('; ')}`
      : 'Every ? gate that flipped face-up showed the value the seed dealt before the match.',
  });
  const scouts = reveal.history.flatMap((h) => h.peeks.map((p, side) => (p ? { stage: h.stage, side, ...p } : null)).filter((x) => x !== null));
  const badScouts = scouts.filter((p) => !same(p.op, trueOp(deals, p.stage, p.slot)));
  checks.push({
    ok: badScouts.length === 0,
    title: `${scouts.length} Scout${scouts.length === 1 ? '' : 's'} told the truth`,
    detail: badScouts.length ? `${badScouts.length} Scout(s) disagree with the seed.` : 'Each private peek showed the seed’s value (published at the end).',
  });
  const result = matchResultOf(state);
  const pay = payoutOf(src.latest.header.stake, result, { dead: [state.sides[0].dead, state.sides[1].dead] });
  const moneyOk = !!result && result.moved === pay.moved && result.fee === pay.fee;
  checks.push({
    ok: moneyOk,
    title: 'Payout recomputed from the scores',
    detail: result ? `${pay.why} Moved ${sol(pay.moved)} SOL, fee ${sol(pay.fee)}.` : 'No result in the final state.',
  });
  const s = reveal.settlement;
  checks.push({
    ok: s?.state === 'settled',
    title: s?.state === 'settled' ? 'Settled on Solana devnet' : 'Settlement still landing',
    detail: s?.state === 'settled' ? (s.by === 'free' ? 'Free match: no money to move.' : 'The vault is empty: both players were paid.') : 'Re-open Verify in a few seconds.',
  });
  return checks;
}

/** Verify (MVP §3.8): the seed, the checks, a big ✓, and every transaction with its link. */
function VerifySheet({ reveal, src, onClose }: { reveal: MatchReveal; src: LiveSource; onClose: () => void }) {
  const flips = useLive((s) => s.flips);
  const checks = useMemo(() => verifyChecks(reveal, src, flips), [reveal, src, flips]);
  const fair = checks.slice(0, 4).every((c) => c.ok);
  // Portaled to <body> and fixed: the result screen scrolls, and a sheet inside it got boxed in.
  return createPortal(
    <div className="sheet-wrap sheet-fixed" onClick={onClose}>
      <div className="sheet verify-sheet" role="dialog" aria-modal="true" aria-label="Verify this match" onClick={(e) => e.stopPropagation()}>
        <i className="sheet-grip" aria-hidden />
        <h3>Verify</h3>
        <div className={`vf-verdict ${fair ? 'ok' : 'bad'}`}>{fair ? '✓ This match was fair' : '✕ Something doesn’t add up'}</div>
        <div className="vf-seed">
          <span>VRF seed (secret until the end)</span>
          <code>{reveal.seed.toString(16).padStart(16, '0')}</code>
        </div>
        <ol className="vf-checks">
          {checks.map((c) => (
            <li key={c.title} className={c.ok ? 'ok' : 'bad'}>
              <b>{c.title}</b>
              <span>{c.detail}</span>
            </li>
          ))}
        </ol>
        <details className="vf-txs">
          <summary>Under the hood: {reveal.txs?.length ?? 0} transactions</summary>
          <ul>
            {(reveal.txs ?? []).map((t) => (
              <li key={t.signature + t.what}>
                <a href={t.url} target="_blank" rel="noreferrer">
                  {t.what} ↗
                </a>
                <small>{t.layer === 'tee' ? 'private rollup' : 'Solana devnet'}</small>
              </li>
            ))}
          </ul>
        </details>
        <p className="sheet-fine">
          Hidden values lived in MagicBlock’s Private Ephemeral Rollup (an Intel TDX enclave) until the end; that hardware is the trust assumption. Rollup txs that touch private accounts show as redacted in the explorer, by design.
        </p>
        <button className="sheet-cancel" onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}
