// The only import of ts-deepmerge, so the per-module build inlines one copy of it.
// It is CommonJS with a `default` property, which Node's ESM loader does not unwrap.
import merge from "ts-deepmerge";

export { merge };
