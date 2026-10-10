import { MineRenderError } from "../error/MineRenderError";
import { AnvilParser } from "./AnvilParser";
import type { AnvilChunk, AnvilParseOptions } from "./AnvilParser";
import type { WorldChunkSource } from "./WorldChunkSource";

/**
 * Reads `r.<x>.<z>.mca` at integer region coordinates, or returns `undefined` when absent.
 * Forward `signal` to file or network I/O; it aborts when every caller waiting for the region cancels.
 */
export type AnvilRegionReader = (x: number, z: number, signal?: AbortSignal) => Promise<Uint8Array | ArrayBuffer | undefined>;

/** Readers and cache limits passed to `new AnvilWorldSource(readRegion, options)`. */
export interface AnvilWorldSourceOptions extends Pick<AnvilParseOptions, "readExternalChunk" | "legacyMappings" | "lenient"> {
    /** Reads a dimension's separate `entities/r.<x>.<z>.mca` files. Omit to use embedded entities only. */
    readEntityRegion?: AnvilRegionReader;
    /** Maximum cached regions per kind (terrain and entities), including missing regions. Defaults to 4 each; 0 disables caching. */
    maxCachedRegions?: number;
    /** Maximum retained bytes across both region types. Defaults to 64 MiB; larger regions are read without caching. */
    maxCachedBytes?: number;
}

interface PendingRegion {
    promise: Promise<Uint8Array | undefined>;
    controller: AbortController;
    waiters: number;
    settled: boolean;
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
    });
    try {
        return await Promise.race([promise, cancelled]);
    } finally {
        signal.removeEventListener("abort", abort);
    }
}

/** Reads selected Java Anvil chunk columns and caches raw regions within count and byte limits. */
export class AnvilWorldSource implements WorldChunkSource {
    private readonly regions = new Map<string, { data?: Uint8Array; size: number }>();
    private readonly pending = new Map<string, PendingRegion>();
    private readonly maxCachedRegions: number;
    private readonly maxCachedBytes: number;
    private readonly readEntityRegion?: AnvilRegionReader;
    private readonly parseOptions: Pick<AnvilParseOptions, "readExternalChunk" | "legacyMappings" | "lenient">;
    private cachedBytes = 0;

    constructor(private readonly readRegion: AnvilRegionReader, options: AnvilWorldSourceOptions = {}) {
        this.readEntityRegion = options.readEntityRegion;
        this.parseOptions = { readExternalChunk: options.readExternalChunk, legacyMappings: options.legacyMappings, lenient: options.lenient };
        this.maxCachedRegions = options.maxCachedRegions ?? 4;
        this.maxCachedBytes = options.maxCachedBytes ?? 64 * 1024 * 1024;
        for (const [name, value] of Object.entries({ maxCachedRegions: this.maxCachedRegions, maxCachedBytes: this.maxCachedBytes })) {
            if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer`);
        }
    }

    /**
     * Decodes a column at absolute chunk coordinates, including entity-only columns.
     * A separate entity record replaces embedded entities, even when its list is empty.
     * Missing entity files or records leave embedded entities intact. Aborting a caller leaves other shared readers active.
     */
    public async getChunk(x: number, z: number, signal?: AbortSignal): Promise<AnvilChunk | undefined> {
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) {
            throw new RangeError("Chunk column coordinates must be safe integers");
        }
        const regionX = Math.floor(x / 32), regionZ = Math.floor(z / 32);
        const controller = new AbortController();
        const readSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        try {
            const [data, entityData] = await Promise.all([
                this.getRegion("terrain", this.readRegion, regionX, regionZ, readSignal),
                this.readEntityRegion && this.getRegion("entities", this.readEntityRegion, regionX, regionZ, readSignal)
            ]);
            readSignal.throwIfAborted();
            const localX = x - regionX * 32, localZ = z - regionZ * 32;
            const [chunk, entities] = await abortable(Promise.all([
                data ? AnvilParser.parseChunk(data, localX, localZ, {
                    ...this.parseOptions, region: { x: regionX, z: regionZ }, signal: readSignal
                }) : undefined,
                entityData ? AnvilParser.parseEntityChunk(entityData, localX, localZ, {
                    region: { x: regionX, z: regionZ }, signal: readSignal
                }) : undefined
            ]), readSignal);
            readSignal.throwIfAborted();
            if (chunk && (chunk.x !== x || chunk.z !== z)) {
                throw new MineRenderError(`Anvil chunk coordinates ${chunk.x},${chunk.z} do not match requested column ${x},${z}`);
            }
            if (entities && (entities.x !== x || entities.z !== z)) {
                throw new MineRenderError(`Anvil entity chunk coordinates ${entities.x},${entities.z} do not match requested column ${x},${z}`);
            }
            return entities ? {
                ...(chunk ?? { x, z, sections: [] }),
                entities: entities.entities,
                entityDataVersion: entities.dataVersion
            } : chunk;
        } catch (error) {
            // A failed region read releases this caller's interest in the other region type.
            controller.abort(error);
            throw error;
        }
    }

    /** Releases cached regions. Reads already in progress finish without repopulating this cache. */
    public clearCache(): void {
        this.regions.clear();
        this.pending.clear();
        this.cachedBytes = 0;
    }

    private getRegion(kind: "terrain" | "entities", reader: AnvilRegionReader, x: number, z: number,
                      signal?: AbortSignal): Promise<Uint8Array | undefined> {
        signal?.throwIfAborted();
        const key = `${kind}:${x},${z}`;
        const cached = this.regions.get(key);
        if (cached) {
            this.regions.delete(key);
            this.regions.set(key, cached);
            return Promise.resolve(cached.data);
        }
        let loading = this.pending.get(key);
        if (!loading) {
            const controller = new AbortController();
            loading = {
                controller, waiters: 0, settled: false,
                promise: Promise.resolve().then(() => {
                    controller.signal.throwIfAborted();
                    return abortable(reader(x, z, controller.signal), controller.signal);
                }).then(data => {
                    controller.signal.throwIfAborted();
                    let bytes = data instanceof Uint8Array ? data : data === undefined ? undefined : new Uint8Array(data);
                    // A small view must not retain a backing buffer larger than the cache accounts for.
                    if (bytes && bytes.byteLength !== bytes.buffer.byteLength) bytes = new Uint8Array(bytes);
                    if (bytes) AnvilParser.getChunkList(bytes);
                    loading!.settled = true;
                    if (this.pending.get(key) === loading) this.cacheRegion(key, bytes);
                    return bytes;
                }).finally(() => {
                    loading!.settled = true;
                    if (this.pending.get(key) === loading) this.pending.delete(key);
                })
            };
            this.pending.set(key, loading);
        }
        const read = loading;
        read.waiters++;
        return new Promise((resolve, reject) => {
            let finished = false;
            const release = () => {
                if (finished) return false;
                finished = true;
                signal?.removeEventListener("abort", abort);
                read.waiters--;
                return true;
            };
            const abort = () => {
                if (!release()) return;
                if (!read.waiters && !read.settled) {
                    if (this.pending.get(key) === read) this.pending.delete(key);
                    read.controller.abort(signal!.reason);
                }
                reject(signal!.reason);
            };
            signal?.addEventListener("abort", abort, { once: true });
            read.promise.then(
                data => { if (release()) resolve(data); },
                error => { if (release()) reject(error); }
            );
            if (signal?.aborted) abort();
        });
    }

    private cacheRegion(key: string, data?: Uint8Array): void {
        const size = data?.byteLength ?? 0;
        if (!this.maxCachedRegions || size > this.maxCachedBytes) return;
        this.regions.set(key, { data, size });
        this.cachedBytes += size;
        const prefix = `${key.split(":")[0]}:`;
        const sameKind = [...this.regions.keys()].filter(cachedKey => cachedKey.startsWith(prefix));
        while (sameKind.length > this.maxCachedRegions || this.cachedBytes > this.maxCachedBytes) {
            const oldest = sameKind.length > this.maxCachedRegions ? sameKind.shift()! : this.regions.keys().next().value!;
            this.cachedBytes -= this.regions.get(oldest)!.size;
            this.regions.delete(oldest);
        }
    }
}
