export interface PlacementProfileContext {
    pass: "cold" | "warm";
    phase: "outbound" | "return" | "cleanup";
    waypoint: number | null;
    operation: { id: number; kind: "placement" | "unload"; columns: { x: number; z: number }[] } | null;
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

export interface PlacementProfileEvent extends PlacementProfileContext, Pick<PlacementProfileMetadata, "x" | "y" | "z"> {
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
    end(spanId: number, success: boolean, error?: unknown): void;
    measure<T>(kind: PlacementProfileKind, metadata: PlacementProfileMetadata, parentId: number | undefined, action: (spanId: number) => T): T;
    measureAsync<T>(kind: PlacementProfileKind, metadata: PlacementProfileMetadata, parentId: number | undefined, action: (spanId: number) => Promise<T>): Promise<T>;
}

interface StageSummary {
    pass: PlacementProfileContext["pass"];
    kind: PlacementProfileKind;
    count: number;
    succeeded: number;
    inclusiveMs: number;
    unionMs: number;
}

interface SectionSummary {
    pass: PlacementProfileContext["pass"];
    x: number;
    y: number;
    z: number;
    builds: number;
    succeeded: number;
    ownColumnBuilds: number;
    neighborBuilds: number;
    unloadBuilds: number;
    otherBuilds: number;
    maxBuildsPerOperation: number;
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
    const events: PlacementProfileEvent[] = [];
    const spans = new Map<number, PendingSpan>();
    const issues: string[] = [];
    let nextId = 0;

    const metadataCopy = (metadata: PlacementProfileMetadata): PlacementProfileMetadata => {
        const copy: PlacementProfileMetadata = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (value !== undefined) copy[key] = value;
        }
        return copy;
    };

    const hooks: PlacementProfileHooks = {
        begin(kind, metadata = {}, parentId) {
            const parent = parentId === undefined ? undefined : spans.get(parentId);
            if (parentId !== undefined && !parent) issues.push(`Missing parent span ${parentId} for ${kind}`);
            const spanId = ++nextId;
            spans.set(spanId, {
                spanId, parentSpanId: parentId, kind, context: { ...(parent?.context ?? getContext()) },
                metadata: { ...parent?.metadata, ...metadataCopy(metadata) }, startMs: performance.now() - started
            });
            return spanId;
        },
        end(spanId, success, error) {
            const span = spans.get(spanId);
            if (!span) return;
            spans.delete(spanId);
            const durationMs = performance.now() - started - span.startMs;
            events.push({
                ...span.metadata, ...span.context,
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
        report() {
            const stageEvents = new Map<string, PlacementProfileEvent[]>();
            const sectionEvents = new Map<string, PlacementProfileEvent[]>();
            const reportIssues = issues.slice();
            for (const spanId of spans.keys()) reportIssues.push(`Span ${spanId} is still open`);
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
                const sectionKey = JSON.stringify([event.pass, event.x, event.y, event.z]);
                let section = sectionEvents.get(sectionKey);
                if (!section) sectionEvents.set(sectionKey, section = []);
                section.push(event);
            }
            const stages: StageSummary[] = [...stageEvents.values()].map(group => ({
                pass: group[0].pass, kind: group[0].kind, count: group.length,
                succeeded: group.filter(event => event.success).length,
                inclusiveMs: group.reduce((total, event) => total + event.durationMs, 0), unionMs: unionDuration(group)
            }));
            const sections: SectionSummary[] = [...sectionEvents.values()].map(group => {
                const operations = new Map<number, number>();
                let ownColumnBuilds = 0, neighborBuilds = 0, unloadBuilds = 0, otherBuilds = 0;
                for (const event of group) {
                    const operation = event.operation;
                    if (!operation) otherBuilds++;
                    else {
                        operations.set(operation.id, (operations.get(operation.id) ?? 0) + 1);
                        if (operation.kind === "unload") unloadBuilds++;
                        else if (operation.columns.some(column => column.x === event.x && column.z === event.z)) ownColumnBuilds++;
                        else neighborBuilds++;
                    }
                }
                return {
                    pass: group[0].pass, x: group[0].x!, y: group[0].y!, z: group[0].z!, builds: group.length,
                    succeeded: group.filter(event => event.success).length,
                    ownColumnBuilds, neighborBuilds, unloadBuilds, otherBuilds,
                    maxBuildsPerOperation: Math.max(0, ...operations.values()),
                    inclusiveMs: group.reduce((total, event) => total + event.durationMs, 0), unionMs: unionDuration(group)
                };
            });
            const summary = (["cold", "warm"] as const).map(pass => sections.filter(section => section.pass === pass).reduce((total, section) => ({
                pass, builds: total.builds + section.builds,
                ownColumnBuilds: total.ownColumnBuilds + section.ownColumnBuilds,
                neighborBuilds: total.neighborBuilds + section.neighborBuilds,
                unloadBuilds: total.unloadBuilds + section.unloadBuilds,
                otherBuilds: total.otherBuilds + section.otherBuilds,
                sectionsBuiltTwiceInOneOperation: total.sectionsBuiltTwiceInOneOperation + Number(section.maxBuildsPerOperation >= 2)
            }), { pass, builds: 0, ownColumnBuilds: 0, neighborBuilds: 0, unloadBuilds: 0, otherBuilds: 0, sectionsBuiltTwiceInOneOperation: 0 }));
            return {
                events: events.slice().sort((a, b) => a.spanId - b.spanId), stages, sections, summary,
                incompleteSpans: [...spans.values()].map(span => {
                    const { spanId } = span;
                    return { ...span.metadata, ...span.context, spanId, parentSpanId: span.parentSpanId, kind: span.kind, startMs: span.startMs };
                }),
                issues: reportIssues
            };
        },
        restore() {
            delete (globalThis as typeof globalThis & { [GLOBAL_KEY]?: PlacementProfileHooks })[GLOBAL_KEY];
        }
    };
}
