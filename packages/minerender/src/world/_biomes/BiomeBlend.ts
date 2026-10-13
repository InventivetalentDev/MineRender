import { AssetKey } from "../../assets/AssetKey";
import { AssetLoader } from "../../assets/AssetLoader";
import { Biomes, type BiomeColorKind } from "../../assets/Biomes";
import { swampGrassColor } from "../../assets/_biomes/SwampGrassColor";
import { Caching } from "../../cache/Caching";
import type { TripleArray } from "../../model/Model";

const MAX_TILES = 256;

interface ColorTile {
    x: number;
    z: number;
    colors: Promise<{ colors: Int32Array; failures: Map<string, unknown> }>;
}

export function validateBiomeBlendRadius(radius: number): void {
    if (!Number.isInteger(radius) || radius < 0 || radius > 7) {
        throw new RangeError("biomeBlendRadius must be an integer from 0 to 7");
    }
}

/** Caches horizontal color averages for saved quart-resolution biome samples. */
export class BiomeBlend {

    private readonly tiles = new Map<string, ColorTile>();
    private generation = Caching.generation;
    private _radius: number;

    constructor(private readonly biomeAt: (x: number, y: number, z: number) => string | undefined, radius: number) {
        validateBiomeBlendRadius(radius);
        this._radius = radius;
    }

    get radius(): number { return this._radius; }

    clear(): void { this.tiles.clear(); }

    invalidateColumn(x: number, z: number): void {
        for (const [key, tile] of this.tiles) {
            if (Math.abs(tile.x - x) <= 1 && Math.abs(tile.z - z) <= 1) this.tiles.delete(key);
        }
    }

    async getColor(kind: BiomeColorKind, origin: AssetKey | undefined, position: Readonly<TripleArray>): Promise<number | undefined> {
        const [x, y, z] = position;
        const biome = this.biomeAt(x, y, z);
        if (biome === undefined) return undefined;
        if (this.generation !== Caching.generation) {
            this.clear();
            this.generation = Caching.generation;
        }
        const tileX = Math.floor(x / 16), tileZ = Math.floor(z / 16), quartY = Math.floor(y / 4);
        const root = origin?.root ?? AssetLoader.ROOT;
        const key = JSON.stringify([root, AssetLoader.persistentScope, kind, this._radius, tileX, quartY, tileZ]);
        let tile = this.tiles.get(key);
        if (tile) {
            this.tiles.delete(key);
            this.tiles.set(key, tile);
        } else {
            const snapshot = new AssetKey("minecraft", "", undefined, undefined, "assets", ".json", root);
            const colors = this.buildTile(kind, snapshot, tileX, quartY, tileZ, this._radius).then(result => {
                if (!result.complete && this.tiles.get(key)?.colors === colors) this.tiles.delete(key);
                return result;
            }, error => {
                if (this.tiles.get(key)?.colors === colors) this.tiles.delete(key);
                throw error;
            });
            tile = { x: tileX, z: tileZ, colors };
            this.tiles.set(key, tile);
            if (this.tiles.size > MAX_TILES) this.tiles.delete(this.tiles.keys().next().value!);
        }
        const result = await tile.colors;
        if (result.failures.has(biome)) throw result.failures.get(biome);
        const color = result.colors[(z - tileZ * 16) * 16 + x - tileX * 16];
        return color === -1 ? undefined : color;
    }

    private async buildTile(kind: BiomeColorKind, origin: AssetKey, tileX: number, quartY: number, tileZ: number, radius: number) {
        const size = 16 + radius * 2, stride = size + 1;
        const startX = tileX * 16 - radius, startZ = tileZ * 16 - radius;
        const quartX = Math.floor(startX / 4), quartZ = Math.floor(startZ / 4);
        const quartSize = Math.floor((startX + size - 1) / 4) - quartX + 1;
        const ids: Array<string | undefined> = new Array(quartSize * quartSize);
        const biomes = new Map<string, Promise<{ color: number | undefined; swamp: boolean }>>();
        for (let z = 0; z < quartSize; z++) {
            for (let x = 0; x < quartSize; x++) {
                const id = this.biomeAt((quartX + x) * 4, quartY * 4, (quartZ + z) * 4);
                ids[z * quartSize + x] = id;
                if (id !== undefined && !biomes.has(id)) {
                    biomes.set(id, (async () => {
                        const swamp = kind === "grass" && (await Biomes.get(id, origin))?.effects.grass_color_modifier === "swamp";
                        return { color: swamp ? undefined : await Biomes.getColor(id, kind, origin), swamp };
                    })());
                }
            }
        }
        const failures = new Map<string, unknown>();
        const loaded = new Map(await Promise.all([...biomes].map(async ([id, color]) => {
            try {
                return [id, await color] as const;
            } catch (error) {
                failures.set(id, error);
                return [id, { color: undefined, swamp: false }] as const;
            }
        })));
        const complete = [...loaded.values()].every(value => value.swamp || value.color !== undefined);
        const samples = new Int32Array(size * size).fill(-1);
        const sums = Array.from({ length: 4 }, () => new Uint32Array(stride * stride));
        for (let z = 0; z < size; z++) {
            const row = [0, 0, 0, 0];
            for (let x = 0; x < size; x++) {
                const id = ids[(Math.floor((startZ + z) / 4) - quartZ) * quartSize + Math.floor((startX + x) / 4) - quartX];
                const value = id === undefined ? undefined : loaded.get(id);
                const color = value?.swamp ? swampGrassColor(startX + x, startZ + z) : value?.color;
                if (color !== undefined) {
                    samples[z * size + x] = color;
                    row[0] += color >> 16 & 255;
                    row[1] += color >> 8 & 255;
                    row[2] += color & 255;
                    row[3]++;
                }
                for (let channel = 0; channel < 4; channel++) {
                    sums[channel][(z + 1) * stride + x + 1] = sums[channel][z * stride + x + 1] + row[channel];
                }
            }
        }
        // Summed-area tables reuse each sample across all 256 block positions in this tile.
        const colors = new Int32Array(256).fill(-1), width = radius * 2 + 1;
        for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
                if (samples[(z + radius) * size + x + radius] === -1) continue;
                const topLeft = z * stride + x, topRight = topLeft + width;
                const bottomLeft = (z + width) * stride + x, bottomRight = bottomLeft + width;
                const sum = (values: Uint32Array) => values[bottomRight] - values[bottomLeft] - values[topRight] + values[topLeft];
                const count = sum(sums[3]);
                if (count) colors[z * 16 + x] = Math.floor(sum(sums[0]) / count) << 16
                    | Math.floor(sum(sums[1]) / count) << 8 | Math.floor(sum(sums[2]) / count);
            }
        }
        return { colors, complete, failures };
    }
}
