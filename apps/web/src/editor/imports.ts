import { NBTHelper, SchematicParser, SpongeSchematicParser, StructureParser, type SceneObjectDefinition } from "minerender";

const MAX_STRUCTURE_BLOCKS = 2048;

/** Imports individually editable blocks. Entity NBT, block NBT, and DataVersion are not retained. */
export async function importStructure(file: File): Promise<SceneObjectDefinition[]> {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "nbt" && extension !== "schematic" && extension !== "schem") {
        throw new Error("Choose a Java structure (.nbt), legacy Alpha schematic (.schematic), or Sponge schematic (.schem).");
    }
    const nbt = await NBTHelper.fromBuffer(await file.arrayBuffer());
    const parser = extension === "schem" ? SpongeSchematicParser : extension === "schematic" ? SchematicParser : StructureParser;
    const structure = await parser.parse(nbt);
    if (structure.blocks.length > MAX_STRUCTURE_BLOCKS) {
        throw new Error(`This structure contains ${structure.blocks.length} blocks. The scene editor supports imports of up to ${MAX_STRUCTURE_BLOCKS} non-air blocks.`);
    }
    return structure.blocks.map(block => {
        if (block.position.length !== 3 || !block.position.every(Number.isInteger)) {
            throw new Error(`Block ${block.type} has an invalid position. Structure block positions must contain three integers.`);
        }
        return {
            id: crypto.randomUUID(),
            type: "block",
            asset: block.type,
            state: { ...block.properties },
            position: [block.position[0] * 16, block.position[1] * 16, block.position[2] * 16]
        };
    });
}
