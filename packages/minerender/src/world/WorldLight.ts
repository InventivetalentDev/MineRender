/** Saved light for a 16³ section. Each channel packs two levels per byte, with the even index in the low nibble. */
export interface SectionLightData {
    /** 2,048 bytes in x + 16z + 256y order. An omitted channel is zero. */
    block?: Uint8Array;
    /** 2,048 bytes in x + 16z + 256y order. An omitted channel is zero. */
    sky?: Uint8Array;
}

/** Saved light levels from 0 to 15, before brightness or directional shading. */
export interface SavedLightSample {
    block: number;
    sky: number;
}

/** Validates and copies saved channels so callers can reuse their input buffers. */
export function copySectionLight(light: SectionLightData): SectionLightData {
    const copy: SectionLightData = {};
    for (const channel of ["block", "sky"] as const) {
        const bytes = light[channel];
        if (bytes === undefined) continue;
        if (!(bytes instanceof Uint8Array) || bytes.length !== 2048) {
            throw new RangeError(`Section ${channel} light must contain 2048 packed bytes`);
        }
        copy[channel] = new Uint8Array(bytes);
    }
    return copy;
}

/** Reads a cell in x + 16z + 256y order. Missing section data remains distinct from saved darkness. */
export function sampleSectionLight(light: SectionLightData | undefined, index: number): SavedLightSample | undefined {
    if (!light) return undefined;
    const shift = (index & 1) * 4;
    return {
        block: ((light.block?.[index >> 1] ?? 0) >> shift) & 15,
        sky: ((light.sky?.[index >> 1] ?? 0) >> shift) & 15
    };
}
