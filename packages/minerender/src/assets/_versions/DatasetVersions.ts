/** Parses release versions; snapshots and other names yield undefined. */
export const parseRelease = (value: string): number[] | undefined => /^\d+\.\d+(?:\.\d+)?$/.test(value) ? value.split(".").map(Number) : undefined;
const compare = (left: number[], right: number[]): number => {
    for (let i = 0; i < 3; i++) {
        const difference = (left[i] ?? 0) - (right[i] ?? 0);
        if (difference) return difference;
    }
    return 0;
};

/** Selects the nearest patch (older on ties), then the latest earlier release or oldest published release. */
export const nearestRelease = (requestedVersion: string, published: readonly string[]): string | undefined => {
    const requested = parseRelease(requestedVersion);
    if (!requested) return undefined;
    const versions = published.map(name => ({ name, number: parseRelease(name) }))
        .filter((entry): entry is { name: string; number: number[] } => !!entry.number)
        .sort((left, right) => compare(left.number, right.number));
    const sameLine = versions.filter(entry => entry.number[0] === requested[0] && entry.number[1] === requested[1]);
    const selected = sameLine.sort((left, right) => Math.abs((left.number[2] ?? 0) - (requested[2] ?? 0))
        - Math.abs((right.number[2] ?? 0) - (requested[2] ?? 0)) || compare(left.number, right.number))[0]
        ?? versions.filter(entry => compare(entry.number, requested) <= 0).pop()
        ?? versions[0];
    return selected?.name;
};
