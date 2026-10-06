import type { MultiBlockBlock, MultiBlockStructure } from "minerender";

export interface Workload {
    shape: "cube" | "sphere";
    count: number;
    width: number;
    height: number;
    depth: number;
    radius: number;
    spacing: number;
    seed: number;
    blocks: string;
}

export const defaultWorkload: Workload = {
    shape: "cube", count: 1000, width: 10, height: 10, depth: 10,
    radius: 12, spacing: 1, seed: 42, blocks: "stone"
};

export function integer(value: unknown, label: string, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
    return value;
}

export function blockId(value: string): string {
    const id = value.trim();
    if (!/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(id)) throw new Error("Use a block ID, such as minecraft:stone.");
    return id.includes(":") ? id : `minecraft:${id}`;
}

function random(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
        value = (value + 0x6d2b79f5) | 0;
        let mixed = Math.imul(value ^ value >>> 15, value | 1);
        mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
        return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
    };
}

export function makeWorkload(options: Workload): MultiBlockStructure {
    const count = integer(options.count, "Block count", 1, 50000);
    const spacing = integer(options.spacing, "Spacing", 1, 16);
    const seeded = random(integer(options.seed, "Seed", 0, 4294967295));
    const types = options.blocks.split(",").map(blockId);
    if (types.length > 64) throw new Error("Use at most 64 block types.");
    const positions: [number, number, number][] = [];
    if (options.shape === "sphere") {
        const radius = integer(options.radius, "Sphere radius", 1, 40);
        for (let y = -radius; y <= radius; y++) {
            for (let z = -radius; z <= radius; z++) {
                for (let x = -radius; x <= radius; x++) {
                    if (x * x + y * y + z * z <= radius * radius) positions.push([x * spacing, y * spacing, z * spacing]);
                }
            }
        }
    } else if (options.shape === "cube") {
        const width = integer(options.width, "Width", 1, 64);
        const height = integer(options.height, "Height", 1, 64);
        const depth = integer(options.depth, "Depth", 1, 64);
        for (let y = 0; y < height; y++) {
            for (let z = 0; z < depth; z++) {
                for (let x = 0; x < width; x++) positions.push([x * spacing, y * spacing, z * spacing]);
            }
        }
    } else {
        throw new Error("Choose a cube or sphere workload.");
    }
    if (count > positions.length) throw new Error(`These dimensions contain ${positions.length} distinct positions. Reduce the block count or increase the dimensions.`);
    const blocks: MultiBlockBlock[] = [];
    for (let i = 0; i < count; i++) {
        const selected = i + Math.floor(seeded() * (positions.length - i));
        [positions[i], positions[selected]] = [positions[selected], positions[i]];
        blocks.push({ position: positions[i], type: types[Math.floor(seeded() * types.length)] });
    }
    const dimensions = options.shape === "sphere"
        ? [options.radius * 2 + 1, options.radius * 2 + 1, options.radius * 2 + 1]
        : [options.width, options.height, options.depth];
    return { size: dimensions.map(value => (value - 1) * spacing + 1) as [number, number, number], blocks };
}

export function makePreset(name: string): MultiBlockStructure {
    const blocks: MultiBlockBlock[] = [];
    const add = (type: string, position: [number, number, number], properties?: Record<string, string>) => blocks.push({ type, position, properties });
    if (name === "culling") {
        for (let z = 0; z < 3; z++) {
            for (let y = 0; y < 3; y++) {
                for (let x = 14; x < 18; x++) add("stone", [x, y, z]);
            }
        }
        add("glass", [18, 0, 1]);
        add("oak_slab", [19, 0, 1], { type: "bottom", waterlogged: "false" });
    } else if (name === "fluids") {
        for (let z = 0; z < 5; z++) {
            for (let x = 0; x < 10; x++) add("stone", [x, -1, z]);
        }
        for (let x = 0; x < 8; x++) add("water", [x, 0, 1], { level: String(x) });
        for (let x = 0; x < 4; x++) add("lava", [x, 0, 3], { level: String(x * 2) });
        add("oak_slab", [8, 0, 1], { type: "bottom", waterlogged: "true" });
        add("seagrass", [9, 0, 1]);
        add("bubble_column", [8, 0, 3], { drag: "false" });
        add("kelp", [9, 0, 3], { age: "0" });
    } else {
        throw new Error("Choose the culling or fluids preset.");
    }
    return { size: [20, 5, 5], blocks };
}
