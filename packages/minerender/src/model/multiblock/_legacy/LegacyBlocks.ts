import type { Block } from "../../block/Block";
import legacyBlocks from "../legacyBlocks.json";

export function resolveLegacyBlock(id: number, metadata: number,
                                   customMappings: Readonly<Record<string, string>> = {}, lenient = false): Block | undefined {
    const mapping: Record<string, string> = legacyBlocks.blocks;
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
