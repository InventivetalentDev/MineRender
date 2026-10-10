import { AssetKey } from "../assets/AssetKey";
import { Block } from "../model/block/Block";
import { Maybe } from "../util/util";

const blockKeys = new Map<string, AssetKey>();

function blockKey(type: string): AssetKey {
    let key = blockKeys.get(type);
    if (!key) {
        key = AssetKey.parse("blockstates", type);
        if (blockKeys.size >= 4096) blockKeys.clear();
        blockKeys.set(type, key);
    }
    return key;
}

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
        this.assign(index, this.intern(block), block?.nbt === undefined ? undefined : structuredClone(block.nbt));
    }

    /** Interns a normalized block state without changing cells. Air has palette id 0. */
    public intern(block: Maybe<Block>): number {
        if (!block || ChunkData.isAir(block)) return 0;
        const key = ChunkData.paletteKey(block);
        const existingId = this.paletteIds.get(key);
        if (existingId !== undefined) return existingId;
        const type = blockKey(block.type).toNamespacedString();
        const properties = Object.fromEntries(Object.keys(block.properties ?? {}).sort()
            .map(name => [name, block.properties![name]]));
        const state = Object.freeze(Object.keys(properties).length
            ? { type, properties: Object.freeze(properties) } : { type });
        const id = this.freeIds.pop() ?? this.palette.length;
        this.palette[id] = { key, state, references: 0 };
        this.paletteIds.set(key, id);
        return id;
    }

    /** Assigns an interned state to a cell and replaces its NBT. `undefined` clears the NBT. */
    public assign(index: number, id: number, nbt?: unknown): void {
        ChunkData.validateIndex(index);
        if (!Number.isInteger(id) || id < 0 || (id !== 0 && !this.palette[id])) {
            throw new RangeError("Palette id must refer to an interned state");
        }
        const previousId = this.indices[index];
        if (previousId !== id) {
            if (previousId !== 0) {
                const previous = this.palette[previousId]!;
                if (--previous.references === 0) {
                    this.paletteIds.delete(previous.key);
                    this.palette[previousId] = undefined;
                    this.freeIds.push(previousId);
                }
            }
            if (id !== 0) this.palette[id]!.references++;
            this.indices[index] = id;
        }
        if (id !== 0 && nbt !== undefined) this.nbt.set(index, nbt);
        else this.nbt.delete(index);
    }

    /** Replaces all cells from palette indices, normalizes air to 0, and clears NBT. */
    public fill(palette: readonly Maybe<Block>[], indices: Uint16Array): void {
        if (indices.length !== 4096 || indices.some(index => index >= palette.length)) {
            throw new RangeError("Section fill needs 4096 valid palette indices");
        }
        this.clear();
        const ids = palette.map(block => this.intern(block));
        for (let index = 0; index < 4096; index++) {
            const id = ids[indices[index]];
            this.indices[index] = id;
            if (id !== 0) this.palette[id]!.references++;
        }
    }

    /** Returns a cell's palette id, or 0 for air. */
    public idAt(index: number): number {
        ChunkData.validateIndex(index);
        return this.indices[index];
    }

    /** Returns a frozen state, or `undefined` for air or a freed palette id. */
    public stateAt(id: number): PaletteState | undefined {
        return this.palette[id]?.state;
    }

    /** Replaces cells, palette entries, and NBT with independent copies of another section. */
    public copyFrom(other: ChunkData): void {
        if (other === this) return;
        this.clear();
        this.indices.set(other.indices);
        for (let id = 1; id < other.palette.length; id++) {
            const entry = other.palette[id];
            const state = entry && ChunkData.copyBlock(entry.state, undefined);
            if (state?.properties) Object.freeze(state.properties);
            this.palette[id] = entry && { ...entry, state: Object.freeze(state!) };
        }
        for (const [key, id] of other.paletteIds) this.paletteIds.set(key, id);
        this.freeIds.push(...other.freeIds);
        for (const [index, nbt] of other.nbt) this.nbt.set(index, structuredClone(nbt));
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
        const key = blockKey(block.type);
        return key.namespace === "minecraft" && !key.type && ["air", "cave_air", "void_air"].includes(key.path);
    }

    /** Identifies a normalized block type and its sorted properties, excluding per-cell NBT. */
    static paletteKey(block: Block): string {
        const properties = Object.fromEntries(Object.keys(block.properties ?? {}).sort()
            .map(name => [name, block.properties![name]]));
        return JSON.stringify([blockKey(block.type).toNamespacedString(), properties]);
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
