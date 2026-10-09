import { BufferGeometry, Float32BufferAttribute, Group, Material, Mesh, MeshBasicMaterial, ShaderMaterial, Texture, Uint32BufferAttribute } from "three";
import { createCanvas } from "../canvas/CanvasCompat";
import { CUBE_FACES } from "../CubeFace";
import { Materials } from "../Materials";
import { TextureAtlas } from "../texture/TextureAtlas";
import { buildSectionGeometry, SectionGeometryInput, SectionGeometryPage, SectionTemplateData } from "./SectionGeometry";
import { SectionWorker } from "./SectionWorker";

/** Shared cube geometry and atlas data prepared for section merging. */
export interface SectionMeshTemplate {
    geometry: BufferGeometry;
    atlas: TextureAtlas;
    cullFaces: readonly number[];
}

/** One block placement in a section, with its storage index and hidden-face mask. */
export interface SectionMeshEntry {
    index: number;
    template: SectionMeshTemplate;
    cullMask: number;
}

const templateCache = new WeakMap<SectionMeshTemplate, SectionTemplateData>();

function toInput(entries: readonly SectionMeshEntry[], maxAtlasSize: number): { input: SectionGeometryInput; atlases: TextureAtlas[] } {
    if (!Number.isInteger(maxAtlasSize) || maxAtlasSize < 1) throw new RangeError("Section atlas size must be a positive integer");
    const atlases: TextureAtlas[] = [];
    const atlasIds = new Map<TextureAtlas, number>();
    const templateIds = new Map<SectionMeshTemplate, number>();
    const input: SectionGeometryInput = {
        count: entries.length, indices: new Uint16Array(entries.length), templates: new Uint16Array(entries.length),
        cullMasks: new Uint8Array(entries.length), templateData: [], atlases: [], maxAtlasSize
    };
    for (let i = 0; i < entries.length; i++) {
        const { index, template, cullMask } = entries[i];
        let id = templateIds.get(template);
        if (id === undefined) {
            let atlas = atlasIds.get(template.atlas);
            if (atlas === undefined) {
                atlas = atlases.length;
                atlasIds.set(template.atlas, atlas);
                atlases.push(template.atlas);
                input.atlases.push({ width: template.atlas.image.width, height: template.atlas.image.height });
            }
            let data = templateCache.get(template);
            if (!data) {
                data = {
                    positions: new Float32Array(72), normals: new Float32Array(72), uvs: new Float32Array(48),
                    uvBounds: new Float32Array(96), colors: new Float32Array(72), indices: new Uint16Array(36),
                    cullFaces: new Uint8Array(template.cullFaces), atlas: 0
                };
                const position = template.geometry.getAttribute("position");
                const normal = template.geometry.getAttribute("normal");
                const uv = template.geometry.getAttribute("uv");
                const bounds = template.geometry.getAttribute("uvBounds");
                const color = template.geometry.getAttribute("color");
                for (let vertex = 0; vertex < CUBE_FACES.length * 4; vertex++) {
                    data.positions.set([position.getX(vertex), position.getY(vertex), position.getZ(vertex)], vertex * 3);
                    data.normals.set([normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)], vertex * 3);
                    data.uvs.set([uv.getX(vertex), uv.getY(vertex)], vertex * 2);
                    data.uvBounds.set([bounds?.getX(vertex) ?? 0, bounds?.getY(vertex) ?? 0,
                        bounds?.getZ(vertex) ?? 1, bounds?.getW(vertex) ?? 1], vertex * 4);
                    data.colors.set([color?.getX(vertex) ?? 1, color?.getY(vertex) ?? 1, color?.getZ(vertex) ?? 1], vertex * 3);
                }
                const indices = template.geometry.getIndex()!;
                for (let i = 0; i < data.indices.length; i++) data.indices[i] = indices.getX(i);
                templateCache.set(template, data);
            }
            id = input.templateData.length;
            templateIds.set(template, id);
            // Atlas IDs belong to each build; cached buffers can be shared across concurrent builds.
            input.templateData.push({ ...data, atlas });
        }
        input.indices[i] = index;
        input.templates[i] = id;
        input.cullMasks[i] = cullMask;
    }
    return { input, atlases };
}

/** Merged terrain geometry and atlas pages for one 16×16×16 section. Owns its generated render resources. */
export class SectionMesh extends Group {

    private readonly ownedMeshes: { mesh: Mesh<BufferGeometry, Material>; texture?: Texture }[] = [];

    /** Builds section-local meshes from visible cube faces. `maxAtlasSize` limits each atlas dimension in pixels. */
    public static build(entries: readonly SectionMeshEntry[], maxAtlasSize = 2048): SectionMesh {
        const { input, atlases } = toInput(entries, maxAtlasSize);
        return this.fromPages(buildSectionGeometry(input), atlases);
    }

    /** Builds section-local meshes in a browser worker when available, with synchronous fallback. */
    public static async buildAsync(entries: readonly SectionMeshEntry[], maxAtlasSize = 2048): Promise<SectionMesh> {
        const { input, atlases } = toInput(entries, maxAtlasSize);
        const worker = SectionWorker.shared();
        const pages = worker ? await worker.build(input).catch(() => buildSectionGeometry(input)) : buildSectionGeometry(input);
        return this.fromPages(pages, atlases);
    }

    private static fromPages(pages: SectionGeometryPage[], atlases: TextureAtlas[]): SectionMesh {
        const section = new SectionMesh();
        for (const page of pages) {
            const canvas = createCanvas(page.width, page.height);
            const context = canvas.getContext("2d") as CanvasRenderingContext2D;
            for (const { atlas, x, y } of page.placements) {
                context.drawImage(atlases[atlas].image.canvas as CanvasImageSource, x, y);
            }
            const geometry = new BufferGeometry();
            // Passing buffers keeps Three's typed attributes from copying the builder's arrays.
            geometry.setAttribute("position", new Float32BufferAttribute(page.positions.buffer, 3));
            geometry.setAttribute("normal", new Float32BufferAttribute(page.normals.buffer, 3));
            geometry.setAttribute("uv", new Float32BufferAttribute(page.uvs.buffer, 2));
            geometry.setAttribute("uvBounds", new Float32BufferAttribute(page.uvBounds.buffer, 4));
            geometry.setAttribute("color", new Float32BufferAttribute(page.colors.buffer, 3));
            geometry.setIndex(new Uint32BufferAttribute(page.indices.buffer, 1));
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            const material = Materials.createShadedCanvasMaterial(canvas as HTMLCanvasElement, false, false, true);
            material.vertexColors = true;
            const texture = (material as ShaderMaterial).uniforms?.map?.value ?? (material as MeshBasicMaterial).map;
            const mesh = new Mesh(geometry, material);
            section.add(mesh);
            section.ownedMeshes.push({ mesh, texture });
        }
        return section;
    }

    public dispose(): void {
        for (const { mesh, texture } of this.ownedMeshes.splice(0)) {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            mesh.material.dispose();
            texture?.dispose();
        }
        this.removeFromParent();
        super.dispose();
    }

}
