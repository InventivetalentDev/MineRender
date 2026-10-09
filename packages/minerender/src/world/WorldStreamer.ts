import type { AnvilChunk } from "./AnvilParser";
import type { MineRenderWorld } from "./MineRenderWorld";
import type { WorldChunkSource } from "./WorldChunkSource";

export interface WorldStreamerOptions {
    /** Loads a square of chunk columns around the center. Integer from 0 to 32; defaults to 2. */
    loadRadius?: number;
    /** Retains loaded columns within this radius. Defaults to loadRadius + 1, capped at 32. */
    unloadRadius?: number;
}

interface ChunkPosition {
    x: number;
    z: number;
}

/**
 * Loads nearby chunk columns in distance order and unloads distant columns.
 * Updates coalesce to the latest center and serialize world mutations. Use a dedicated world:
 * the streamer replaces columns it loads, and callers must await disposal before editing that world.
 * The source remains caller-owned. Lighting, biome tint, and LOD are not added by streaming.
 */
export class WorldStreamer {
    private readonly loadRadius: number;
    private readonly unloadRadius: number;
    private readonly loaded = new Map<string, ChunkPosition>();
    private readonly owned = new Map<string, ChunkPosition>();
    private readonly missing = new Map<string, ChunkPosition>();
    private readonly failed = new Map<string, ChunkPosition & { error: unknown }>();
    private desired: ChunkPosition[] = [];
    private center?: ChunkPosition;
    private loading?: { position: ChunkPosition; controller: AbortController };
    private running?: Promise<void>;
    private disposal?: Promise<void>;
    private disposed = false;

    constructor(
        private readonly world: Pick<MineRenderWorld<boolean>, "placeChunk" | "unloadChunkColumn">,
        private readonly source: WorldChunkSource,
        options: WorldStreamerOptions = {}
    ) {
        this.loadRadius = options.loadRadius ?? 2;
        this.unloadRadius = options.unloadRadius ?? Math.min(32, this.loadRadius + 1);
        if (![this.loadRadius, this.unloadRadius].every(value => Number.isInteger(value) && value >= 0 && value <= 32)
            || this.unloadRadius < this.loadRadius) {
            throw new RangeError("Chunk radii must be integers from 0 to 32, with unloadRadius at least loadRadius");
        }
    }

    /** Returns absolute coordinates of successfully placed columns, including retained columns. */
    public get loadedChunks(): readonly { x: number; z: number }[] {
        return [...this.loaded.values()].map(position => ({ ...position }));
    }

    /** Returns source failures retained within the unload radius. Failed columns do not block other loads. */
    public get failedChunks(): readonly { x: number; z: number; error: unknown }[] {
        return [...this.failed.values()].map(failure => ({ ...failure }));
    }

    /** Counts desired columns still waiting for a source read or placement, including the active column. */
    public get pendingChunks(): number {
        return this.desired.filter(position => this.needsLoad(position)).length;
    }

    /**
     * Updates the center in absolute chunk coordinates. Repeated calls share the active drain.
     * Source failures are recorded in failedChunks; other columns continue loading. Missing and failed
     * columns are remembered within the retention radius. Call retryFailedChunks to retry source failures.
     * Placement and unload failures reject the drain; call update again to retry those operations.
     * Reads outside the latest load radius receive an abort signal; placement finishes before unloading.
     * Sources should represent an unchanged world during streaming.
     */
    public async update(x: number, z: number): Promise<void> {
        if (this.disposed) throw new Error("WorldStreamer is disposed");
        if (![x, z].every(value => Number.isSafeInteger(value)
            && Number.isSafeInteger(value - this.unloadRadius) && Number.isSafeInteger(value + this.unloadRadius))) {
            throw new RangeError("Chunk coordinates must be safe integers within the streaming radius");
        }
        if (!this.center || this.center.x !== x || this.center.z !== z) {
            this.center = { x, z };
            this.desired = [];
            for (let dz = -this.loadRadius; dz <= this.loadRadius; dz++) {
                for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
                    this.desired.push({ x: x + dx, z: z + dz });
                }
            }
            this.desired.sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - (b.x - x) ** 2 - (b.z - z) ** 2);
            if (this.loading && !this.within(this.loading.position, this.loadRadius)) {
                this.loading.controller.abort();
            }
        }
        return this.running ??= Promise.resolve().then(() => this.drain());
    }

    /** Updates from a camera or view-center position in scene units. One chunk spans 256 scene units. */
    public async updatePosition(position: { x: number; z: number }): Promise<void> {
        if (![position.x, position.z].every(Number.isFinite)) throw new RangeError("Scene coordinates must be finite");
        return this.update(Math.floor(position.x / 256), Math.floor(position.z / 256));
    }

    /** Forgets recorded source failures and retries desired columns at the latest center. */
    public async retryFailedChunks(): Promise<void> {
        if (this.disposed) throw new Error("WorldStreamer is disposed");
        this.failed.clear();
        if (this.center) await this.update(this.center.x, this.center.z);
    }

    /** Aborts source reads, waits for active work, then unloads owned columns. The world and source remain caller-owned. */
    public dispose(): Promise<void> {
        this.disposed = true;
        this.desired = [];
        this.center = undefined;
        this.loading?.controller.abort();
        return this.disposal ??= Promise.resolve().then(async () => {
            await this.running?.catch(() => undefined);
            let failure: unknown;
            let failed = false;
            for (const position of this.owned.values()) {
                try {
                    await this.unload(position);
                } catch (error) {
                    failed = true;
                    failure ??= error;
                }
            }
            this.missing.clear();
            this.failed.clear();
            if (failed) throw failure;
        }).catch(error => {
            this.disposal = undefined;
            throw error;
        });
    }

    private async drain(): Promise<void> {
        try {
            while (!this.disposed) {
                for (const [key, position] of this.missing) {
                    if (!this.within(position, this.unloadRadius)) this.missing.delete(key);
                }
                for (const [key, position] of this.failed) {
                    if (!this.within(position, this.unloadRadius)) this.failed.delete(key);
                }
                // Failed placements remain owned until cleanup succeeds, even inside the retained area.
                const obsolete = [...this.owned.values()].find(position =>
                    !this.loaded.has(this.key(position)) || !this.within(position, this.unloadRadius));
                if (obsolete) {
                    await this.unload(obsolete);
                    continue;
                }
                const position = this.desired.find(position => this.needsLoad(position));
                if (!position) return;
                let chunk: AnvilChunk | undefined;
                const controller = new AbortController();
                this.loading = { position, controller };
                try {
                    chunk = await this.source.getChunk(position.x, position.z, controller.signal);
                    if (chunk) this.validateChunk(chunk, position);
                } catch (error) {
                    if (!controller.signal.aborted && !this.disposed && this.within(position, this.loadRadius)) {
                        this.failed.set(this.key(position), { ...position, error });
                    }
                    continue;
                } finally {
                    this.loading = undefined;
                }
                if (controller.signal.aborted || this.disposed || !this.within(position, this.loadRadius)) continue;
                if (!chunk) {
                    this.missing.set(this.key(position), position);
                    continue;
                }
                this.owned.set(this.key(position), position);
                try {
                    await this.world.placeChunk(chunk);
                    this.loaded.set(this.key(position), position);
                } catch (error) {
                    try {
                        await this.unload(position);
                    } catch (cleanupError) {
                        const failure = error instanceof Error ? error : new Error(String(error));
                        try {
                            Object.defineProperty(failure, "cause", { value: cleanupError, configurable: true });
                        } catch {
                            throw Object.assign(new Error(failure.message), { cause: cleanupError });
                        }
                        throw failure;
                    }
                    throw error;
                }
            }
        } finally {
            this.running = undefined;
        }
    }

    private needsLoad(position: ChunkPosition): boolean {
        const key = this.key(position);
        return !this.loaded.has(key) && !this.missing.has(key) && !this.failed.has(key);
    }

    private async unload(position: ChunkPosition): Promise<void> {
        await this.world.unloadChunkColumn(position.x, position.z);
        this.owned.delete(this.key(position));
        this.loaded.delete(this.key(position));
    }

    private validateChunk(chunk: AnvilChunk, position: ChunkPosition): void {
        if (chunk.x !== position.x || chunk.z !== position.z) {
            throw new Error(`World source returned chunk ${chunk.x},${chunk.z} for ${position.x},${position.z}`);
        }
    }

    private within(position: ChunkPosition, radius: number): boolean {
        return !!this.center && Math.abs(position.x - this.center.x) <= radius && Math.abs(position.z - this.center.z) <= radius;
    }

    private key(position: ChunkPosition): string {
        return `${position.x},${position.z}`;
    }
}
