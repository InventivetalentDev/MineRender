import { MineRenderError } from "../error/MineRenderError";
import { AnvilParser } from "./AnvilParser";
import type { AnvilChunk } from "./AnvilParser";
import type { WorldChunkSource } from "./WorldChunkSource";

/** Reads `r.<x>.<z>.mca` at integer region coordinates, or returns `undefined` when absent. */
export type AnvilRegionReader = (x: number, z: number) => Promise<Uint8Array | ArrayBuffer | undefined>;

/** Cache limits passed to `new AnvilWorldSource(readRegion, options)`. */
export interface AnvilWorldSourceOptions {
    /** Maximum cached regions, including missing regions. Defaults to 4; 0 disables caching. */
    maxCachedRegions?: number;
    /** Maximum retained region bytes. Defaults to 64 MiB; larger regions are read without caching. */
    maxCachedBytes?: number;
}

/** Reads selected Java Anvil chunk columns and caches raw regions within count and byte limits. */
export class AnvilWorldSource implements WorldChunkSource {
    private readonly regions = new Map<string, { data?: Uint8Array; size: number }>();
    private readonly pending = new Map<string, Promise<Uint8Array | undefined>>();
    private readonly maxCachedRegions: number;
    private readonly maxCachedBytes: number;
    private cachedBytes = 0;

    constructor(private readonly readRegion: AnvilRegionReader, options: AnvilWorldSourceOptions = {}) {
        this.maxCachedRegions = options.maxCachedRegions ?? 4;
        this.maxCachedBytes = options.maxCachedBytes ?? 64 * 1024 * 1024;
        for (const [name, value] of Object.entries({ maxCachedRegions: this.maxCachedRegions, maxCachedBytes: this.maxCachedBytes })) {
            if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer`);
        }
    }

    /** Decodes one column at absolute chunk coordinates. Regions contain 32×32 columns. */
    public async getChunk(x: number, z: number): Promise<AnvilChunk | undefined> {
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) {
            throw new RangeError("Chunk column coordinates must be safe integers");
        }
        const regionX = Math.floor(x / 32), regionZ = Math.floor(z / 32);
        const data = await this.getRegion(regionX, regionZ);
        if (!data) return undefined;
        try {
            const chunk = await AnvilParser.parseChunk(data, x - regionX * 32, z - regionZ * 32);
            if (chunk && (chunk.x !== x || chunk.z !== z)) {
                throw new MineRenderError(`Anvil chunk coordinates ${chunk.x},${chunk.z} do not match requested column ${x},${z}`);
            }
            return chunk;
        } catch (error) {
            const key = `${regionX},${regionZ}`;
            const cached = this.regions.get(key);
            if (cached?.data === data) {
                this.cachedBytes -= cached.size;
                this.regions.delete(key);
            }
            throw error;
        }
    }

    /** Releases cached regions. Reads already in progress finish without repopulating this cache. */
    public clearCache(): void {
        this.regions.clear();
        this.pending.clear();
        this.cachedBytes = 0;
    }

    private getRegion(x: number, z: number): Promise<Uint8Array | undefined> {
        const key = `${x},${z}`;
        const cached = this.regions.get(key);
        if (cached) {
            this.regions.delete(key);
            this.regions.set(key, cached);
            return Promise.resolve(cached.data);
        }
        let loading = this.pending.get(key);
        if (!loading) {
            loading = Promise.resolve().then(() => this.readRegion(x, z)).then(data => {
                let bytes = data instanceof Uint8Array ? data : data === undefined ? undefined : new Uint8Array(data);
                // A small view must not retain a backing buffer larger than the cache accounts for.
                if (bytes && bytes.byteLength !== bytes.buffer.byteLength) bytes = new Uint8Array(bytes);
                if (this.pending.get(key) === loading) this.cacheRegion(key, bytes);
                return bytes;
            }).finally(() => {
                if (this.pending.get(key) === loading) this.pending.delete(key);
            });
            this.pending.set(key, loading);
        }
        return loading;
    }

    private cacheRegion(key: string, data?: Uint8Array): void {
        const size = data?.byteLength ?? 0;
        if (!this.maxCachedRegions || size > this.maxCachedBytes) return;
        this.regions.set(key, { data, size });
        this.cachedBytes += size;
        while (this.regions.size > this.maxCachedRegions || this.cachedBytes > this.maxCachedBytes) {
            const oldest = this.regions.keys().next().value!;
            this.cachedBytes -= this.regions.get(oldest)!.size;
            this.regions.delete(oldest);
        }
    }
}
