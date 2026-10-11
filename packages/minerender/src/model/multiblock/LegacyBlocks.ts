import type { Block } from "../block/Block";
import { MineRenderData } from "../../assets/MineRenderData";

/** Resolves a numeric block using mappings for the selected asset version, with caller overrides. */
export async function resolveLegacyBlock(id: number, metadata: number,
                                        customMappings: Readonly<Record<string, string>> = {}, lenient = false,
                                        root?: string): Promise<Block | undefined> {
    return resolveLegacyBlockState(id, metadata, (await MineRenderData.get("legacyBlocks", root)).blocks, customMappings, lenient);
}

/** Resolves a numeric block using a previously loaded mapping table. */
export function resolveLegacyBlockState(id: number, metadata: number, mapping: Readonly<Record<string, string>>,
                                        customMappings: Readonly<Record<string, string>> = {}, lenient = false): Block | undefined {
    const key = `${id}:${metadata}`;
    let mapped = customMappings[key] ?? mapping[key];
    if (!mapped && lenient) mapped = customMappings[`${id}:0`] ?? mapping[`${id}:0`];
    if (!mapped) return undefined;

    const [type, state] = mapped.split("[");
    const properties: NonNullable<Block["properties"]> = {};
    if (state) {
        for (const property of state.slice(0, -1).split(",")) {
            const [key, value] = property.split("=");
            properties[key] = value;
        }
    }
    return { type, properties };
}
