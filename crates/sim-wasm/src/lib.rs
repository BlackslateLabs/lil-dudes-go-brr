//! Browser bindings for the match rules. Scaffold: exposes the rules version only.
//! Build (M1): `wasm-pack build crates/sim-wasm --target web --out-dir ../../packages/sim-wasm/pkg`
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn rules_version() -> u16 {
    lil_dudes_sim::RULES_VERSION
}
