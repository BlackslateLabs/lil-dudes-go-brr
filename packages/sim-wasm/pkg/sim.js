/* @ts-self-types="./sim.d.ts" */

/**
 * The Warlord bot on its own, deciding from the on-chain public state (codec bytes). Used by
 * headless live matches (packages/client/scripts); the UI never needs it.
 */
export class Bot {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BotFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_bot_free(ptr, 0);
    }
    /**
     * The bot's input for the tick the given public state is about to process:
     * `[aim, rig, peek]`, each -1 for none. Garbage or short input gives `[-1, -1, -1]`.
     * @param {Uint8Array | number[]} public_bytes
     * @returns {Int32Array}
     */
    decide(public_bytes) {
        const ptr0 = passArray8ToWasm0(public_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.bot_decide(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * `seed` must be independent of the match seed (it only drives tie-breaks and rig/peek cells).
     * @param {number} side
     * @param {bigint} seed
     */
    constructor(side, seed) {
        const ret = wasm.bot_new(side, seed);
        this.__wbg_ptr = ret;
        BotFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Bot.prototype[Symbol.dispose] = Bot.prototype.free;

export class SimMatch {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SimMatchFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_simmatch_free(ptr, 0);
    }
    /**
     * Digest of the full state (public + secret), for parity checks and Verify.
     * @returns {bigint}
     */
    digest() {
        const ret = wasm.simmatch_digest(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {boolean}
     */
    ended() {
        const ret = wasm.simmatch_ended(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * The last step's events (EVENT LAYOUT).
     * @returns {Float64Array}
     */
    events() {
        const ret = wasm.simmatch_events(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Every phase's rigs and peeks so far (codec history layout, 3 × 2 × [rig, peek cell, kind,
     * value, gold], 255 = none); the live result screen reads the same bytes from the Match.
     * @returns {Uint8Array}
     */
    history() {
        const ret = wasm.simmatch_history(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * `bots`: bit 0 = side 0 is the Warlord bot, bit 1 = side 1. `bot_seed` must be independent
     * of the match `seed` (the bot never gets the match seed). `stake` in lamports.
     * @param {bigint} seed
     * @param {bigint} bot_seed
     * @param {bigint} stake
     * @param {number} bots
     * @param {boolean} tutorial
     */
    constructor(seed, bot_seed, stake, bots, tutorial) {
        const ret = wasm.simmatch_new(seed, bot_seed, stake, bots, tutorial);
        this.__wbg_ptr = ret;
        SimMatchFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * What only `side` may see (PRIVATE LAYOUT). Offline only: the whole sim is local anyway.
     * @param {number} side
     * @returns {Float64Array}
     */
    private_view(side) {
        const ret = wasm.simmatch_private_view(this.__wbg_ptr, side);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * The public state in the on-chain codec layout (crates/sim/src/codec.rs), exactly the
     * bytes the Match account holds; packages/client/src/codec.ts decodes it.
     * @returns {Uint8Array}
     */
    public_bytes() {
        const ret = wasm.simmatch_public_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Queue `side`'s inputs for the next step (ignored for bot sides). `undefined` = unchanged.
     * Later calls before the step win.
     * @param {number} side
     * @param {number | null} [aim]
     * @param {number | null} [rig]
     * @param {number | null} [peek]
     */
    set_input(side, aim, rig, peek) {
        wasm.simmatch_set_input(this.__wbg_ptr, side, isLikeNone(aim) ? Number.MAX_SAFE_INTEGER : (aim) >> 0, isLikeNone(rig) ? 0xFFFFFF : rig, isLikeNone(peek) ? 0xFFFFFF : peek);
    }
    /**
     * Advance one tick: bots decide on the public state, then the rules run. Returns `false`
     * (and does nothing) once the match has ended.
     * @returns {boolean}
     */
    step() {
        const ret = wasm.simmatch_step(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    tick() {
        const ret = wasm.simmatch_tick(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The public state (VIEW LAYOUT).
     * @returns {Float64Array}
     */
    view() {
        const ret = wasm.simmatch_view(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
}
if (Symbol.dispose) SimMatch.prototype[Symbol.dispose] = SimMatch.prototype.free;

/**
 * crates/sim CODEC_VERSION (byte 0 of the on-chain public state).
 * @returns {number}
 */
export function codec_version() {
    const ret = wasm.codec_version();
    return ret;
}

/**
 * Every constant packages/client mirrors, as JSON (the TS parity test compares them).
 * @returns {string}
 */
export function constants_json() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.constants_json();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * DEALS LAYOUT (`deals_for(seed)`): for each phase 0, 1, 2 (DEAL_LEN bytes each):
 *   gold cell, 9 × [kind, value] (true ops, gold included), 2 × 9 hints (side 0, then side 1).
 * The deals of a finished match, from its published seed (Verify and the result screen).
 * @param {bigint} seed
 * @returns {Uint8Array}
 */
export function deals_for(seed) {
    const ret = wasm.deals_for(seed);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @returns {number}
 */
export function layout_version() {
    const ret = wasm.layout_version();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function rules_version() {
    const ret = wasm.rules_version();
    return ret;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./sim_bg.js": import0,
    };
}

const BotFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_bot_free(ptr, 1));
const SimMatchFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_simmatch_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat64ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('sim_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
