import { AssetKey } from "../assets/AssetKey";
import { Block } from "../model/block/Block";
import { Maybe } from "../util/util";

type PaletteState = Readonly<Pick<Block, "type" | "properties">>;

interface PaletteEntry {
    readonly key: string;
    readonly state: PaletteState;
    references: number;
}

/** Stores 4,096 block cells in a shared state palette, with separate NBT for each cell. */
export class ChunkData {

    private readonly indices = new Uint16Array(4096);
    private readonly palette: Maybe<PaletteEntry>[] = [undefined];
    private readonly paletteIds = new Map<string, number>();
    private readonly freeIds: number[] = [];
    private readonly nbt = new Map<number, unknown>();

    /** Returns a detached copy of a cell, or `undefined` for air. Indices range from 0 to 4095. */
    public get(index: number): Maybe<Block> {
        ChunkData.validateIndex(index);
        const entry = this.palette[this.indices[index]];
        return entry ? ChunkData.copyBlock(entry.state, this.nbt.get(index)) : undefined;
    }

    /** Captures a cell's data and returns a copy-producing reader that survives later cell changes. */
    public snapshot(index: number): Maybe<() => Block> {
        ChunkData.validateIndex(index);
        const entry = this.palette[this.indices[index]];
        // Capture the state and NBT, so the reader survives slot reuse without retaining the chunk.
        return entry ? ChunkData.copyBlock.bind(undefined, entry.state, this.nbt.get(index)) : undefined;
    }

    /** Copies block data into a cell. An omitted block or an air block clears the cell. */
    public set(index: number, block?: Block): void {
        ChunkData.validateIndex(index);
        let state: PaletteState | undefined;
        let key: string | undefined;
        let nbt: unknown;
        if (block && !ChunkData.isAir(block)) {
            const type = AssetKey.parse("blockstates", block.type).toNamespacedString();
            const properties = Object.fromEntries(Object.keys(block.properties ?? {}).sort()
                .map(name => [name, block.properties![name]]));
            state = Object.freeze(Object.keys(properties).length
                ? { type, properties: Object.freeze(properties) } : { type });
            key = JSON.stringify([type, properties]);
            if (block.nbt !== undefined) nbt = structuredClone(block.nbt);
        }

        const previousId = this.indices[index];
        if (previousId !== 0) {
            const previous = this.palette[previousId]!;
            if (--previous.references === 0) {
                this.paletteIds.delete(previous.key);
                this.palette[previousId] = undefined;
                this.freeIds.push(previousId);
            }
        }

        let id = 0;
        if (state && key !== undefined) {
            const existingId = this.paletteIds.get(key);
            if (existingId !== undefined) {
                id = existingId;
                this.palette[id]!.references++;
            } else {
                id = this.freeIds.pop() ?? this.palette.length;
                this.palette[id] = { key, state, references: 1 };
                this.paletteIds.set(key, id);
            }
        }
        this.indices[index] = id;
        if (nbt !== undefined) this.nbt.set(index, nbt);
        else this.nbt.delete(index);
    }

    public clear(): void {
        this.indices.fill(0);
        this.palette.length = 1;
        this.paletteIds.clear();
        this.freeIds.length = 0;
        this.nbt.clear();
    }

    static isAir(block: Maybe<Block>): boolean {
        if (typeof block === "undefined" || typeof block.type === "undefined") return true;
        const key = AssetKey.parse("blockstates", block.type);
        return key.namespace === "minecraft" && !key.type && ["air", "cave_air", "void_air"].includes(key.path);
    }

    private static copyBlock(state: PaletteState, nbt: unknown): Block {
        const block: Block = { type: state.type };
        if (state.properties) block.properties = { ...state.properties };
        if (nbt !== undefined) block.nbt = structuredClone(nbt);
        return block;
    }

    private static validateIndex(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= 4096) {
            throw new RangeError("Block index must be an integer from 0 to 4095");
        }
    }

}
