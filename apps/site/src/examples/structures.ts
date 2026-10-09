import { AnvilParser, AssetKey, AssetLoader, AssetParser, ChunkData, MineRenderWorld, MultiBlockStructure, NBTAsset, NBTHelper, Renderer, SchematicParser, StructureParser, WorldStreamer, type AnvilChunk, type WorldChunkSource } from "minerender";
import type { Example, ExampleGroup } from "./types";
import type { ExampleContext } from "./types";
import { esmRenderer, fileControl, selectControl, statusControl, textControl, toggleControl } from "./shared";
import { Box3, PerspectiveCamera, Vector3 } from "three";

const STRUCTURES = [
    "village/plains/houses/plains_small_house_1",
    "end_city/ship",
    "end_city/base_floor",
    "igloo/top",
    "igloo/bottom",
    "village/plains/houses/plains_medium_house_1",
    "village/plains/town_centers/plains_fountain_01",
    "village/desert/houses/desert_small_house_1",
    "village/savanna/houses/savanna_small_house_1",
    "village/taiga/houses/taiga_small_house_1",
    "pillager_outpost/watchtower",
    "shipwreck/with_mast",
    "ruined_portal/portal_1",
    "underwater_ruin/brick_1"
];

async function loadStructure(name: string) {
    const key = new AssetKey("minecraft", name, "structure", undefined, "data", ".nbt");
    const asset = await AssetLoader.get<NBTAsset>(key, AssetParser.NBT);
    if (!asset) throw new Error(`Unknown structure "${name}"`);
    return StructureParser.parse(asset);
}

/** Points the camera at a block-coordinate bounding box, from the current direction. */
function frameBlocks(renderer: Renderer, bounds: Box3): void {
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new Vector3());
    const radius = bounds.getSize(new Vector3()).length() / 2;
    const camera = renderer.camera as PerspectiveCamera;
    const vertical = camera.fov * Math.PI / 360;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.15;
    const controls = renderer.orbitControls;
    const direction = camera.position.clone().sub(controls?.target ?? new Vector3()).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.far = Math.max(camera.far, distance + radius * 4);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    if (controls) {
        controls.target.copy(center);
        controls.update();
        controls.saveState();
    }
    renderer.dirty = true;
}

function structureBounds(structure: MultiBlockStructure): Box3 {
    const [sx, sy, sz] = structure.size;
    return new Box3(new Vector3(-8, -8, -8), new Vector3(sx * 16 - 8, sy * 16 - 8, sz * 16 - 8));
}

const vanilla: Example = {
    id: "structure-vanilla",
    title: "Vanilla structure files",
    description: "Structure .nbt files are parsed in the browser and placed into a world in batches. Section meshing merges static opaque cubes into one mesh per 16³ section, with neighbor faces culled.",
    renderer: {
        camera: {
            position: [230, 170, 230] as [number, number, number],
            lookingAt: [72, 40, 72] as [number, number, number],
            far: 10000
        }
    },
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        let sectionMeshing = true;
        let world = new MineRenderWorld(renderer.scene, { sectionMeshing });
        let structure: MultiBlockStructure | undefined;
        let token = 0;
        const status = statusControl(context);

        const place = async () => {
            if (!structure) return;
            const current = ++token;
            await world.clear();
            if (signal.aborted || current !== token) return;
            frameBlocks(renderer, structureBounds(structure));
            await context.track(world.placeMultiBlock(structure), "Placing blocks…");
            if (current === token) {
                const stats = renderer.scene.stats;
                status.textContent = `${structure.blocks.length} blocks, ${stats.objectCount} objects`;
            }
            renderer.dirty = true;
        };
        const show = async (name: string) => {
            structure = await context.track(loadStructure(name), "Loading structure…");
            if (signal.aborted) return;
            await place();
        };

        textControl(context, "Structure", STRUCTURES[0], name => {
            if (name) show(name).catch(error => {
                console.warn(error);
                status.textContent = `Could not load "${name}".`;
            });
        }, STRUCTURES);
        toggleControl(context, "Section meshing", sectionMeshing, enabled => {
            sectionMeshing = enabled;
            world.clear().then(() => {
                world = new MineRenderWorld(renderer.scene, { sectionMeshing });
                return place();
            }).catch(console.warn);
        });
        await show(STRUCTURES[0]);

        return () => {
            token++;
            world.clear().catch(() => undefined);
        };
    },
    code: {
        esm: `${esmRenderer("AssetKey", "AssetLoader", "AssetParser", "MineRenderWorld", "StructureParser")}

const key = new AssetKey("minecraft", "village/plains/houses/plains_small_house_1", "structure", undefined, "data", ".nbt");
const nbt = await AssetLoader.get(key, AssetParser.NBT);
const structure = await StructureParser.parse(nbt!);

// Section meshing merges static opaque cubes per 16³ section and culls hidden faces
const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true });
await world.placeMultiBlock(structure);`
    }
};

const ownFile: Example = {
    id: "structure-file",
    title: "Your own files",
    description: "Drop in a structure .nbt, a legacy .schematic, or a Java region .mca file. Regions load one chunk column at a time.",
    renderer: {
        camera: {
            position: [230, 170, 230] as [number, number, number],
            lookingAt: [72, 40, 72] as [number, number, number],
            far: 10000
        }
    },
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer, signal } = context;
        const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true });
        const status = statusControl(context);
        let token = 0;

        const run = async (label: string, work: () => Promise<Box3>) => {
            const current = ++token;
            try {
                await world.clear();
                if (signal.aborted || current !== token) return;
                const bounds = await context.track(work(), `Loading ${label}…`);
                if (current !== token) return;
                frameBlocks(renderer, bounds);
                status.textContent = label;
            } catch (error) {
                console.warn(error);
                status.textContent = error instanceof Error ? error.message : `Could not load ${label}.`;
            }
        };

        const showFile = async (file: File) => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const extension = file.name.split(".").pop()?.toLowerCase();
            if (extension === "mca") {
                const chunks = AnvilParser.getChunkList(bytes);
                if (!chunks.length) throw new Error("This region contains no chunks.");
                // Show the first stored chunk column
                const chunk = await AnvilParser.parseChunk(bytes, chunks[0].x, chunks[0].z);
                if (!chunk) throw new Error("The first chunk is empty.");
                await world.placeChunk(chunk);
                const bounds = new Box3();
                for (const section of chunk.sections) {
                    for (let index = 0; index < 4096; index++) {
                        if (!section.data.get(index)) continue;
                        const position = new Vector3(chunk.x * 16 + (index & 15), section.y * 16 + (index >> 8), chunk.z * 16 + ((index >> 4) & 15)).multiplyScalar(16);
                        bounds.expandByPoint(position.clone().addScalar(-8));
                        bounds.expandByPoint(position.addScalar(8));
                    }
                }
                return bounds;
            }
            if (extension !== "nbt" && extension !== "schematic") throw new Error("Choose an .nbt, .schematic, or .mca file.");
            const nbt = await NBTHelper.fromBuffer(bytes);
            const structure = extension === "schematic" ? await SchematicParser.parse(nbt) : await StructureParser.parse(nbt);
            await world.placeMultiBlock(structure);
            return structureBounds(structure);
        };

        fileControl(context, "File", ".nbt,.schematic,.mca", file => void run(file.name, () => showFile(file)));
        await run("igloo/top", async () => {
            const structure = await loadStructure("igloo/top");
            await world.placeMultiBlock(structure);
            return structureBounds(structure);
        });

        return () => {
            token++;
            world.clear().catch(() => undefined);
        };
    },
    code: {
        esm: `${esmRenderer("AnvilParser", "MineRenderWorld", "NBTHelper", "SchematicParser", "StructureParser")}

const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true });
const bytes = new Uint8Array(await file.arrayBuffer());

if (file.name.endsWith(".mca")) {
    // Java region files: pick a chunk column (region-local 0–31) and place it at its world position
    const [first] = AnvilParser.getChunkList(bytes);
    const chunk = await AnvilParser.parseChunk(bytes, first.x, first.z);
    await world.placeChunk(chunk!);
} else {
    const nbt = await NBTHelper.fromBuffer(bytes);
    const structure = file.name.endsWith(".schematic")
        ? await SchematicParser.parse(nbt)     // legacy numeric block IDs
        : await StructureParser.parse(nbt);    // vanilla structure block format
    await world.placeMultiBlock(structure);
}`
    }
};

const programmatic: Example = {
    id: "structure-world",
    title: "Build a world in code",
    description: "MineRenderWorld places Block descriptors on a 16³ chunk grid with signed coordinates. Faces against opaque neighbors are culled, and identical blocks share instanced meshes.",
    renderer: {
        camera: {
            position: [230, 170, 230] as [number, number, number],
            lookingAt: [72, 24, 72] as [number, number, number],
            far: 10000
        }
    },
    placeholder: "/placeholder-block.png",
    async setup({ renderer, signal }) {
        const world = new MineRenderWorld(renderer.scene);
        const pending: Promise<unknown>[] = [];
        const size = 10;
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                const height = 2 + Math.round(2 + 1.5 * Math.sin(x * 0.7) + 1.5 * Math.cos(z * 0.6));
                for (let y = 0; y < height; y++) {
                    const type = y === height - 1 ? "minecraft:moss_block" : y === 0 ? "minecraft:stone" : "minecraft:dirt";
                    pending.push(world.setBlockAt(x, y, z, { type }));
                }
            }
        }
        await Promise.all(pending);
        if (signal.aborted) return;
        renderer.dirty = true;
        return () => {
            world.clear().catch(() => undefined);
        };
    },
    code: {
        esm: `${esmRenderer("MineRenderWorld")}

const world = new MineRenderWorld(renderer.scene);

for (let x = 0; x < 10; x++) {
    for (let z = 0; z < 10; z++) {
        const height = 2 + Math.round(2 + 1.5 * Math.sin(x * 0.7) + 1.5 * Math.cos(z * 0.6));
        for (let y = 0; y < height; y++) {
            const type = y === height - 1 ? "minecraft:moss_block" : "minecraft:dirt";
            await world.setBlockAt(x, y, z, { type });
        }
    }
}`
    }
};

/** Procedural chunk columns. A source answers getChunk with absolute chunk coordinates; AnvilWorldSource does the same from region files. */
const terrain: WorldChunkSource = {
    async getChunk(x, z): Promise<AnvilChunk> {
        const data = new ChunkData();
        for (let localZ = 0; localZ < 16; localZ++) {
            for (let localX = 0; localX < 16; localX++) {
                const worldX = x * 16 + localX, worldZ = z * 16 + localZ;
                const height = 3 + Math.floor((Math.sin(worldX / 11) + Math.cos(worldZ / 15) + 2) * 1.5);
                for (let y = 0; y <= height; y++) {
                    const type = y === height ? "minecraft:grass_block" : y >= height - 2 ? "minecraft:dirt" : "minecraft:stone";
                    data.set(localX + localZ * 16 + y * 256, { type });
                }
            }
        }
        return { x, z, sections: [{ y: 0, data }] };
    }
};

const streaming: Example = {
    id: "structure-streaming",
    title: "Stream chunks around the view",
    description: "WorldStreamer loads the chunk columns near a position in distance order and unloads the ones beyond its retention radius. Pan the view to pull in new terrain. Java worlds stream the same way through AnvilWorldSource.",
    renderer: {
        camera: {
            position: [420, 260, 420] as [number, number, number],
            lookingAt: [128, 40, 128] as [number, number, number],
            far: 10000
        }
    },
    placeholder: "/placeholder-block.png",
    async setup(context) {
        return streamAround(context, context.renderer.orbitControls?.target ?? context.renderer.camera.position);
    },
    code: {
        esm: `${esmRenderer("AnvilWorldSource", "ChunkData", "MineRenderWorld", "WorldStreamer")}

// A chunk source answers getChunk(x, z) with absolute chunk coordinates, or undefined where nothing exists
const terrain = {
    async getChunk(x: number, z: number) {
        const data = new ChunkData();   // 16×16×16 block states, indexed x + z * 16 + y * 256
        for (let i = 0; i < 256; i++) data.set(i, { type: "minecraft:grass_block" });
        return { x, z, sections: [{ y: 0, data }] };
    }
};

// Java worlds: hand AnvilWorldSource the bytes of r.<x>.<z>.mca on demand
const save = new AnvilWorldSource(async (regionX, regionZ, signal) => {
    const response = await fetch(\`/world/region/r.\${regionX}.\${regionZ}.mca\`, { signal });
    return response.ok ? response.arrayBuffer() : undefined;
});

const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true });
const streamer = new WorldStreamer(world, terrain, { loadRadius: 2, unloadRadius: 3 });

// Load the columns around the orbit target, nearest first; call again whenever it moves
await streamer.updatePosition(renderer.orbitControls!.target);
renderer.orbitControls!.addEventListener("change", () => void streamer.updatePosition(renderer.orbitControls!.target));

streamer.loadedChunks;              // what is on screen
await streamer.retryFailedChunks(); // after source errors (listed in streamer.failedChunks)
await streamer.dispose();           // unloads its columns; the world stays yours`
    }
};

/** Streams procedural terrain around a point and reloads whenever the controls move it. Returns the cleanup. */
async function streamAround(context: ExampleContext, center: Vector3): Promise<() => void> {
    const { renderer, signal } = context;
    const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true });
    const streamer = new WorldStreamer(world, terrain, { loadRadius: 2, unloadRadius: 3 });
    const status = statusControl(context);
    let chunk = "";
    let running = false, queued = false;
    const update = async () => {
        const next = `${Math.floor(center.x / 256)},${Math.floor(center.z / 256)}`;
        if (next === chunk && !queued) return;
        chunk = next;
        if (running) { queued = true; return; }
        running = true;
        try {
            do {
                queued = false;
                await streamer.updatePosition(center);
            } while (queued && !signal.aborted);
            status.textContent = `${streamer.loadedChunks.length} chunk columns loaded`;
        } catch (error) {
            console.warn(error);
        } finally {
            running = false;
        }
    };
    await context.track(update(), "Loading chunks…");
    const onChange = () => void update();
    renderer.controls?.addEventListener("change", onChange);
    return () => {
        renderer.controls?.removeEventListener("change", onChange);
        streamer.dispose().then(() => world.clear()).catch(() => undefined);
    };
}

const flying: Example = {
    id: "structure-flying",
    title: "Fly through the terrain",
    description: "Creative-style flight: click the view, then W/A/S/D move, space rises, shift descends, control sprints, and the mouse looks around. Scroll to change the speed, as in spectator mode. On touch screens, the left half is a joystick and the right half looks.",
    renderer: {
        camera: {
            position: [128, 90, 300] as [number, number, number],
            lookingAt: [128, 60, 128] as [number, number, number],
            far: 10000
        },
        controls: { enabled: true, mode: "fly" as const }
    },
    placeholder: "/placeholder-block.png",
    async setup(context) {
        const { renderer } = context;
        const fly = renderer.flyControls!;
        // Releasing the pointer on each click keeps the rest of the page usable; dragging still looks around.
        fly.pointerLock = false;
        const speeds: Array<[string, string]> = [["0.5", "Half speed"], ["1", "Vanilla flight"], ["3", "Fast"], ["10", "Very fast"]];
        const base = fly.movementSpeed;
        selectControl(context, "Speed", speeds, "1", value => { fly.movementSpeed = base * Number(value); });
        return streamAround(context, renderer.camera.position);
    },
    code: {
        esm: `${esmRenderer("ChunkData", "MineRenderWorld", "WorldStreamer")}

// controls.mode: "fly" replaces OrbitControls with creative-style flight.
// WASD moves along the view direction, space/shift move vertically, control sprints,
// the mouse looks around (click to capture it, Esc releases), and the wheel changes the speed.
const renderer = new Renderer({
    camera: { position: [128, 90, 300], lookingAt: [128, 60, 128], far: 10000 },
    controls: { enabled: true, mode: "fly" }
});

const fly = renderer.flyControls!;
fly.movementSpeed = 16 * 20;   // scene units per second: 20 blocks/s
fly.pointerLock = false;       // drag to look instead of capturing the pointer
fly.speedRange = [16, 16000];  // wheel limits

const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true });
const streamer = new WorldStreamer(world, terrain, { loadRadius: 2, unloadRadius: 3 });

// While flying, the camera itself is the view center
await streamer.updatePosition(renderer.camera.position);
fly.addEventListener("change", () => void streamer.updatePosition(renderer.camera.position));

// Switch modes at runtime; the camera stays where it is
renderer.setControlsMode("orbit");`
    }
};

export const structures: ExampleGroup = {
    id: "structures",
    title: "Structures & worlds",
    lead: "Load structure, schematic, and region files, stream chunks around the view, or place blocks from code. Sections can be merged into single meshes built off the main thread.",
    playgrounds: [{ url: "https://beta.minerender.org/demo/structure/", label: "Structure playground" }, { url: "https://beta.minerender.org/demo/world/", label: "World streaming demo" }],
    examples: [vanilla, ownFile, streaming, flying, programmatic]
};
