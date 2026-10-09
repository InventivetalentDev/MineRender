import { buildFluidQuads, fluidKindOf } from "../model/fluid/FluidQuads";
import type { FluidKind, FluidQuads } from "../model/fluid/FluidQuads";

/** Static model geometry as quads: four vertices per quad, in quad order. */
export interface SectionTemplateData {
    quads: number;
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    uvBounds: Float32Array;
    colors: Float32Array;
    indices: Uint16Array;
    cullFaces: Uint8Array;
    atlas: number;
    layer: number;
}

/** The pixel dimensions and animation state of a source atlas. */
export interface SectionAtlasSize {
    width: number;
    height: number;
    animated: boolean;
}

/** One fluid kind's sprite rectangles in atlas pixels and its linear-light vertex tint. */
export interface SectionFluidKind {
    atlas: number;
    still: [x: number, y: number, width: number, height: number];
    flow: [x: number, y: number, width: number, height: number];
    tint: [r: number, g: number, b: number];
}

/** Fluid cells of the section plus a one-cell shell, 18×18×18, x fastest, then z, then y. */
export interface SectionFluidInput {
    cells: Uint8Array;
    water?: SectionFluidKind;
    lava?: SectionFluidKind;
}

/** Section placements and their shared templates, ready for geometry building. */
export interface SectionGeometryInput {
    count: number;
    indices: Uint16Array;
    templates: Uint16Array;
    cullMasks: Uint8Array;
    templateData: SectionTemplateData[];
    atlases: SectionAtlasSize[];
    maxAtlasSize: number;
    fluids?: SectionFluidInput;
}

/** Merged quads and source-atlas placements for one atlas page. */
export interface SectionGeometryPage {
    layer: number;
    width: number;
    height: number;
    placements: { atlas: number; x: number; y: number }[];
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    uvBounds: Float32Array;
    colors: Float32Array;
    indices: Uint32Array;
}

/** Builds section-local geometry from visible quads, with bounded atlas pages per layer. */
export function buildSectionGeometry(input: SectionGeometryInput): SectionGeometryPage[] {
    const { count, indices, templates, cullMasks, templateData, atlases, maxAtlasSize, fluids } = input;
    if (!Number.isInteger(maxAtlasSize) || maxAtlasSize < 1) throw new RangeError("Section atlas size must be a positive integer");
    if (count > indices.length || count > templates.length || count > cullMasks.length) throw new RangeError("Section entry count exceeds its arrays");
    if (fluids && fluids.cells.length !== 5832) throw new RangeError("Section fluid cells must cover an 18×18×18 neighborhood");
    for (const template of templateData) {
        const { quads } = template;
        if (template.positions.length !== quads * 12 || template.normals.length !== quads * 12 ||
            template.uvs.length !== quads * 8 || template.uvBounds.length !== quads * 16 ||
            template.colors.length !== quads * 12 || template.indices.length !== quads * 6 || template.cullFaces.length !== quads) {
            throw new RangeError("Section template arrays do not match its quad count");
        }
    }
    const visible: number[] = [];
    const visibleAtlases = new Map<number, Set<number>>();
    for (let entry = 0; entry < count; entry++) {
        const template = templateData[templates[entry]];
        if (!template.cullFaces.some(direction => !(cullMasks[entry] & direction))) continue;
        visible.push(entry);
        if (!visibleAtlases.has(template.layer)) visibleAtlases.set(template.layer, new Set());
        visibleAtlases.get(template.layer)!.add(template.atlas);
    }
    const pages: {
        layer: number; placements: SectionGeometryPage["placements"]; entries: number[];
        fluids: { quads: FluidQuads; x: number; y: number; z: number; data: SectionFluidKind }[];
        x: number; y: number; rowHeight: number; width: number; height: number;
    }[] = [];
    const locations = new Map<number, { page: number; x: number; y: number }>();
    for (const [layer, layerAtlases] of [...visibleAtlases].sort(([a], [b]) => a - b)) {
        const firstPage = pages.length;
        for (const atlas of [...layerAtlases].sort((a, b) => Number(atlases[a].animated) - Number(atlases[b].animated) ||
            (atlases[a].animated ? a - b : atlases[b].height - atlases[a].height))) {
            const { width, height, animated } = atlases[atlas];
            if (width > maxAtlasSize || height > maxAtlasSize) throw new RangeError("Model atlas exceeds the section atlas size limit");
            let selected = -1;
            for (let i = firstPage; !animated && i < pages.length; i++) {
                const page = pages[i];
                const nextRow = page.x + width > maxAtlasSize;
                if ((nextRow ? page.y + page.rowHeight : page.y) + height > maxAtlasSize) continue;
                if (nextRow) {
                    page.y += page.rowHeight;
                    page.x = 0;
                    page.rowHeight = 0;
                }
                selected = i;
                break;
            }
            if (selected < 0) {
                selected = pages.length;
                pages.push({ layer, placements: [], entries: [], fluids: [], x: 0, y: 0, rowHeight: 0, width: 0, height: 0 });
            }
            const page = pages[selected];
            page.placements.push({ atlas, x: page.x, y: page.y });
            locations.set(atlas, { page: selected, x: page.x, y: page.y });
            page.x += width;
            page.rowHeight = Math.max(page.rowHeight, height);
            page.width = Math.max(page.width, page.x);
            page.height = Math.max(page.height, page.y + height);
        }
    }
    for (const entry of visible) pages[locations.get(templateData[templates[entry]].atlas)!.page].entries.push(entry);

    if (fluids) {
        const fluidPages = new Map<FluidKind, (typeof pages)[number]>();
        for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
            const byte = fluids.cells[(y + 1) * 324 + (z + 1) * 18 + x + 1];
            const fluid = fluidKindOf(byte);
            if (!fluid) continue;
            const data = fluids[fluid];
            if (!data) throw new RangeError("Section fluid input lacks the atlas for a present fluid");
            const quads = buildFluidQuads(fluid, (dx, dy, dz) => {
                const cell = fluids.cells[(y + 1 + dy) * 324 + (z + 1 + dz) * 18 + x + 1 + dx];
                return { fluid: fluidKindOf(cell), level: cell & 15, solid: !!(cell & 64) };
            });
            if (!quads.sprites.length) continue;
            if (!fluidPages.has(fluid)) {
                const { width, height } = atlases[data.atlas];
                if (width > maxAtlasSize || height > maxAtlasSize) throw new RangeError("Model atlas exceeds the section atlas size limit");
                fluidPages.set(fluid, { layer: 2, placements: [{ atlas: data.atlas, x: 0, y: 0 }], entries: [], fluids: [],
                    x: 0, y: 0, rowHeight: 0, width, height });
            }
            fluidPages.get(fluid)!.fluids.push({ quads, x, y, z, data });
        }
        pages.push(...[...fluidPages.values()].sort((a, b) => Number(atlases[a.placements[0].atlas].animated) -
            Number(atlases[b.placements[0].atlas].animated) || a.placements[0].atlas - b.placements[0].atlas));
    }

    return pages.map(page => {
        let faces = page.fluids.reduce((sum, fluid) => sum + fluid.quads.sprites.length, 0);
        for (const entry of page.entries) {
            const template = templateData[templates[entry]];
            for (let quad = 0; quad < template.quads; quad++) {
                if (!(cullMasks[entry] & template.cullFaces[quad])) faces++;
            }
        }
        const positions = new Float32Array(faces * 12), normals = new Float32Array(faces * 12);
        const uvs = new Float32Array(faces * 8), uvBounds = new Float32Array(faces * 16), colors = new Float32Array(faces * 12);
        const outputIndices = new Uint32Array(faces * 6);
        let vertex = 0, indexOffset = 0;
        for (const entry of page.entries) {
            const template = templateData[templates[entry]];
            const atlas = atlases[template.atlas];
            const placement = locations.get(template.atlas)!;
            const mapU = (u: number) => (placement.x + u * atlas.width) / page.width;
            const mapV = (v: number) => 1 - (placement.y + (1 - v) * atlas.height) / page.height;
            const offsetX = (indices[entry] % 16) * 16;
            const offsetY = Math.floor(indices[entry] / 256) * 16;
            const offsetZ = (Math.floor(indices[entry] / 16) % 16) * 16;
            for (let quad = 0; quad < template.quads; quad++) {
                if (cullMasks[entry] & template.cullFaces[quad]) continue;
                const start = vertex;
                for (let corner = 0; corner < 4; corner++, vertex++) {
                    const source = quad * 4 + corner;
                    positions[vertex * 3] = template.positions[source * 3] + offsetX;
                    positions[vertex * 3 + 1] = template.positions[source * 3 + 1] + offsetY;
                    positions[vertex * 3 + 2] = template.positions[source * 3 + 2] + offsetZ;
                    normals[vertex * 3] = template.normals[source * 3];
                    normals[vertex * 3 + 1] = template.normals[source * 3 + 1];
                    normals[vertex * 3 + 2] = template.normals[source * 3 + 2];
                    uvs[vertex * 2] = mapU(template.uvs[source * 2]);
                    uvs[vertex * 2 + 1] = mapV(template.uvs[source * 2 + 1]);
                    uvBounds[vertex * 4] = mapU(template.uvBounds[source * 4]);
                    uvBounds[vertex * 4 + 1] = mapV(template.uvBounds[source * 4 + 1]);
                    uvBounds[vertex * 4 + 2] = mapU(template.uvBounds[source * 4 + 2]);
                    uvBounds[vertex * 4 + 3] = mapV(template.uvBounds[source * 4 + 3]);
                    colors[vertex * 3] = template.colors[source * 3];
                    colors[vertex * 3 + 1] = template.colors[source * 3 + 1];
                    colors[vertex * 3 + 2] = template.colors[source * 3 + 2];
                }
                for (let corner = 0; corner < 6; corner++) outputIndices[indexOffset++] = start + template.indices[quad * 6 + corner];
            }
        }
        for (const { quads, x, y, z, data } of page.fluids) {
            const atlas = atlases[data.atlas];
            const placement = page.placements[0];
            const mapU = (u: number) => (placement.x + u * atlas.width) / page.width;
            const mapV = (v: number) => 1 - (placement.y + (1 - v) * atlas.height) / page.height;
            for (let quad = 0; quad < quads.sprites.length; quad++) {
                const rect = quads.sprites[quad] === 0 ? data.still : data.flow;
                const start = vertex;
                for (let corner = 0; corner < 4; corner++, vertex++) {
                    const source = quad * 4 + corner;
                    positions[vertex * 3] = quads.positions[source * 3] + x * 16;
                    positions[vertex * 3 + 1] = quads.positions[source * 3 + 1] + y * 16;
                    positions[vertex * 3 + 2] = quads.positions[source * 3 + 2] + z * 16;
                    normals[vertex * 3] = quads.normals[source * 3];
                    normals[vertex * 3 + 1] = quads.normals[source * 3 + 1];
                    normals[vertex * 3 + 2] = quads.normals[source * 3 + 2];
                    uvs[vertex * 2] = mapU((rect[0] + quads.uvs[source * 2] * rect[2]) / atlas.width);
                    uvs[vertex * 2 + 1] = mapV(1 - (rect[1] + (1 - quads.uvs[source * 2 + 1]) * rect[3]) / atlas.height);
                    uvBounds.set([mapU(rect[0] / atlas.width), mapV(1 - (rect[1] + rect[3]) / atlas.height),
                        mapU((rect[0] + rect[2]) / atlas.width), mapV(1 - rect[1] / atlas.height)], vertex * 4);
                    colors.set(data.tint, vertex * 3);
                }
                outputIndices.set([start, start + 1, start + 2, start, start + 2, start + 3], indexOffset);
                indexOffset += 6;
            }
        }
        return { layer: page.layer, width: page.width, height: page.height, placements: page.placements, positions, normals, uvs, uvBounds, colors, indices: outputIndices };
    });
}

/** Returns the buffers behind each page's typed arrays for transfer to another thread. */
export function sectionGeometryTransferables(pages: readonly SectionGeometryPage[]): ArrayBuffer[] {
    return pages.flatMap(page => [page.positions.buffer, page.normals.buffer, page.uvs.buffer, page.uvBounds.buffer, page.colors.buffer, page.indices.buffer]);
}
