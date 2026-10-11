let permutation: Uint8Array | undefined;
const gradients = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0, 1], [0, -1]];
const skew = (Math.sqrt(3) - 1) / 2;
const unskew = (3 - Math.sqrt(3)) / 6;

function createPermutation(): Uint8Array {
    // Java's 48-bit RNG initializes this fixed permutation once; sampling uses ordinary numbers.
    const multiplier = 0x5deece66dn, mask = (1n << 48n) - 1n;
    let seed = 2345n ^ multiplier;
    const next = (bits: number) => {
        seed = (seed * multiplier + 11n) & mask;
        return Number(seed >> BigInt(48 - bits));
    };
    // Simplex initialization consumes three doubles before shuffling, even without coordinate offsets.
    for (let i = 0; i < 3; i++) { next(26); next(27); }
    const values = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (let i = 0; i < 256; i++) {
        const bound = 256 - i;
        let offset: number;
        if ((bound & (bound - 1)) === 0) offset = Math.floor(bound * next(31) / 0x80000000);
        else {
            let bits: number;
            do { bits = next(31); offset = bits % bound; } while ((bits - offset + bound - 1) > 0x7fffffff);
        }
        const other = i + offset;
        [values[i], values[other]] = [values[other], values[i]];
    }
    return values;
}

/** Applies vanilla's fixed-seed, single-octave swamp grass noise without coordinate offsets. */
export function swampGrassColor(x: number, z: number): number {
    const p = permutation ??= createPermutation();
    x *= 0.0225;
    z *= 0.0225;
    const s = (x + z) * skew;
    const i = Math.floor(x + s), j = Math.floor(z + s);
    const t = (i + j) * unskew;
    const dx = x - (i - t), dz = z - (j - t);
    const stepX = dx > dz ? 1 : 0, stepZ = 1 - stepX;
    const corner = (gx: number, gz: number, a: number, b: number) => {
        let falloff = 0.5 - a * a - b * b;
        if (falloff < 0) return 0;
        const gradient = gradients[p[(gx + p[gz & 255]) & 255] % 12];
        falloff *= falloff;
        return falloff * falloff * (gradient[0] * a + gradient[1] * b);
    };
    const noise = 70 * (corner(i, j, dx, dz)
        + corner(i + stepX, j + stepZ, dx - stepX + unskew, dz - stepZ + unskew)
        + corner(i + 1, j + 1, dx - 1 + 2 * unskew, dz - 1 + 2 * unskew));
    return noise < -0.1 ? 0x4c763c : 0x6a7039;
}
