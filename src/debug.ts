import { debug as dbg } from "debug";

const NAMESPACE = "MineRender";

export const debug = dbg(NAMESPACE);

export function enableDebug() {
    dbg.enable(NAMESPACE);
}
