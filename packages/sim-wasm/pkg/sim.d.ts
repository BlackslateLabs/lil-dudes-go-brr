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
     * `[aim, peek slot, champion, trigger]`: aim and slot -1 for none, champion 0/1, trigger
     * -1 unchanged / 0 let go / 1 hold (rules v6). Garbage or short input gives
     * `[-1, -1, 0, -1]`.
     */
    decide(public_bytes: Uint8Array | number[]): Int32Array;
    /**
     * `seed` must be independent of the match seed (it only drives tie-breaks and peek slots).
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
     * Every stage's peeks so far (codec history layout: 2 stages × 2 sides × [peek slot, peek
     * op byte], slot 255 = none). The live result screen reads the same bytes from the Match.
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
     * Press (`true`) or let go of (`false`) `side`'s trigger (rules v6: the cannon fires only
     * while it is held; letting go with a full meter in a Fight releases the Champion). Applied
     * at once, between ticks, exactly like the program's player instruction, so a quick
     * release-and-press inside one tick still releases the Champion. Ignored for bot sides.
     */
    set_fire(side: number, on: boolean): void;
    /**
     * Queue `side`'s inputs for the next step (ignored for bot sides). `undefined` = unchanged.
     * `peek` (Scout) is a gate slot of `side`'s own current stage; `champion` calls the
     * Champion (refused unless charged, in a Fight). Later calls before the step win; a
     * Champion call sticks until the step.
     */
    set_input(side: number, aim: number | null | undefined, peek: number | null | undefined, champion: boolean): void;
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
 * Every constant packages/client mirrors, plus the level pool, as JSON (the TS parity test
 * compares them). `NORMAL_ODDS` = [[op byte, percent]] with ±N written as +0 / −0 (N =
 * `PM_BY_ROW[row]`; row index 0 draws from the × entries only); `BIG_ODDS` = [[k, percent]].
 * `LAYOUTS[id].stages[s]` = `{towers: [{x, hp, wave_base}], rows: [y],
 * gates: [{row, x, width, big, timing, x_min, x_max, speed}], crates: [{x, width, y, hp}],
 * walls: [{x, y0, y1}]}` (rules v7 divider walls, `WALL_HALF` thick each side); gate, tower and
 * crate indices are the slots used everywhere else.
 */
export function constants_json(): string;

/**
 * DEALS LAYOUT (`deals_for(seed)`): [layout id, then 2 stages × 8 slots × op byte]; slots past
 * a stage's gate count hold 1 (×1). Every stage's true values of a finished match, from
 * its published seed (Verify and the result screen); peeks come from `history()`.
 */
export function deals_for(seed: bigint): Uint8Array;

/**
 * Centre x of gate `slot` in `stage` of `layout`, `t` ticks into that player's Fight (pass the
 * side's phase ticks; the Rush keeps counting the Fight's, so this stays smooth through the
 * switch). For smooth drawing of sliding gates between ticks. 0 for a missing gate.
 */
export function gate_x_at(layout: number, stage: number, slot: number, t: number): number;

export function layout_version(): number;

export function rules_version(): number;

/**
 * The timing gate's value `t` ticks into a Fight (pass the side's phase ticks): ×1 → ×5,
 * one step per second (SPEC_V5 §3).
 */
export function timing_value(t: number): number;

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
    readonly gate_x_at: (a: number, b: number, c: number, d: number) => number;
    readonly layout_version: () => number;
    readonly rules_version: () => number;
    readonly simmatch_digest: (a: number) => bigint;
    readonly simmatch_ended: (a: number) => number;
    readonly simmatch_events: (a: number) => [number, number];
    readonly simmatch_history: (a: number) => [number, number];
    readonly simmatch_new: (a: bigint, b: bigint, c: bigint, d: number, e: number) => number;
    readonly simmatch_private_view: (a: number, b: number) => [number, number];
    readonly simmatch_public_bytes: (a: number) => [number, number];
    readonly simmatch_set_fire: (a: number, b: number, c: number) => void;
    readonly simmatch_set_input: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly simmatch_step: (a: number) => number;
    readonly simmatch_tick: (a: number) => number;
    readonly simmatch_view: (a: number) => [number, number];
    readonly timing_value: (a: number) => number;
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
