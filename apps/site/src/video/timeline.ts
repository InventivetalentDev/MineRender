import { blocksInstanced } from "./shots/blocks";
import { entityAnimation, entityVariants } from "./shots/entities";
import { guiChest } from "./shots/gui";
import { open } from "./shots/open";
import { outro } from "./shots/outro";
import { sceneComposed } from "./shots/scene";
import { skins } from "./shots/skins";
import { structureVanilla } from "./shots/structure";
import { worldTerrain } from "./shots/world";
import type { Shot } from "./types";

/** Shot lists by cut. The vertical cut reuses shots; they read `portrait` from the context. */
export const timelines: Record<string, Shot[]> = {
    hero: [open, blocksInstanced, skins, entityVariants, entityAnimation, guiChest, structureVanilla, worldTerrain, sceneComposed, outro],
    vertical: [open, blocksInstanced, entityVariants, worldTerrain, sceneComposed, outro]
};
