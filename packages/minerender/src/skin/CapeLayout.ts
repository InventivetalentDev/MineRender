import { DoubleArray } from "../model/Model";

export type CapeLayout = "minecraft" | "optifine" | "labymod";

export const capeTextureSizes: Record<CapeLayout, DoubleArray> = {
    minecraft: [64, 32],
    optifine: [46, 22],
    labymod: [22, 17]
};
