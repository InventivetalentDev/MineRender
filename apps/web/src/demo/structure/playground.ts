import {
    AnvilParser, AssetKey, AssetLoader, AssetParser, MineRenderWorld, NBTHelper, SchematicParser, StructureParser,
    type ListAsset, type MultiBlockStructure, type NBTAsset
} from "minerender";
import { Box3, Vector3 } from "three";
import { Playground, type DemoContext } from "../../playground/Playground";
import { blockId, defaultWorkload, integer, makePreset, makeWorkload, type Workload } from "./workloads";

type Edit = { position: [number, number, number]; type: string; properties?: Record<string, string> };
interface WorldState {
    source: "builtin" | "file" | "preset" | "workload" | "empty";
    name: string;
    namespace: string;
    fileName: string;
    chunk: string;
    preset: string;
    sectionMeshing: boolean;
    maxAtlasSize: number;
    workload: Workload;
    edits: Edit[];
}

export function startWorldPlayground(title: string, shape?: Workload["shape"]) {
    let localFile: { name: string; bytes: Uint8Array } | undefined;
    let activeWorld: MineRenderWorld<boolean> | undefined;
    let suggestionsGeneration = 0;
    let fileGeneration = 0;
    const defaults: WorldState = {
        source: shape ? "workload" : "builtin", name: "end_city/ship", namespace: "minecraft", fileName: "", chunk: "", preset: "culling",
        sectionMeshing: false, maxAtlasSize: 2048,
        workload: { ...defaultWorkload, shape: shape ?? "cube", blocks: shape === "sphere" ? "stone,glass,oak_planks" : "stone" }, edits: []
    };
    const app = new Playground<WorldState>({
        title,
        defaults,
        renderer: { camera: { near: 1, far: 10000, position: [550, 400, 550] }, controls: { enabled: true }, composer: { enabled: false } },
        presets: {
            ship: { label: "End city ship", state: { source: "builtin", name: "end_city/ship", namespace: "minecraft", edits: [] } },
            culling: { label: "Culling across chunk boundaries", state: { source: "preset", preset: "culling", edits: [] } },
            fluids: { label: "Fluids and waterlogged blocks", state: { source: "preset", preset: "fluids", edits: [] } },
            cube: { label: "Seeded cube", state: { source: "workload", workload: { ...defaultWorkload }, edits: [] } },
            sphere: { label: "Seeded sphere", state: { source: "workload", workload: { ...defaultWorkload, shape: "sphere", blocks: "stone,glass,oak_planks" }, edits: [] } }
        },
        code: worldCode,
        load: async (ctx, state) => {
            const start = performance.now();
            const sourceFile = state.source === "file" ? localFile : undefined;
            const maxAtlasSize = integer(state.maxAtlasSize, "Atlas size", 16, 4096);
            if (maxAtlasSize & (maxAtlasSize - 1)) throw new Error("Choose an atlas size that is a power of two.");
            if (!/^[a-z0-9_.-]+$/.test(state.namespace)) throw new Error("Use a valid asset namespace.");
            const world = new MineRenderWorld(ctx.renderer.scene, { sectionMeshing: !!state.sectionMeshing, maxAtlasSize });
            ctx.onCleanup(() => world.clear());
            const bounds = new Box3();
            let count = 0;
            let label = "Empty world";
            let dataVersion: number | undefined;
            let chunks: { x: number; z: number }[] = [];
            let selectedChunk = state.chunk;
            let structure: MultiBlockStructure | undefined;
            if (state.source === "builtin") {
                if (!/^[a-z0-9_./-]+$/.test(state.name)) throw new Error("Use a structure path, such as end_city/ship.");
                const key = new AssetKey(state.namespace, state.name, "structure", undefined, "data", ".nbt");
                const asset = await AssetLoader.get<NBTAsset>(key, AssetParser.NBT);
                if (!asset) throw new Error(`Structure ${state.namespace}:${state.name} was not found.`);
                structure = await StructureParser.parse(asset);
                label = `${state.namespace}:${state.name}`;
            } else if (state.source === "file") {
                if (!sourceFile || sourceFile.name !== state.fileName) throw new Error(`Reselect ${state.fileName || "the local structure file"}. File contents are not included in shared links.`);
                const extension = sourceFile.name.split(".").pop()?.toLowerCase();
                label = sourceFile.name;
                if (extension === "mca") {
                    chunks = AnvilParser.getChunkList(sourceFile.bytes);
                    if (!chunks.length) throw new Error("This region contains no chunks.");
                    selectedChunk ||= `${chunks[0].x},${chunks[0].z}`;
                    const [x, z] = selectedChunk.split(",").map(Number);
                    if (!chunks.some(chunk => chunk.x === x && chunk.z === z)) throw new Error("Choose a chunk present in this region.");
                    const chunk = await AnvilParser.parseChunk(sourceFile.bytes, x, z);
                    if (!chunk) throw new Error("The selected chunk is empty.");
                    for (const section of chunk.sections) {
                        for (let index = 0; index < 4096; index++) {
                            if (!section.data.get(index)) continue;
                            includeBlock(bounds, [chunk.x * 16 + (index & 15), section.y * 16 + (index >> 8), chunk.z * 16 + ((index >> 4) & 15)]);
                            count++;
                        }
                    }
                    dataVersion = chunk.dataVersion;
                    label += ` · chunk ${chunk.x}, ${chunk.z}`;
                    await world.placeChunk(chunk);
                } else {
                    if (extension !== "nbt" && extension !== "schematic") throw new Error("Choose an .nbt, .schematic, or .mca file.");
                    const nbt = await NBTHelper.fromBuffer(sourceFile.bytes);
                    structure = extension === "schematic" ? await SchematicParser.parse(nbt) : await StructureParser.parse(nbt);
                }
            } else if (state.source === "preset") {
                structure = makePreset(state.preset);
                label = state.preset === "culling" ? "Culling across X=16" : "Fluids and waterlogged blocks";
            } else if (state.source === "workload") {
                structure = makeWorkload(state.workload);
                label = `${state.workload.shape} · seed ${state.workload.seed}`;
            } else if (state.source !== "empty") {
                throw new Error("Choose a world source.");
            }
            if (structure) {
                for (const block of structure.blocks) includeBlock(bounds, block.position);
                count = structure.blocks.length;
                dataVersion = structure.dataVersion;
                await world.placeMultiBlock(structure);
            }
            if (!Array.isArray(state.edits) || state.edits.length > 512) throw new Error("A configuration can contain up to 512 block edits.");
            for (const edit of state.edits) {
                validateEdit(edit);
                const existed = !!world.getBlockAt(edit.position);
                const remove = blockId(edit.type) === "minecraft:air";
                await world.setBlockAt(edit.position, remove ? undefined : { type: blockId(edit.type), properties: edit.properties });
                count += remove ? (existed ? -1 : 0) : (existed ? 0 : 1);
                if (!remove) includeBlock(bounds, edit.position);
            }
            const elapsed = performance.now() - start;
            const info = `${label}: ${count.toLocaleString()} blocks · ${(elapsed / 1000).toFixed(2)} s to load${dataVersion === undefined ? "" : ` · DataVersion ${dataVersion}`}`;
            const restore = () => {
                if (sourceFile) localFile = sourceFile;
                activeWorld = world;
                window["world"] = world;
                syncControls(chunks, selectedChunk);
                document.getElementById("world-result")!.textContent = info;
            };
            return {
                bounds,
                restore,
                activate: () => {
                    restore();
                    void refreshSuggestions(ctx, state.namespace);
                }
            };
        }
    });

    app.controls.innerHTML = `
        <p id="world-result" role="status" aria-live="polite"></p>
        <details ${shape ? "" : "open"}><summary>Structures and region files</summary>
            <label>Namespace<input id="structure-namespace" value="minecraft"></label>
            <label>Built-in structure<input id="structure-name" value="end_city/ship" list="structure-suggestions"></label>
            <datalist id="structure-suggestions"></datalist>
            <button id="structure-load" type="button">Load structure</button>
            <p id="suggestion-status"></p>
            <label>Local file (.nbt, .schematic, .mca)<input id="structure-file" type="file" accept=".nbt,.schematic,.mca"></label>
            <p>Files stay in this browser session. Shared links require selecting the file again.</p>
            <label id="chunk-picker" hidden>Chunk in region (local X, Z)<select id="chunk-input"></select></label>
        </details>
        <details open><summary>World rendering</summary>
            <label><input id="section-meshing" type="checkbox"> Merge opaque blocks into section meshes</label>
            <label>Maximum atlas size<select id="atlas-size"><option>256</option><option>512</option><option>1024</option><option selected>2048</option><option>4096</option></select></label>
            <p>Individual world blocks use instancing. Section meshes merge eligible opaque cubes; transparent and animated blocks retain individual objects.</p>
            <div class="playground-actions"><button id="world-clear" type="button">Clear world</button><button id="world-reload" type="button">Reload world</button></div>
        </details>
        <details ${shape ? "open" : ""}><summary>Seeded workloads</summary>
            <label>Shape<select id="work-shape"><option value="cube">Cube</option><option value="sphere">Sphere</option></select></label>
            <label>Block types (comma-separated)<input id="work-blocks" value="stone"></label>
            <label>Block count<input id="work-count" type="number" min="1" max="50000"></label>
            <div id="cube-dimensions" class="playground-grid">
                <label>Width<input id="work-width" type="number" min="1" max="64"></label>
                <label>Height<input id="work-height" type="number" min="1" max="64"></label>
                <label>Depth<input id="work-depth" type="number" min="1" max="64"></label>
            </div>
            <label id="sphere-radius">Radius<input id="work-radius" type="number" min="1" max="40"></label>
            <label>Spacing (blocks)<input id="work-spacing" type="number" min="1" max="16"></label>
            <label>Seed<input id="work-seed" type="number" min="0" max="4294967295"></label>
            <button id="work-run" type="button">Run workload</button>
            <p>The same seed, dimensions, count, and block list produce the same placements. Load times include cached asset work and vary between runs.</p>
        </details>
        <details><summary>Edit a block</summary>
            <div class="playground-grid"><label>X<input id="edit-x" type="number" value="0"></label><label>Y<input id="edit-y" type="number" value="0"></label><label>Z<input id="edit-z" type="number" value="0"></label></div>
            <label>Block ID<input id="edit-type" value="stone"></label>
            <label>Properties JSON<input id="edit-properties" value="{}" placeholder='{"waterlogged":"true"}'></label>
            <div class="playground-actions"><button id="edit-read" type="button">Read block</button><button id="edit-apply" type="button">Apply block</button><button id="edit-remove" type="button">Remove block</button><button id="edit-reset" type="button">Reset edits</button></div>
            <p id="edit-status"></p>
            <p>Edits rebuild this configuration and are included in shared links. In the culling preset, remove a block at X=15 or X=16 to inspect the chunk boundary.</p>
        </details>`;

    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    const select = (id: string) => document.getElementById(id) as HTMLSelectElement;
    function guard(task: () => void | Promise<void>) {
        void Promise.resolve().then(task).catch(error => app.report(error instanceof Error ? error.message : String(error), true));
    }
    async function updateAndFit(patch: Partial<WorldState>) {
        const previousRenderer = app.renderer;
        await app.update(patch);
        if (app.renderer !== previousRenderer) app.fit();
    }
    function syncShape() {
        document.getElementById("cube-dimensions")!.hidden = select("work-shape").value !== "cube";
        document.getElementById("sphere-radius")!.hidden = select("work-shape").value !== "sphere";
    }
    function syncControls(chunks: { x: number; z: number }[], chunk: string) {
        const state = app.state;
        input("structure-namespace").value = state.namespace;
        input("structure-name").value = state.name;
        input("section-meshing").checked = state.sectionMeshing;
        select("atlas-size").value = String(state.maxAtlasSize);
        select("work-shape").value = state.workload.shape;
        for (const key of ["count", "width", "height", "depth", "radius", "spacing", "seed", "blocks"] as const) input(`work-${key}`).value = String(state.workload[key]);
        syncShape();
        select("chunk-input").replaceChildren(...chunks.map(({ x, z }) => new Option(`${x}, ${z}`, `${x},${z}`)));
        select("chunk-input").value = chunk;
        document.getElementById("chunk-picker")!.hidden = !chunks.length;
        if (chunk && chunk !== state.chunk) app.record({ chunk });
        document.getElementById("edit-status")!.textContent = `${state.edits.length} saved block edits.`;
    }
    async function refreshSuggestions(ctx: DemoContext, namespace: string) {
        const generation = ++suggestionsGeneration;
        const values = new Set<string>();
        const prefix = `data/${namespace}/`;
        for (const file of ctx.assetFiles) {
            if (!file.startsWith(prefix) || !file.endsWith(".nbt")) continue;
            const relative = file.slice(prefix.length).replace(/^structures?\//, "");
            if (relative !== file.slice(prefix.length)) values.add(relative.slice(0, -4));
        }
        const queue = ["structure", "structures"].map(assetType => ({ assetType, path: "" }));
        const visited = new Set<string>();
        let failures = 0;
        while (queue.length && visited.size < 512 && generation === suggestionsGeneration && ctx.isCurrent()) {
            const batch = queue.splice(0, 8);
            await Promise.all(batch.map(async ({ assetType, path }) => {
                const id = `${assetType}/${path}`;
                if (visited.has(id)) return;
                visited.add(id);
                try {
                    const lists = await AssetLoader.getAll<ListAsset>(new AssetKey(namespace, `${path}_list`, assetType, undefined, "data", ".json"), AssetParser.LIST);
                    for (const list of lists) {
                        for (const file of list.files ?? []) if (file.endsWith(".nbt")) values.add(`${path}${file.slice(0, -4)}`);
                        for (const directory of list.directories ?? []) {
                            if (/^[a-z0-9_.-]+$/.test(directory) && directory !== "." && directory !== "..") queue.push({ assetType, path: `${path}${directory}/` });
                        }
                    }
                } catch {
                    failures++;
                }
            }));
        }
        if (generation !== suggestionsGeneration || !ctx.isCurrent()) return;
        document.getElementById("structure-suggestions")!.replaceChildren(...[...values].sort().map(value => new Option(value)));
        document.getElementById("suggestion-status")!.textContent = `${values.size} structure suggestions${failures || queue.length ? " · Some directories could not be listed; you can still enter a path." : "."}`;
    }
    function position(): [number, number, number] {
        return ["x", "y", "z"].map(axis => integer(Number(input(`edit-${axis}`).value), axis.toUpperCase(), -30000000, 30000000)) as [number, number, number];
    }
    function applyEdit(remove: boolean) {
        const edit: Edit = { position: position(), type: remove ? "air" : input("edit-type").value.trim(), properties: remove ? undefined : JSON.parse(input("edit-properties").value || "{}") };
        validateEdit(edit);
        const edits = app.state.edits.filter(previous => previous.position.some((coordinate, index) => coordinate !== edit.position[index]));
        return app.update({ edits: [...edits, edit] });
    }
    document.getElementById("structure-load")!.addEventListener("click", () => guard(async () => {
        await updateAndFit({ source: "builtin", namespace: input("structure-namespace").value.trim(), name: input("structure-name").value.trim(), edits: [] });
    }));
    input("structure-file").addEventListener("change", () => guard(async () => {
        const file = input("structure-file").files?.[0];
        if (!file) return;
        const generation = ++fileGeneration;
        const settings = app.state;
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (generation !== fileGeneration || app.state !== settings) return;
        localFile = { name: file.name, bytes };
        await updateAndFit({ source: "file", fileName: file.name, chunk: "", edits: [] });
    }));
    select("chunk-input").addEventListener("change", () => guard(async () => {
        await updateAndFit({ chunk: select("chunk-input").value, edits: [] });
    }));
    input("section-meshing").addEventListener("change", () => guard(() => app.update({ sectionMeshing: input("section-meshing").checked })));
    select("atlas-size").addEventListener("change", () => guard(() => app.update({ maxAtlasSize: Number(select("atlas-size").value) })));
    document.getElementById("world-clear")!.addEventListener("click", () => guard(() => app.update({ source: "empty", edits: [] })));
    document.getElementById("world-reload")!.addEventListener("click", () => guard(() => app.reload()));
    select("work-shape").addEventListener("change", syncShape);
    document.getElementById("work-run")!.addEventListener("click", () => guard(async () => {
        const workload = { ...app.state.workload, shape: select("work-shape").value as Workload["shape"], blocks: input("work-blocks").value };
        for (const key of ["count", "width", "height", "depth", "radius", "spacing", "seed"] as const) workload[key] = Number(input(`work-${key}`).value);
        makeWorkload(workload);
        await updateAndFit({ source: "workload", workload, edits: [] });
    }));
    document.getElementById("edit-read")!.addEventListener("click", () => guard(() => {
        const block = activeWorld?.getBlockAt(position())?.block;
        input("edit-type").value = block?.type ?? "air";
        input("edit-properties").value = JSON.stringify(block?.properties ?? {});
        document.getElementById("edit-status")!.textContent = block ? "Block values loaded into the editor." : "This position contains air.";
    }));
    document.getElementById("edit-apply")!.addEventListener("click", () => guard(() => applyEdit(false)));
    document.getElementById("edit-remove")!.addEventListener("click", () => guard(() => applyEdit(true)));
    document.getElementById("edit-reset")!.addEventListener("click", () => guard(() => app.update({ edits: [] })));
    void app.start();
}

function includeBlock(bounds: Box3, position: [number, number, number]) {
    const point = new Vector3(...position).multiplyScalar(16);
    bounds.expandByPoint(point.clone().addScalar(-8));
    bounds.expandByPoint(point.addScalar(8));
}

function validateEdit(edit: Edit) {
    if (!edit || !Array.isArray(edit.position) || edit.position.length !== 3) throw new Error("Block edits require three integer coordinates.");
    edit.position.forEach(coordinate => integer(coordinate, "Block coordinate", -30000000, 30000000));
    if (typeof edit.type !== "string") throw new Error("Block edits require a block ID.");
    blockId(edit.type);
    if (edit.properties !== undefined && (!edit.properties || typeof edit.properties !== "object" || Array.isArray(edit.properties) || Object.values(edit.properties).some(value => typeof value !== "string"))) {
        throw new Error('Block properties must be a JSON object with string values, such as {"level":"0"}.');
    }
}

function worldCode(state: WorldState): string {
    let code = `const world = new MineRender.MineRenderWorld(renderer.scene, ${JSON.stringify({ sectionMeshing: state.sectionMeshing, maxAtlasSize: state.maxAtlasSize })});\n`;
    if (state.source === "builtin") {
        code += `const key = new MineRender.AssetKey(${JSON.stringify(state.namespace)}, ${JSON.stringify(state.name)}, "structure", undefined, "data", ".nbt");\n`;
        code += `const asset = await MineRender.AssetLoader.get(key, MineRender.AssetParser.NBT);\n`;
        code += `await world.placeMultiBlock(await MineRender.StructureParser.parse(asset));\n`;
    } else if (state.source === "file") {
        code += `const fileInput = document.createElement("input");\nfileInput.type = "file";\nfileInput.accept = ".nbt,.schematic,.mca";\ndocument.body.append(fileInput);\n`;
        code += `// Select ${JSON.stringify(state.fileName)} to restore the local file.\n`;
        code += `const file = await new Promise(resolve => fileInput.addEventListener("change", () => resolve(fileInput.files[0]), { once: true }));\n`;
        code += `const bytes = new Uint8Array(await file.arrayBuffer());\n`;
        if (state.fileName.toLowerCase().endsWith(".mca")) {
            const [x, z] = state.chunk.split(",").map(Number);
            code += `const chunk = await MineRender.AnvilParser.parseChunk(bytes, ${x || 0}, ${z || 0});\nif (chunk) await world.placeChunk(chunk);\n`;
        } else {
            const parser = state.fileName.toLowerCase().endsWith(".schematic") ? "SchematicParser" : "StructureParser";
            code += `await world.placeMultiBlock(await MineRender.${parser}.parse(await MineRender.NBTHelper.fromBuffer(bytes)));\n`;
        }
    } else if (state.source === "preset" || state.source === "workload") {
        const structure = state.source === "preset" ? makePreset(state.preset) : makeWorkload(state.workload);
        code += `const structure = ${JSON.stringify(structure)};\nawait world.placeMultiBlock(structure);\n`;
    }
    for (const edit of state.edits) code += `await world.setBlockAt(${JSON.stringify(edit.position)}, ${blockId(edit.type) === "minecraft:air" ? "undefined" : JSON.stringify({ type: edit.type, properties: edit.properties })});\n`;
    return code;
}
