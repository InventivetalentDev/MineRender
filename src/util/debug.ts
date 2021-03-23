import { debug as dbg } from "debug";

export const DEBUG_NAMESPACE = "MineRender";

export const debug = dbg(DEBUG_NAMESPACE);

export function enableDebug() {
    dbg.enable(`${ DEBUG_NAMESPACE }:*`);
}
