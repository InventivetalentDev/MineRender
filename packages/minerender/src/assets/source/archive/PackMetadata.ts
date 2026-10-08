/** A resource-pack format; a number selects minor version zero. */
export type PackFormat = number | readonly [number, number];

type FormatPair = readonly [number, number];

interface Overlay {
    directory: string;
    min: FormatPair;
    max: FormatPair;
}

interface Filter {
    namespace?: RegExp;
    path?: RegExp;
}

function object(value: unknown, field: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid ${field}: expected an object`);
    }
    return value as Record<string, unknown>;
}

function integer(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Invalid ${field}: expected a nonnegative integer`);
    }
    return value;
}

function format(value: unknown, field: string, upper = false): FormatPair {
    const parts = Array.isArray(value) ? value : [value];
    if (parts.length < 1 || parts.length > 2) {
        throw new Error(`Invalid ${field}: expected a major version or [major, minor]`);
    }
    return [integer(parts[0], field), parts.length === 2 ? integer(parts[1], field) : upper ? Infinity : 0];
}

function compare(a: FormatPair, b: FormatPair): number {
    return a[0] === b[0] ? a[1] - b[1] : a[0] - b[0];
}

function overlay(value: unknown, field: string): Overlay {
    const entry = object(value, field);
    const directory = entry.directory;
    if (typeof directory !== "string" || !directory || /[^-_a-zA-Z0-9.]/.test(directory) || directory === "." || directory === "..") {
        throw new Error(`Invalid ${field}.directory: expected a directory name without path separators`);
    }
    let min: FormatPair, max: FormatPair;
    if ("min_format" in entry || "max_format" in entry) {
        min = format(entry.min_format, `${field}.min_format`);
        max = format(entry.max_format, `${field}.max_format`, true);
    } else {
        const range = entry.formats;
        let lower: unknown, upper: unknown;
        if (typeof range === "number") {
            lower = upper = range;
        } else if (Array.isArray(range)) {
            if (range.length !== 2) throw new Error(`Invalid ${field}.formats: expected [min, max]`);
            [lower, upper] = range;
        } else {
            const bounds = object(range, `${field}.formats`);
            lower = bounds.min_inclusive;
            upper = bounds.max_inclusive;
        }
        min = [integer(lower, `${field}.formats.min_inclusive`), 0];
        max = [integer(upper, `${field}.formats.max_inclusive`), Infinity];
    }
    if (compare(min, max) > 0) throw new Error(`Invalid ${field}: minimum format exceeds maximum format`);
    return { directory, min, max };
}

function pattern(value: unknown, field: string): RegExp | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new Error(`Invalid ${field}: expected a regular expression string`);
    try {
        return new RegExp(value);
    } catch (cause) {
        throw new Error(`Invalid ${field}: ${String(cause)}`);
    }
}

export class PackMetadata {
    public readonly hasOverlays: boolean;

    private constructor(private readonly overlays: Overlay[], private readonly filters: Filter[]) {
        this.hasOverlays = overlays.length > 0;
    }

    public static parse(value: unknown): PackMetadata {
        const metadata = object(value, "pack.mcmeta");
        let overlays: Overlay[] = [];
        if ("overlays" in metadata) {
            const entries = object(metadata.overlays, "overlays").entries;
            if (!Array.isArray(entries)) throw new Error("Invalid overlays.entries: expected an array");
            overlays = entries.map((entry, index) => overlay(entry, `overlays.entries[${index}]`));
        }
        let filters: Filter[] = [];
        if ("filter" in metadata) {
            const entries = object(metadata.filter, "filter").block;
            if (!Array.isArray(entries)) throw new Error("Invalid filter.block: expected an array");
            filters = entries.map((value, index) => {
                const field = `filter.block[${index}]`;
                const entry = object(value, field);
                return { namespace: pattern(entry.namespace, `${field}.namespace`), path: pattern(entry.path, `${field}.path`) };
            });
        }
        return new PackMetadata(overlays, filters);
    }

    /** Returns applicable directories in lookup order, with the last declared overlay first. */
    public overlayDirectories(target: PackFormat): string[] {
        const selected = format(target, "target format");
        return this.overlays.filter(entry => compare(selected, entry.min) >= 0 && compare(selected, entry.max) <= 0)
            .map(entry => entry.directory).reverse();
    }

    public blocks(namespace: string, path: string): boolean {
        // Vanilla checks namespaces and paths independently across the filter entries.
        return this.filters.some(entry => entry.namespace?.test(namespace) ?? true)
            && this.filters.some(entry => entry.path?.test(path) ?? true);
    }
}
