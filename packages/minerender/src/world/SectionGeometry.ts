import { CUBE_FACES } from "../CubeFace";

/** One cube template with four vertices per face in `CUBE_FACES` order. */
export interface SectionTemplateData {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    uvBounds: Float32Array;
    colors: Float32Array;
    indices: Uint16Array;
    cullFaces: Uint8Array;
    atlas: number;
}

/** The pixel dimensions of a template atlas. */
export interface SectionAtlasSize {
    width: number;
    height: number;
}

/** Section placements and their shared cube templates, ready for geometry building. */
export interface SectionGeometryInput {
    count: number;
    indices: Uint16Array;
    templates: Uint16Array;
    cullMasks: Uint8Array;
    templateData: SectionTemplateData[];
    atlases: SectionAtlasSize[];
    maxAtlasSize: number;
}

/** Merged cube faces and source-atlas placements for one atlas page. */
export interface SectionGeometryPage {
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

/** Builds section-local geometry from visible cube faces, with bounded atlas pages. */
export function buildSectionGeometry(input: SectionGeometryInput): SectionGeometryPage[] {
    const { count, indices, templates, cullMasks, templateData, atlases, maxAtlasSize } = input;
    if (!Number.isInteger(maxAtlasSize) || maxAtlasSize < 1) throw new RangeError("Section atlas size must be a positive integer");
    if (count > indices.length || count > templates.length || count > cullMasks.length) throw new RangeError("Section entry count exceeds its arrays");
    const visible: number[] = [];
    const visibleAtlases = new Set<number>();
    for (let entry = 0; entry < count; entry++) {
        const template = templateData[templates[entry]];
        if (!template.cullFaces.some(direction => !(cullMasks[entry] & direction))) continue;
        visible.push(entry);
        visibleAtlases.add(template.atlas);
    }
    const pages: {
        placements: SectionGeometryPage["placements"]; entries: number[];
        x: number; y: number; rowHeight: number; width: number; height: number;
    }[] = [];
    const locations = new Map<number, { page: number; x: number; y: number }>();
    for (const atlas of [...visibleAtlases].sort((a, b) => atlases[b].height - atlases[a].height)) {
        const { width, height } = atlases[atlas];
        if (width > maxAtlasSize || height > maxAtlasSize) throw new RangeError("Model atlas exceeds the section atlas size limit");
        let selected = -1;
        for (let i = 0; i < pages.length; i++) {
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
            pages.push({ placements: [], entries: [], x: 0, y: 0, rowHeight: 0, width: 0, height: 0 });
        }
        const page = pages[selected];
        page.placements.push({ atlas, x: page.x, y: page.y });
        locations.set(atlas, { page: selected, x: page.x, y: page.y });
        page.x += width;
        page.rowHeight = Math.max(page.rowHeight, height);
        page.width = Math.max(page.width, page.x);
        page.height = Math.max(page.height, page.y + height);
    }
    for (const entry of visible) pages[locations.get(templateData[templates[entry]].atlas)!.page].entries.push(entry);

    return pages.map(page => {
        let faces = 0;
        for (const entry of page.entries) {
            const template = templateData[templates[entry]];
            for (let face = 0; face < CUBE_FACES.length; face++) {
                if (!(cullMasks[entry] & template.cullFaces[face])) faces++;
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
            for (let face = 0; face < CUBE_FACES.length; face++) {
                if (cullMasks[entry] & template.cullFaces[face]) continue;
                const start = vertex;
                for (let corner = 0; corner < 4; corner++, vertex++) {
                    const source = face * 4 + corner;
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
                for (let corner = 0; corner < 6; corner++) outputIndices[indexOffset++] = start + template.indices[face * 6 + corner] - face * 4;
            }
        }
        return { width: page.width, height: page.height, placements: page.placements, positions, normals, uvs, uvBounds, colors, indices: outputIndices };
    });
}

/** Returns the buffers behind each page's typed arrays for transfer to another thread. */
export function sectionGeometryTransferables(pages: readonly SectionGeometryPage[]): ArrayBuffer[] {
    return pages.flatMap(page => [page.positions.buffer, page.normals.buffer, page.uvs.buffer, page.uvBounds.buffer, page.colors.buffer, page.indices.buffer]);
}
