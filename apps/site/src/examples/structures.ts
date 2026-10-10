import { AnvilParser, AssetKey, AssetLoader, AssetParser, MineRenderWorld, MultiBlockStructure, NBTAsset, NBTHelper, Renderer, SchematicParser, StructureParser } from "minerender";
import type { Example, ExampleGroup } from "./types";
import { esmRenderer, fileControl, statusControl, textControl, toggleControl } from "./shared";
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
    const direction = camera.position.clone().sub(renderer.controls?.target ?? new Vector3()).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.far = Math.max(camera.far, distance + radius * 4);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    if (renderer.controls) {
        renderer.controls.target.copy(center);
        renderer.controls.update();
        renderer.controls.saveState();
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
    description: "Structure .nbt files are parsed in the browser and placed into a world in batches. Section meshing merges static block models into solid and translucent meshes per 16³ section, with neighbor faces culled.",
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

// Section meshing merges static block models per 16³ section and culls hidden faces
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

export const structures: ExampleGroup = {
    id: "structures",
    title: "Structures & worlds",
    lead: "Load structure, schematic, and region files or place blocks from code. Sections can be merged into single meshes.",
    playgrounds: [{ url: "https://beta.minerender.org/demo/structure/", label: "Structure playground" }],
    examples: [vanilla, ownFile, programmatic]
};
