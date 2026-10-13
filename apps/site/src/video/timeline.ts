import { blocksInstanced } from "./shots/blocks";
import { capes } from "./shots/capes";
import { sceneDocument } from "./shots/document";
import { entityAnimation, entityVariants } from "./shots/entities";
import { fluidsAnimated } from "./shots/fluids";
import { guiChest } from "./shots/gui";
import { structureEntities } from "./shots/igloo";
import { itemState } from "./shots/items";
import { guiLayouts } from "./shots/layouts";
import { nodeRender } from "./shots/node";
import { open } from "./shots/open";
import { outro } from "./shots/outro";
import { sceneComposed } from "./shots/scene";
import { skins } from "./shots/skins";
import { entityStates } from "./shots/states";
import { structureVanilla } from "./shots/structure";
import { worldTerrain } from "./shots/world";
import type { Shot } from "./types";

/** Shot lists by cut. The vertical cut reuses shots; they read `portrait` from the context. */
export const timelines: Record<string, Shot[]> = {
    hero: [
        open, blocksInstanced, fluidsAnimated, itemState, skins, capes, entityVariants, entityStates, entityAnimation,
        guiChest, guiLayouts, structureVanilla, structureEntities, worldTerrain, sceneComposed, sceneDocument, nodeRender, outro
    ],
    vertical: [open, blocksInstanced, itemState, skins, entityVariants, entityStates, guiChest, worldTerrain, sceneComposed, sceneDocument, nodeRender, outro]
};
