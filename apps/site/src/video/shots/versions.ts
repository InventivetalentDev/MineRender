import { AssetKey, type BlockObject, BlockStates } from "minerender";
import { fade, orbit, range } from "../motion";
import type { Shot, ShotContext } from "../types";

/** One block per game version, each loaded from that version's asset root. Registry data exists from 1.16.5 on. */
const VERSIONS: Array<[string, string]> = [
    ["1.16.5", "netherite_block"], ["1.17.1", "copper_block"], ["1.19.4", "mangrove_log"], ["1.20.1", "cherry_log"], ["1.21.4", "crafter"]
];
const SPACING = 26;

function versionedKey(block: string, version: string): AssetKey {
    return new AssetKey("minecraft", block, "blockstates", undefined, "assets", ".json", `https://assets.mcasset.cloud/${version}`);
}

async function addBlock(context: ShotContext, block: string, version: string, x: number): Promise<BlockObject> {
    const state = await BlockStates.get(versionedKey(block, version));
    if (!state) throw new Error(`Unknown block "${block}" in ${version}`);
    const object = await context.renderer.scene.addBlock(state) as BlockObject;
    object.setPosition(object.getPosition().set(x, 0, 0));
    return object;
}

/** Blocks from five game versions side by side, each resolved through its own asset root. */
export const versionsMix: Shot = {
    id: "versions",
    seconds: 7,
    async prepare(context) {
        for (const [index, [version, block]] of VERSIONS.entries()) {
            await addBlock(context, block, version, (index - (VERSIONS.length - 1) / 2) * SPACING);
        }
    },
    update({ camera, overlay, portrait }, t) {
        orbit(camera, { target: [0, 0, 0], radius: 104, height: 46, angle: -0.3, speed: 0.07 }, t, portrait ? 1.7 : 1);
        overlay.set({
            surface: range(t, 0, 0.4),
            caption: "Mix game <accent>versions</accent>:\none asset root per key",
            captionOpacity: fade(t, 0.8, 99, 0.4),
            code: `const root = "https://assets.mcasset.cloud/1.17.1";\nconst key = new AssetKey("minecraft", "copper_block",\n    "blockstates", undefined, "assets", ".json", root);\nawait scene.addBlock((await BlockStates.get(key))!);`,
            codeOpacity: fade(t, 2.6, 99, 0.5),
            stat: VERSIONS.map(([version]) => version).join(" · "),
            statOpacity: fade(t, 1.4, 99, 0.4)
        });
    }
};
