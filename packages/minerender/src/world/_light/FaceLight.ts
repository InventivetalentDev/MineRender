/** Converts a saved light level to linear brightness; unknown samples retain preview brightness. */
export function lightBrightness(level: number, ambient = 0): number {
    if (level === 255) return 1;
    const curve = level / (60 - 3 * level);
    return curve + ambient * (1 - curve);
}

/** Selects the adjacent light sample for a boundary quad, or the center sample for an inset quad. */
export function quadLightIndex(positions: ArrayLike<number>, normals: ArrayLike<number>, quad: number): number {
    const start = quad * 12;
    let axis = 0;
    if (Math.abs(normals[start + 1]) > Math.abs(normals[start + axis])) axis = 1;
    if (Math.abs(normals[start + 2]) > Math.abs(normals[start + axis])) axis = 2;
    const positive = normals[start + axis] > 0;
    const boundary = positive ? 8 : -8;
    for (let vertex = 0; vertex < 4; vertex++) {
        if (Math.abs(positions[start + vertex * 3 + axis] - boundary) > 0.0016) return 0;
    }
    return axis * 2 + (positive ? 1 : 2);
}

/** Fluids sample the brighter of their own cell and the cell above, or below for bottom faces. */
export function fluidLightLevel(center: number, neighbor: number): number {
    return Math.max(center === 255 ? 15 : center, neighbor === 255 ? 15 : neighbor);
}

/** Offsets for center and face samples in an 18×18×18 section neighborhood. */
export const LIGHT_SAMPLE_OFFSETS = [0, 1, -1, 324, -324, 18, -18] as const;
