/* tslint:disable */
/* eslint-disable */

/**
 * The Warlord bot on its own, deciding from the on-chain public state (codec bytes). Used by
 * headless live matches (packages/client/scripts); the UI never needs it.
 */
export class Bot {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The bot's input for the tick the given public state is about to process:
     * `[aim, rig, peek]`, each -1 for none. Garbage or short input gives `[-1, -1, -1]`.
     */
    decide(public_bytes: Uint8Array | number[]): Int32Array;
    /**
     * `seed` must be independent of the match seed (it only drives tie-breaks and rig/peek cells).
     */
    constructor(side: number, seed: bigint);
}

export class SimMatch {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Digest of the full state (public + secret), for parity checks and Verify.
     */
    digest(): bigint;
    ended(): boolean;
    /**
     * The last step's events (EVENT LAYOUT).
     */
    events(): Float64Array;
    /**
     * Every phase's rigs and peeks so far (codec history layout, 3 × 2 × [rig, peek cell, kind,
     * value, gold], 255 = none); the live result screen reads the same bytes from the Match.
     */
    history(): Uint8Array;
    /**
     * `bots`: bit 0 = side 0 is the Warlord bot, bit 1 = side 1. `bot_seed` must be independent
     * of the match `seed` (the bot never gets the match seed). `stake` in lamports.
     */
    constructor(seed: bigint, bot_seed: bigint, stake: bigint, bots: number, tutorial: boolean);
    /**
     * What only `side` may see (PRIVATE LAYOUT). Offline only: the whole sim is local anyway.
     */
    private_view(side: number): Float64Array;
    /**
     * The public state in the on-chain codec layout (crates/sim/src/codec.rs), exactly the
     * bytes the Match account holds; packages/client/src/codec.ts decodes it.
     */
    public_bytes(): Uint8Array;
    /**
     * Queue `side`'s inputs for the next step (ignored for bot sides). `undefined` = unchanged.
     * Later calls before the step win.
     */
    set_input(side: number, aim?: number | null, rig?: number | null, peek?: number | null): void;
    /**
     * Advance one tick: bots decide on the public state, then the rules run. Returns `false`
     * (and does nothing) once the match has ended.
     */
    step(): boolean;
    tick(): number;
    /**
     * The public state (VIEW LAYOUT).
     */
    view(): Float64Array;
}

/**
 * crates/sim CODEC_VERSION (byte 0 of the on-chain public state).
 */
export function codec_version(): number;

/**
 * Every constant packages/client mirrors, as JSON (the TS parity test compares them).
 */
export function constants_json(): string;

/**
 * DEALS LAYOUT (`deals_for(seed)`): for each phase 0, 1, 2 (DEAL_LEN bytes each):
 *   gold cell, 9 × [kind, value] (true ops, gold included), 2 × 9 hints (side 0, then side 1).
 * The deals of a finished match, from its published seed (Verify and the result screen).
 */
export function deals_for(seed: bigint): Uint8Array;

export function layout_version(): number;

export function rules_version(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_bot_free: (a: number, b: number) => void;
    readonly __wbg_simmatch_free: (a: number, b: number) => void;
    readonly bot_decide: (a: number, b: number, c: number) => [number, number];
    readonly bot_new: (a: number, b: bigint) => number;
    readonly codec_version: () => number;
    readonly constants_json: () => [number, number];
    readonly deals_for: (a: bigint) => [number, number];
    readonly layout_version: () => number;
    readonly rules_version: () => number;
    readonly simmatch_digest: (a: number) => bigint;
    readonly simmatch_ended: (a: number) => number;
    readonly simmatch_events: (a: number) => [number, number];
    readonly simmatch_history: (a: number) => [number, number];
    readonly simmatch_new: (a: bigint, b: bigint, c: bigint, d: number, e: number) => number;
    readonly simmatch_private_view: (a: number, b: number) => [number, number];
    readonly simmatch_public_bytes: (a: number) => [number, number];
    readonly simmatch_set_input: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly simmatch_step: (a: number) => number;
    readonly simmatch_tick: (a: number) => number;
    readonly simmatch_view: (a: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
