import {
    AnvilParser, AnvilWorldSource, AssetLoader, Env, MineRenderWorld, Renderer,
    SectionMesh, SectionWorker, WorldStreamer
} from "minerender";

export interface WorldBenchmarkConfig {
    version: string;
    route: { x: number; z: number }[];
    loadRadius: number;
    unloadRadius: number;
    settleMs: number;
    sectionMeshing: boolean;
    savedLighting: boolean;
    ambientOcclusion: boolean;
    biomeBlendRadius: number;
    renderEntities: boolean;
    maxCachedRegions: number;
    maxCachedBytes: number;
    cameraHeight: number;
}

type Pass = "cold" | "warm";
type Phase = "outbound" | "return" | "cleanup";

interface Operation {
    pass: Pass;
    phase: Phase;
    waypoint: number | null;
    kind: string;
    startMs: number;
    durationMs: number;
    success: boolean;
    missing?: boolean;
    error?: string;
    x?: number;
    z?: number;
    bytes?: number;
    dataVersion?: number;
    workerAttempted?: boolean;
}

interface HeapMemory { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
const heap = (): number | null => (performance as Performance & { memory?: HeapMemory }).memory?.usedJSHeapSize ?? null;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const collectGarbage = (): void => (window as Window & { gc?: () => void }).gc?.();
const percentile = (values: readonly number[], fraction: number): number | null => values.length
    ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null;

function frameSampler() {
    const gaps: number[] = [];
    let frame = 0, previous: number | undefined, peak = heap();
    let ready: (() => void) | undefined;
    const sampleHeap = () => {
        const value = heap();
        if (value !== null) peak = Math.max(peak ?? value, value);
    };
    const sample = (time: number) => {
        if (previous !== undefined) gaps.push(time - previous);
        previous = time;
        sampleHeap();
        ready?.();
        ready = undefined;
        frame = requestAnimationFrame(sample);
    };
    return {
        sampleHeap,
        start: () => new Promise<void>(resolve => { ready = resolve; frame = requestAnimationFrame(sample); }),
        stop: () => {
            cancelAnimationFrame(frame);
            sampleHeap();
            const sorted = gaps.slice().sort((a, b) => a - b);
            return {
                frames: {
                    count: gaps.length, p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95),
                    p99Ms: percentile(sorted, 0.99), maxMs: sorted.at(-1) ?? null,
                    over50Ms: gaps.filter(value => value > 50).length
                },
                heapBytesPeak: peak
            };
        }
    };
}

function rendererStats(renderer: Renderer) {
    const info = renderer.renderer.info;
    return {
        calls: info.render.calls, triangles: info.render.triangles,
        geometries: info.memory.geometries, textures: info.memory.textures
    };
}

let running = false;
let startedOnce = false;

/** Runs two passes once per page, with fresh worlds/sources and the first pass's retained asset caches. */
async function runWorldBenchmark(config: WorldBenchmarkConfig) {
    if (running) throw new Error("A world benchmark is already running");
    if (startedOnce) throw new Error("Reload the benchmark page before running again");
    if (!config.route.length || config.route.some(({ x, z }) => !Number.isSafeInteger(x) || !Number.isSafeInteger(z))) {
        throw new Error("The benchmark route must contain integer chunk coordinates");
    }
    if (!Number.isFinite(config.settleMs) || config.settleMs < 0 || !Number.isFinite(config.cameraHeight)) {
        throw new Error("Settle time must be nonnegative and camera height must be finite");
    }
    const viewport = document.getElementById("viewport");
    const status = document.getElementById("status");
    if (!viewport || !status) throw new Error("The benchmark page requires viewport and status elements");
    running = true;
    startedOnce = true;
    const settings = { ...config, route: config.route.map(position => ({ ...position })), fpsLimit: 0, renderAlways: true, pixelRatio: 1 };
    const started = performance.now();
    const operations: Operation[] = [];
    const observedDataVersions = new Set<number>();
    let context: Pick<Operation, "pass" | "phase" | "waypoint"> = { pass: "cold", phase: "outbound", waypoint: null };
    let frames: ReturnType<typeof frameSampler> | undefined;
    const worker = { created: 0, buildRequests: 0, buildReplies: 0, buildFailures: 0, synchronousBuilds: 0 };
    const workerStats = () => ({ ...worker, fallbackBuilds: worker.buildFailures + worker.synchronousBuilds });
    const original = {
        parseChunk: AnvilParser.parseChunk,
        parseEntityChunk: AnvilParser.parseEntityChunk,
        buildSection: SectionMesh.buildAsync,
        buildWorker: SectionWorker.prototype.build,
        createWorker: Env.provider.createWorker
    };
    const provider = Env.provider;
    const createWorkerDescriptor = Object.getOwnPropertyDescriptor(provider, "createWorker");
    let renderer: Renderer | undefined;

    // Nested operation timings overlap. They describe each stage's wall time and must not be summed.
    async function timed<T>(kind: string, metadata: Partial<Operation>, action: () => Promise<T>): Promise<T> {
        const operation: Operation = { ...context, kind, startMs: performance.now() - started, durationMs: 0, success: false, ...metadata };
        try {
            const value = await action();
            operation.success = true;
            if (kind === "source" || kind === "region" || kind === "entity-region") operation.missing = value === undefined;
            return value;
        } catch (error) {
            operation.error = errorMessage(error);
            throw error;
        } finally {
            Object.assign(operation, metadata);
            operation.durationMs = performance.now() - started - operation.startMs;
            operations.push(operation);
            frames?.sampleHeap();
        }
    }

    AnvilParser.parseChunk = async function (...args) {
        const metadata: Partial<Operation> = {};
        return timed("decode", metadata, async () => {
            const chunk = await original.parseChunk.apply(this, args);
            if (chunk) {
                metadata.x = chunk.x;
                metadata.z = chunk.z;
                metadata.dataVersion = chunk.dataVersion;
                if (chunk.dataVersion !== undefined) observedDataVersions.add(chunk.dataVersion);
            }
            return chunk;
        });
    };
    AnvilParser.parseEntityChunk = async function (...args) {
        const metadata: Partial<Operation> = {};
        return timed("entity-decode", metadata, async () => {
            const chunk = await original.parseEntityChunk.apply(this, args);
            if (chunk) {
                metadata.x = chunk.x;
                metadata.z = chunk.z;
                metadata.dataVersion = chunk.dataVersion;
                if (chunk.dataVersion !== undefined) observedDataVersions.add(chunk.dataVersion);
            }
            return chunk;
        });
    };
    provider.createWorker = function (name) {
        const created = original.createWorker?.call(this, name);
        if (created) worker.created++;
        return created;
    };
    SectionWorker.prototype.build = async function (...args) {
        worker.buildRequests++;
        return timed("worker-build", {}, async () => {
            try {
                const pages = await original.buildWorker.apply(this, args);
                worker.buildReplies++;
                return pages;
            } catch (error) {
                worker.buildFailures++;
                throw error;
            }
        });
    };
    SectionMesh.buildAsync = async function (...args) {
        const before = worker.buildRequests;
        const metadata: Partial<Operation> = {};
        return timed("section-build", metadata, async () => {
            const result = original.buildSection.apply(this, args);
            const workerAttempted = worker.buildRequests !== before;
            metadata.workerAttempted = workerAttempted;
            if (!workerAttempted) worker.synchronousBuilds++;
            const section = await result;
            return section;
        });
    };

    async function readFile(kind: string, x: number, z: number, path: string, signal?: AbortSignal): Promise<Uint8Array | undefined> {
        const metadata: Partial<Operation> = { x, z };
        return timed(kind, metadata, async () => {
            const response = await fetch(path, { signal, cache: "no-store" });
            if (response.status === 404 && kind !== "external") return undefined;
            if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
            const data = new Uint8Array(await response.arrayBuffer());
            metadata.bytes = data.byteLength;
            return data;
        });
    }

    const route = [
        ...config.route.map(position => ({ ...position, phase: "outbound" as const })),
        ...config.route.slice(0, -1).reverse().map(position => ({ ...position, phase: "return" as const }))
    ];
    try {
        AssetLoader.setVersion(config.version);
        renderer = new Renderer({
            camera: { near: 1, far: 64000 }, controls: { enabled: false }, composer: { enabled: false },
            render: { fpsLimit: 0, renderAlways: true, autoResize: false, pixelRatio: 1, antialias: false }
        });
        renderer.appendTo(viewport);
        renderer.resize(viewport.clientWidth || innerWidth, viewport.clientHeight || innerHeight);
        const gl = renderer.renderer.getContext();
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        const environment = {
            userAgent: navigator.userAgent, viewport: { width: renderer.renderer.domElement.width, height: renderer.renderer.domElement.height },
            devicePixelRatio, gpuRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            gpuVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
            heapAvailable: heap() !== null, garbageCollectionAvailable: typeof (window as Window & { gc?: () => void }).gc === "function",
            timing: "Wall times overlap; render timings measure CPU submission, and heap samples exclude GPU memory.",
            coldAssets: "Requires a fresh browser profile; in-memory caches are cleared before the first pass."
        };
        const runs = [];
        for (const pass of ["cold", "warm"] as const) {
            context = { pass, phase: "outbound", waypoint: null };
            const world = new MineRenderWorld(renderer.scene, {
                sectionMeshing: config.sectionMeshing, savedLighting: config.savedLighting,
                ambientOcclusion: config.ambientOcclusion, biomeBlendRadius: config.biomeBlendRadius,
                renderEntities: config.renderEntities
            });
            const source = new AnvilWorldSource((x, z, signal) => readFile("region", x, z, `/world-files/region/r.${x}.${z}.mca`, signal), {
                maxCachedRegions: config.maxCachedRegions, maxCachedBytes: config.maxCachedBytes,
                readExternalChunk: (x, z, signal) => readFile("external", x, z, `/world-files/region/c.${x}.${z}.mcc`, signal),
                readEntityRegion: config.renderEntities ? (x, z, signal) => readFile("entity-region", x, z, `/world-files/entities/r.${x}.${z}.mca`, signal) : undefined
            });
            const streamer = new WorldStreamer({
                placeChunk: chunk => timed("placement", { x: chunk.x, z: chunk.z }, () => world.placeChunk(chunk)),
                unloadChunkColumn: (x, z) => timed("unload", { x, z }, () => world.unloadChunkColumn(x, z))
            }, {
                getChunk: (x, z, signal) => timed("source", { x, z }, () => source.getChunk(x, z, signal))
            }, { loadRadius: config.loadRadius, unloadRadius: config.unloadRadius });
            const waypoints = [];
            let cleanupMs = 0, heapBytesAfterCleanupGc: number | null = null;
            renderer.start();
            try {
                for (const [index, position] of route.entries()) {
                    context = { pass, phase: position.phase, waypoint: index };
                    status.textContent = `${pass} pass · ${position.phase} ${index + 1}/${route.length} · chunk ${position.x}, ${position.z}`;
                    const x = position.x * 256 + 128, z = position.z * 256 + 128, y = config.cameraHeight * 16;
                    renderer.camera.position.set(x + 256, y, z + 256);
                    renderer.camera.lookAt(x, 64 * 16, z);
                    const operationStart = operations.length;
                    frames = frameSampler();
                    await frames.start();
                    const updateStart = performance.now();
                    await streamer.update(position.x, position.z);
                    const updateMs = performance.now() - updateStart;
                    const firstRenderStart = performance.now();
                    renderer.renderOnce();
                    const firstRenderMs = performance.now() - firstRenderStart;
                    await new Promise<void>(resolve => setTimeout(resolve, config.settleMs));
                    const settledRenderStart = performance.now();
                    renderer.renderOnce();
                    const settledRenderMs = performance.now() - settledRenderStart;
                    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                    const samples = frames.stop();
                    frames = undefined;
                    const heapBytesSettled = heap();
                    collectGarbage();
                    const measured = operations.slice(operationStart);
                    waypoints.push({
                        phase: position.phase, x: position.x, z: position.z, updateMs, firstRenderMs, settledRenderMs,
                        cacheStatus: `${pass === "cold" ? "cold" : "warm"} assets at pass start; ${index ? "reused" : "fresh"} source cache`,
                        loadedChunks: streamer.loadedChunks.length, pendingChunks: streamer.pendingChunks,
                        failedChunks: streamer.failedChunks.length,
                        failures: streamer.failedChunks.map(({ x, z, error }) => ({ x, z, error: errorMessage(error) })),
                        missingChunkRequests: measured.filter(event => event.kind === "source" && event.missing).length,
                        regionRequests: measured.filter(event => event.kind === "region" || event.kind === "entity-region").length,
                        missingRegionRequests: measured.filter(event => (event.kind === "region" || event.kind === "entity-region") && event.missing).length,
                        renderer: rendererStats(renderer), ...samples, heapBytesSettled, heapBytesAfterGc: heap(), worker: workerStats()
                    });
                    console.info(`[benchmark] ${pass} ${position.phase} chunk ${position.x},${position.z} update=${updateMs.toFixed(1)}ms loaded=${streamer.loadedChunks.length} failures=${streamer.failedChunks.length}`);
                }
            } finally {
                frames?.stop();
                frames = undefined;
                renderer.stop();
                context = { pass, phase: "cleanup", waypoint: null };
                const cleanupStart = performance.now();
                try { await streamer.dispose(); } finally { await world.clear(); source.clearCache(); }
                renderer.renderOnce();
                cleanupMs = performance.now() - cleanupStart;
                collectGarbage();
                heapBytesAfterCleanupGc = heap();
            }
            runs.push({ pass, cacheStatus: `fresh source; ${pass === "cold" ? "cold" : "warm"} assets`, waypoints, cleanupMs, heapBytesAfterCleanupGc });
        }
        status.textContent = "Benchmark complete";
        return { settings, environment, observedDataVersions: [...observedDataVersions].sort((a, b) => a - b), runs, operations, worker: workerStats() };
    } catch (error) {
        status.textContent = `Benchmark failed: ${errorMessage(error)}`;
        throw error;
    } finally {
        try {
            frames?.stop();
            renderer?.dispose();
            if (worker.created) SectionWorker.shared()?.terminate();
        } finally {
            AnvilParser.parseChunk = original.parseChunk;
            AnvilParser.parseEntityChunk = original.parseEntityChunk;
            SectionMesh.buildAsync = original.buildSection;
            SectionWorker.prototype.build = original.buildWorker;
            if (createWorkerDescriptor) Object.defineProperty(provider, "createWorker", createWorkerDescriptor);
            else delete provider.createWorker;
            running = false;
        }
    }
}

declare global {
    interface Window { runWorldBenchmark: typeof runWorldBenchmark }
}

window.runWorldBenchmark = runWorldBenchmark;
