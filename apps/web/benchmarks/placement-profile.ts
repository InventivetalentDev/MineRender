export interface PlacementProfileContext {
    pass: "cold" | "warm";
    phase: "outbound" | "return" | "cleanup";
    waypoint: number | null;
}

export type PlacementProfileKind = "section-rebuild" | "section-build" | "section-input" | "worker-roundtrip"
    | "synchronous-geometry" | "mesh-assembly" | "atlas-paint" | "model-atlas" | "state-resolution"
    | "state-preparation" | "template-preparation" | "template-build";

export interface PlacementProfileMetadata {
    [key: string]: string | number | boolean | null | undefined;
    x?: number;
    y?: number;
    z?: number;
}

export interface PlacementProfileEvent extends PlacementProfileContext, PlacementProfileMetadata {
    spanId: number;
    parentSpanId?: number;
    kind: PlacementProfileKind;
    startMs: number;
    durationMs: number;
    success: boolean;
    error?: string;
}

interface PendingSpan {
    spanId: number;
    parentSpanId?: number;
    kind: PlacementProfileKind;
    context: PlacementProfileContext;
    metadata: PlacementProfileMetadata;
    startMs: number;
}

export interface PlacementProfileHooks {
    begin(kind: PlacementProfileKind, metadata?: PlacementProfileMetadata, parentId?: number): number;
    end(spanId: number, success: boolean, error?: unknown, metadata?: PlacementProfileMetadata): void;
    measure<T>(kind: PlacementProfileKind, metadata: PlacementProfileMetadata, parentId: number | undefined, action: (spanId: number) => T): T;
    measureAsync<T>(kind: PlacementProfileKind, metadata: PlacementProfileMetadata, parentId: number | undefined, action: (spanId: number) => Promise<T>): Promise<T>;
}

interface StageSummary {
    pass: PlacementProfileContext["pass"];
    kind: PlacementProfileKind;
    count: number;
    succeeded: number;
    failed: number;
    inclusiveMs: number;
    unionMs: number;
}

interface SectionSummary extends PlacementProfileContext {
    x: number;
    y: number;
    z: number;
    builds: number;
    succeeded: number;
    failed: number;
    repeatedBuilds: number;
    inclusiveMs: number;
    unionMs: number;
}

const GLOBAL_KEY = "__minerenderPlacementProfile";
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

function unionDuration(events: readonly PlacementProfileEvent[]): number {
    const ordered = events.slice().sort((a, b) => a.startMs - b.startMs);
    let total = 0, start = ordered[0]?.startMs ?? 0, end = start;
    for (const event of ordered) {
        const nextEnd = event.startMs + event.durationMs;
        if (event.startMs > end) {
            total += end - start;
            start = event.startMs;
            end = nextEnd;
        } else end = Math.max(end, nextEnd);
    }
    return total + end - start;
}

/** Installs hooks only for the benchmark bundle. Explicit parent IDs preserve ownership across awaits. */
export function installPlacementProfiler(started: number, getContext: () => PlacementProfileContext) {
    if (!Number.isFinite(started)) throw new RangeError("The placement profiler start time must be finite");
    if (globalThis.__minerenderPlacementProfile !== undefined) throw new Error("A placement profiler is already installed");
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, GLOBAL_KEY);
    const events: PlacementProfileEvent[] = [];
    const spans = new Map<number, PendingSpan>();
    const active = new Set<number>();
    const issues: string[] = [];
    let nextId = 0, restored = false;

    const metadataCopy = (metadata: PlacementProfileMetadata): PlacementProfileMetadata => {
        const copy: PlacementProfileMetadata = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (value === undefined) continue;
            if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) copy[key] = value;
            else issues.push(`Ignored invalid ${key} metadata`);
        }
        return copy;
    };

    const hooks: PlacementProfileHooks = {
        begin(kind, metadata = {}, parentId) {
            if (restored) return 0;
            const parent = parentId === undefined ? undefined : spans.get(parentId);
            if (parentId !== undefined && !parent) issues.push(`Missing parent span ${parentId} for ${kind}`);
            const spanId = ++nextId;
            spans.set(spanId, {
                spanId, parentSpanId: parentId, kind, context: { ...(parent?.context ?? getContext()) },
                metadata: { ...parent?.metadata, ...metadataCopy(metadata) }, startMs: performance.now() - started
            });
            active.add(spanId);
            return spanId;
        },
        end(spanId, success, error, metadata = {}) {
            if (!spanId || restored) return;
            const span = spans.get(spanId);
            if (!span || !active.delete(spanId)) {
                issues.push(`Unknown or completed span ${spanId}`);
                return;
            }
            const durationMs = Math.max(0, performance.now() - started - span.startMs);
            events.push({
                ...span.metadata, ...metadataCopy(metadata), ...span.context,
                spanId, parentSpanId: span.parentSpanId, kind: span.kind, startMs: span.startMs, durationMs, success,
                ...(!success && { error: errorMessage(error) })
            });
        },
        measure(kind, metadata, parentId, action) {
            const spanId = hooks.begin(kind, metadata, parentId);
            let success = false, error: unknown;
            try {
                const result = action(spanId);
                success = true;
                return result;
            } catch (caught) {
                error = caught;
                throw caught;
            } finally {
                hooks.end(spanId, success, error);
            }
        },
        async measureAsync(kind, metadata, parentId, action) {
            const spanId = hooks.begin(kind, metadata, parentId);
            let success = false, error: unknown;
            try {
                const result = await action(spanId);
                success = true;
                return result;
            } catch (caught) {
                error = caught;
                throw caught;
            } finally {
                hooks.end(spanId, success, error);
            }
        }
    };
    Object.defineProperty(globalThis, GLOBAL_KEY, { configurable: true, writable: true, value: hooks });

    return {
        ...hooks,
        report() {
            const stageEvents = new Map<string, PlacementProfileEvent[]>();
            const sectionEvents = new Map<string, PlacementProfileEvent[]>();
            const reportIssues = issues.slice();
            for (const spanId of active) reportIssues.push(`Span ${spanId} is still open`);
            for (const event of events) {
                const stageKey = JSON.stringify([event.pass, event.kind]);
                let stage = stageEvents.get(stageKey);
                if (!stage) stageEvents.set(stageKey, stage = []);
                stage.push(event);
                if (event.kind !== "section-build") continue;
                if (![event.x, event.y, event.z].every(value => Number.isInteger(value))) {
                    reportIssues.push(`Section build ${event.spanId} has no integer section coordinates`);
                    continue;
                }
                const sectionKey = JSON.stringify([event.pass, event.phase, event.waypoint, event.x, event.y, event.z]);
                let section = sectionEvents.get(sectionKey);
                if (!section) sectionEvents.set(sectionKey, section = []);
                section.push(event);
            }
            const stages: StageSummary[] = [...stageEvents.values()].map(group => ({
                pass: group[0].pass, kind: group[0].kind, count: group.length,
                succeeded: group.filter(event => event.success).length, failed: group.filter(event => !event.success).length,
                inclusiveMs: group.reduce((total, event) => total + event.durationMs, 0), unionMs: unionDuration(group)
            }));
            const sections: SectionSummary[] = [...sectionEvents.values()].map(group => ({
                pass: group[0].pass, phase: group[0].phase, waypoint: group[0].waypoint,
                x: group[0].x!, y: group[0].y!, z: group[0].z!, builds: group.length,
                succeeded: group.filter(event => event.success).length, failed: group.filter(event => !event.success).length,
                repeatedBuilds: Math.max(0, group.length - 1),
                inclusiveMs: group.reduce((total, event) => total + event.durationMs, 0), unionMs: unionDuration(group)
            }));
            return {
                events: events.slice().sort((a, b) => a.spanId - b.spanId), stages, sections,
                incompleteSpans: [...active].map(spanId => {
                    const span = spans.get(spanId)!;
                    return { ...span.metadata, ...span.context, spanId, parentSpanId: span.parentSpanId, kind: span.kind, startMs: span.startMs };
                }),
                issues: reportIssues,
                notes: [
                    "Inclusive stage durations overlap; interval unions count each stage's covered wall time once per pass.",
                    "Repeated section builds count extra calls at the same section coordinates within one waypoint; they do not prove redundant work."
                ]
            };
        },
        restore() {
            if (restored) return;
            restored = true;
            if (descriptor) Object.defineProperty(globalThis, GLOBAL_KEY, descriptor);
            else delete globalThis.__minerenderPlacementProfile;
        }
    };
}

declare global {
    var __minerenderPlacementProfile: PlacementProfileHooks | undefined;
}
