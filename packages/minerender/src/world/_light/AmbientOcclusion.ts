const AXIS_STRIDES = [1, 9, 3] as const;

/** Reads the edge and corner blockers around one cell in an 18×18×18 section neighborhood. */
export function sectionAmbientOcclusionMask(cells: Uint8Array, center: number): number {
    let mask = 0;
    for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
        if (Math.abs(x) + Math.abs(y) + Math.abs(z) < 2) continue;
        if (cells[center + y * 324 + z * 18 + x]) mask |= 1 << ((y + 1) * 9 + (z + 1) * 3 + x + 1);
    }
    return mask;
}

function cornerBrightness(mask: number, center: number, u: number, v: number): number {
    const sideU = (mask >>> (center + u)) & 1;
    const sideV = (mask >>> (center + v)) & 1;
    const corner = sideU && sideV ? 1 : (mask >>> (center + u + v)) & 1;
    return 1 - (sideU + sideV + corner) * 0.2;
}

/** Writes four linear AO factors for a boundary quad; inset or non-axis-aligned quads remain unchanged. */
export function quadAmbientOcclusion(positions: ArrayLike<number>, normals: ArrayLike<number>, quad: number,
                                     mask: number, output: Float32Array): void {
    output.fill(1);
    if (!mask) return;
    const start = quad * 12;
    let axis = 0;
    if (Math.abs(normals[start + 1]) > Math.abs(normals[start + axis])) axis = 1;
    if (Math.abs(normals[start + 2]) > Math.abs(normals[start + axis])) axis = 2;
    const uAxis = (axis + 1) % 3, vAxis = (axis + 2) % 3;
    if (Math.abs(Math.abs(normals[start + axis]) - 1) > 1e-6 ||
        Math.abs(normals[start + uAxis]) > 1e-6 || Math.abs(normals[start + vAxis]) > 1e-6) return;
    const sign = normals[start + axis] > 0 ? 1 : -1;
    for (let vertex = 0; vertex < 4; vertex++) {
        const offset = start + vertex * 3;
        if (Math.abs(positions[offset + axis] - sign * 8) > 0.0016 ||
            Math.abs(positions[offset + uAxis]) > 8.0016 || Math.abs(positions[offset + vAxis]) > 8.0016) return;
    }
    const center = 13 + sign * AXIS_STRIDES[axis];
    const u = AXIS_STRIDES[uAxis], v = AXIS_STRIDES[vAxis];
    const lowLow = cornerBrightness(mask, center, -u, -v);
    const highLow = cornerBrightness(mask, center, u, -v);
    const lowHigh = cornerBrightness(mask, center, -u, v);
    const highHigh = cornerBrightness(mask, center, u, v);
    for (let vertex = 0; vertex < 4; vertex++) {
        const offset = start + vertex * 3;
        const a = Math.max(0, Math.min(1, (positions[offset + uAxis] + 8) / 16));
        const b = Math.max(0, Math.min(1, (positions[offset + vAxis] + 8) / 16));
        output[vertex] = (lowLow * (1 - a) + highLow * a) * (1 - b) + (lowHigh * (1 - a) + highHigh * a) * b;
    }
}
