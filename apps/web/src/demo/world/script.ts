import {
    AnvilParser, AnvilWorldSource, AssetLoader, ChunkData, MineRenderWorld, Renderer, WorldStreamer,
    type AnvilChunk, type WorldChunkSource
} from "minerender";
import { Color, Vector3 } from "three";

interface RegionFile { x: number; z: number; file: File }
interface Dimension { label: string; regions: Map<string, RegionFile> }
interface Source { source: WorldChunkSource; label: string; clearCache?: () => void }

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const select = (id: string) => element<HTMLSelectElement>(id);
const status = element("status");
const retry = element<HTMLButtonElement>("retry");
const viewport = element("viewport");
const renderer = new Renderer({
    camera: { near: 1, far: 32000, position: [668, 680, 668], lookingAt: [128, 80, 128] },
    controls: { enabled: true }, composer: { enabled: false },
    render: { autoResize: false, fpsLimit: 30 }
});
renderer.scene.background = new Color("#8ebbe0");
renderer.appendTo(viewport);
renderer.orbitControls!.screenSpacePanning = false;
/** The point the streamer loads around: the orbit target, or the camera itself while flying. */
const viewCenter = (): Vector3 => renderer.orbitControls?.target ?? renderer.camera.position;
const world = new MineRenderWorld(renderer.scene, { sectionMeshing: true });
let active: Source | undefined;
let streamer: WorldStreamer | undefined;
let dimensions = new Map<string, Dimension>();
let switching = false;
let disposed = false;
let changeQueue = Promise.resolve();
let requestedCenter = "";
let updateId = 0;
let retryAction: (() => void) | undefined;
let lastStats = 0;

function report(message: string, error = false): void {
    status.textContent = message;
    status.classList.toggle("error", error);
    retry.hidden = !error || !retryAction;
}

function fail(error: unknown, action?: () => void): void {
    retryAction = action;
    report(error instanceof Error ? error.message : String(error), true);
}

function runChange(task: () => Promise<void>): void {
    switching = true;
    updateId++;
    element<HTMLFieldSetElement>("source-controls").disabled = true;
    element<HTMLFieldSetElement>("view-controls").disabled = true;
    report("Loading world…");
    changeQueue = changeQueue.then(async () => {
        if (disposed) return;
        try {
            await task();
        } catch (error) {
            fail(error, () => runChange(task));
        } finally {
            switching = false;
            element<HTMLFieldSetElement>("source-controls").disabled = false;
            element<HTMLFieldSetElement>("view-controls").disabled = false;
            updateStats();
        }
    });
}

async function replaceSource(next: Source, center?: { x: number; z: number; y: number }, version?: string): Promise<void> {
    await streamer?.dispose();
    streamer = undefined;
    await world.clear();
    if (active !== next) active?.clearCache?.();
    active = next;
    if (disposed) { next.clearCache?.(); return; }
    if (version !== undefined) AssetLoader.setVersion(version);
    streamer = new WorldStreamer(world, next.source, {
        loadRadius: Number(select("load-radius").value),
        unloadRadius: Number(select("load-radius").value) + 1
    });
    requestedCenter = "";
    if (center) moveTo(center.x, center.z, center.y);
    await updateWorld(true);
}

async function updateWorld(force = false, retryFailures = false): Promise<void> {
    const current = streamer;
    if (!current || disposed) return;
    const center = viewCenter();
    const x = Math.floor(center.x / 256);
    const z = Math.floor(center.z / 256);
    const key = `${x},${z}`;
    if (!force && requestedCenter === key) return;
    requestedCenter = key;
    const id = ++updateId;
    report(`Loading chunks near ${x}, ${z}…`);
    try {
        await current.updatePosition(viewCenter());
        if (retryFailures && id === updateId && current === streamer && !disposed) await current.retryFailedChunks();
        if (id !== updateId || current !== streamer || disposed) return;
        const count = current.loadedChunks.length;
        const failures = current.failedChunks;
        retryAction = failures.length ? () => void updateWorld(true, true) : undefined;
        const detail = failures.length
            ? ` · ${failures.length} failed: ${failures.slice(0, 3).map(({ x, z, error }) =>
                `chunk ${x}, ${z}: ${error instanceof Error ? error.message : String(error)}`).join("; ")}${failures.length > 3 ? "; more failures outside this list" : ""}`
            : count ? "" : " · no saved chunks at this location";
        report(`Ready · ${active!.label} · ${count} loaded chunks${detail}`, failures.length > 0);
    } catch (error) {
        if (id === updateId && current === streamer && !disposed) fail(error, () => void updateWorld(true));
    }
    updateStats();
}

function moveTo(x: number, z: number, y: number): void {
    if (![x, z, y].every(Number.isSafeInteger)) throw new Error("Enter integer chunk coordinates and a block height.");
    const target = new Vector3(x * 256 + 128, y * 16, z * 256 + 128);
    const orbit = renderer.orbitControls;
    if (orbit) {
        renderer.camera.position.add(target.clone().sub(orbit.target));
        orbit.target.copy(target);
        orbit.update();
    } else {
        renderer.camera.position.copy(target);
    }
    renderer.scene.dirty = true;
    input("chunk-x").value = String(x);
    input("chunk-z").value = String(z);
    input("block-y").value = String(y);
}

function updateStats(): void {
    const info = renderer.renderer.info;
    const center = viewCenter();
    const x = Math.floor(center.x / 256);
    const z = Math.floor(center.z / 256);
    element("world-stats").textContent = `View center: chunk ${x}, ${z} · ${streamer?.loadedChunks.length ?? 0} loaded · ${streamer?.pendingChunks ?? 0} pending · ${streamer?.failedChunks.length ?? 0} failed · ${info.render.calls} draw calls · ${info.render.triangles.toLocaleString()} triangles`;
}

const sample: Source = {
    label: "Sample terrain",
    source: {
        async getChunk(x, z): Promise<AnvilChunk> {
            const data = new ChunkData();
            for (let localZ = 0; localZ < 16; localZ++) {
                for (let localX = 0; localX < 16; localX++) {
                    const height = 2 + Math.floor((Math.sin((x * 16 + localX) / 11) + Math.cos((z * 16 + localZ) / 15) + 2) * 1.25);
                    for (let y = 0; y <= height; y++) {
                        data.set(localX + localZ * 16 + y * 256, {
                            type: y === height ? "minecraft:grass_block" : y >= height - 2 ? "minecraft:dirt" : "minecraft:stone"
                        });
                    }
                }
            }
            return { x, z, sections: [{ y: 0, data }] };
        }
    }
};

function collectDimensions(files: File[]): Map<string, Dimension> {
    const result = new Map<string, Dimension>();
    for (const file of files) {
        const match = /^r\.(-?\d+)\.(-?\d+)\.mca$/i.exec(file.name);
        if (!match) continue;
        const x = Number(match[1]), z = Number(match[2]);
        if (![x, z].every(Number.isSafeInteger)) throw new Error(`Invalid region coordinates: ${file.name}`);
        const path = file.webkitRelativePath.replace(/\\/g, "/").split("/").slice(0, -1);
        if (path.length && path[path.length - 1] !== "region") continue;
        let id = "minecraft:overworld", label = "Overworld";
        if (path[path.length - 2] === "DIM-1") { id = "minecraft:the_nether"; label = "Nether"; }
        else if (path[path.length - 2] === "DIM1") { id = "minecraft:the_end"; label = "End"; }
        else {
            const custom = path.lastIndexOf("dimensions");
            if (custom >= 0 && path.length - custom >= 4) {
                id = `${path[custom + 1]}:${path.slice(custom + 2, -1).join("/")}`;
                label = id;
            }
        }
        let dimension = result.get(id);
        if (!dimension) result.set(id, dimension = { label, regions: new Map() });
        const key = `${x},${z}`;
        if (dimension.regions.has(key)) throw new Error(`Duplicate region ${file.name} in ${label}. Select files from one world.`);
        dimension.regions.set(key, { x, z, file });
    }
    if (!result.size) throw new Error("No region files found. Select a Java world folder or r.x.z.mca files.");
    return result;
}

async function openDimension(id: string): Promise<void> {
    const dimension = dimensions.get(id);
    if (!dimension) throw new Error("Choose a dimension from the selected world.");
    const regions = [...dimension.regions.values()].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    let start: { x: number; z: number; y: number } | undefined;
    let failureCount = 0;
    let firstFailure: string | undefined;
    const recordFailure = (location: string, error: unknown) => {
        failureCount++;
        firstFailure ??= `${location}: ${error instanceof Error ? error.message : String(error)}`;
    };
    for (const region of regions) {
        let bytes: ArrayBuffer;
        let positions: { x: number; z: number }[];
        try {
            bytes = await region.file.arrayBuffer();
            positions = AnvilParser.getChunkList(bytes);
        } catch (error) {
            recordFailure(region.file.name, error);
            continue;
        }
        for (const position of positions) {
            const x = region.x * 32 + position.x, z = region.z * 32 + position.z;
            try {
                const chunk = await AnvilParser.parseChunk(bytes, position.x, position.z);
                if (chunk && (chunk.x !== x || chunk.z !== z)) {
                    throw new Error(`Stored coordinates ${chunk.x}, ${chunk.z} do not match region coordinates ${x}, ${z}.`);
                }
                const y = surfaceHeight(chunk);
                if (y !== undefined) { start = { x, z, y }; break; }
            } catch (error) {
                recordFailure(`${region.file.name}, chunk ${x}, ${z}`, error);
            }
        }
        if (start) break;
    }
    if (!start) {
        throw new Error(`${dimension.label} has no visible terrain to display.${firstFailure
            ? ` ${failureCount} region or chunk reads failed. First failure: ${firstFailure}` : ""}`);
    }
    const source = new AnvilWorldSource(async (x, z) => dimension.regions.get(`${x},${z}`)?.file.arrayBuffer(),
        { maxCachedRegions: 4, maxCachedBytes: 64 * 1024 * 1024 });
    try {
        element("source-info").textContent = `${dimension.label} · ${dimension.regions.size} region files. Regions are read on demand; the region cache holds up to 4 files / 64 MiB.`;
        await replaceSource({ source, label: dimension.label, clearCache: () => source.clearCache() }, start);
    } catch (error) {
        source.clearCache();
        throw error;
    }
}

function surfaceHeight(chunk?: AnvilChunk): number | undefined {
    for (const section of [...chunk?.sections ?? []].sort((a, b) => b.y - a.y)) {
        for (let index = 4095; index >= 0; index--) {
            const block = section.data.get(index);
            if (block && !["minecraft:barrier", "minecraft:light", "minecraft:structure_void"].includes(block.type)) {
                return section.y * 16 + (index >> 8);
            }
        }
    }
}

function loadFiles(files: File[]): void {
    if (!files.length) return;
    runChange(async () => {
        dimensions = collectDimensions(files);
        select("dimension").replaceChildren(...[...dimensions].map(([id, value]) => new Option(value.label, id)));
        select("dimension").disabled = false;
        select("dimension").value = dimensions.has("minecraft:overworld") ? "minecraft:overworld" : dimensions.keys().next().value!;
        select("load-radius").value = "0";
        await openDimension(select("dimension").value);
    });
}

for (const id of ["world-folder", "region-files"]) input(id).addEventListener("change", () => {
    loadFiles(Array.from(input(id).files ?? []));
    input(id).value = "";
});
element("sample").addEventListener("click", () => runChange(async () => {
    select("dimension").replaceChildren(new Option("Sample terrain"));
    select("dimension").disabled = true;
    element("source-info").textContent = "Procedural terrain with no world download.";
    await replaceSource(sample, { x: 0, z: 0, y: 5 });
}));
select("dimension").addEventListener("change", () => {
    const id = select("dimension").value;
    runChange(() => openDimension(id));
});
select("load-radius").addEventListener("change", () => runChange(() => replaceSource(active!)));
element("apply-version").addEventListener("click", () => runChange(async () => {
    const version = input("asset-version").value.trim();
    if (!/^[a-zA-Z0-9_.-]+$/.test(version)) throw new Error("Enter a Minecraft version such as 1.21.11.");
    await replaceSource(active!, undefined, version);
}));
function navigate(x: number, z: number, y: number): void {
    try { moveTo(x, z, y); void updateWorld(true); }
    catch (error) { fail(error); }
}
element("jump").addEventListener("click", () => navigate(input("chunk-x").valueAsNumber, input("chunk-z").valueAsNumber, input("block-y").valueAsNumber));
document.querySelectorAll<HTMLButtonElement>("[data-step-x], [data-step-z]").forEach(button => button.addEventListener("click", () => {
    const center = viewCenter();
    navigate(Math.floor(center.x / 256) + Number(button.dataset.stepX ?? 0),
        Math.floor(center.z / 256) + Number(button.dataset.stepZ ?? 0), Math.round(center.y / 16));
}));
select("camera-mode").addEventListener("change", () => {
    const mode = select("camera-mode").value as "orbit" | "fly";
    renderer.setControlsMode(mode);
    element("fly-note").hidden = mode !== "fly";
    if (renderer.orbitControls) renderer.orbitControls.screenSpacePanning = false;
    void updateWorld(true);
});
input("follow").addEventListener("change", () => { if (input("follow").checked) void updateWorld(true); });
retry.addEventListener("click", () => retryAction?.());
element("panel-toggle").addEventListener("click", () => {
    const hidden = document.body.classList.toggle("controls-hidden");
    element("panel-toggle").textContent = hidden ? "Show controls" : "Hide controls";
    element("panel-toggle").setAttribute("aria-expanded", String(!hidden));
});
const resize = new ResizeObserver(() => renderer.resize(viewport.clientWidth, viewport.clientHeight));
resize.observe(viewport);
const stopFrame = renderer.onFrame(({ time }) => {
    if (!switching && input("follow").checked) void updateWorld();
    if (time - lastStats > .25) { updateStats(); lastStats = time; }
});
async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    stopFrame();
    resize.disconnect();
    renderer.stop();
    await changeQueue;
    await streamer?.dispose();
    active?.clearCache?.();
    await world.clear();
    renderer.dispose();
}
window.addEventListener("pagehide", event => { if (!event.persisted) void dispose().catch(console.error); });
Object.assign(window, { worldDemo: { renderer, world, get streamer() { return streamer; }, dispose } });
input("asset-version").value = AssetLoader.version;
renderer.start();
runChange(() => replaceSource(sample, { x: 0, z: 0, y: 5 }));
