import { debug } from "debug";

export const DEBUG_NAMESPACE = "MineRender";

export const dbg = debug(`${ DEBUG_NAMESPACE }:Misc`);

export function enableDebug() {
    debug.enable(`${ DEBUG_NAMESPACE }:*`);
}
