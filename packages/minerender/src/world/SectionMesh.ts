import { BufferGeometry, Float32BufferAttribute, Group, Material, Mesh, MeshBasicMaterial, ShaderMaterial, Texture } from "three";
import { createCanvas } from "../canvas/CanvasCompat";
import { Materials } from "../Materials";
import { TextureAtlas } from "../texture/TextureAtlas";

export interface SectionMeshTemplate {
    geometry: BufferGeometry;
    atlas: TextureAtlas;
    cullFaces: readonly number[];
}

export interface SectionMeshEntry {
    index: number;
    template: SectionMeshTemplate;
    cullMask: number;
}

interface AtlasPlacement {
    atlas: TextureAtlas;
    x: number;
    y: number;
}

interface AtlasPage {
    placements: AtlasPlacement[];
    entries: SectionMeshEntry[];
    x: number;
    y: number;
    rowHeight: number;
    width: number;
    height: number;
}

export class SectionMesh extends Group {

    private readonly ownedMeshes: { mesh: Mesh<BufferGeometry, Material>; texture?: Texture }[] = [];

    public static build(entries: readonly SectionMeshEntry[], maxAtlasSize = 2048): SectionMesh {
        if (!Number.isInteger(maxAtlasSize) || maxAtlasSize < 1) throw new RangeError("Section atlas size must be a positive integer");
        const visible = entries.filter(entry => entry.template.cullFaces.some(direction => !(entry.cullMask & direction)));
        const atlases = [...new Set(visible.map(entry => entry.template.atlas))]
            .sort((a, b) => b.image.height - a.image.height);
        const pages: AtlasPage[] = [];
        const locations = new Map<TextureAtlas, { page: AtlasPage; placement: AtlasPlacement }>();
        for (const atlas of atlases) {
            const { width, height } = atlas.image;
            if (width > maxAtlasSize || height > maxAtlasSize) throw new RangeError("Model atlas exceeds the section atlas size limit");
            let selected: AtlasPage | undefined;
            for (const page of pages) {
                const nextRow = page.x + width > maxAtlasSize;
                if ((nextRow ? page.y + page.rowHeight : page.y) + height > maxAtlasSize) continue;
                if (nextRow) {
                    page.y += page.rowHeight;
                    page.x = 0;
                    page.rowHeight = 0;
                }
                selected = page;
                break;
            }
            if (!selected) {
                selected = { placements: [], entries: [], x: 0, y: 0, rowHeight: 0, width: 0, height: 0 };
                pages.push(selected);
            }
            const placement = { atlas, x: selected.x, y: selected.y };
            selected.placements.push(placement);
            selected.x += width;
            selected.rowHeight = Math.max(selected.rowHeight, height);
            selected.width = Math.max(selected.width, selected.x);
            selected.height = Math.max(selected.height, selected.y + height);
            locations.set(atlas, { page: selected, placement });
        }
        for (const entry of visible) locations.get(entry.template.atlas)!.page.entries.push(entry);

        const section = new SectionMesh();
        for (const page of pages) {
            const canvas = createCanvas(page.width, page.height);
            const context = canvas.getContext("2d") as CanvasRenderingContext2D;
            for (const { atlas, x, y } of page.placements) {
                context.drawImage(atlas.image.canvas as CanvasImageSource, x, y);
            }
            const positions: number[] = [], normals: number[] = [], uvs: number[] = [], uvBounds: number[] = [], colors: number[] = [], indices: number[] = [];
            for (const { index, template, cullMask } of page.entries) {
                const position = template.geometry.getAttribute("position");
                const normal = template.geometry.getAttribute("normal");
                const uv = template.geometry.getAttribute("uv");
                const bounds = template.geometry.getAttribute("uvBounds");
                const color = template.geometry.getAttribute("color");
                const sourceIndices = template.geometry.getIndex()!;
                const placement = locations.get(template.atlas)!.placement;
                const mapU = (u: number) => (placement.x + u * template.atlas.image.width) / page.width;
                const mapV = (v: number) => 1 - (placement.y + (1 - v) * template.atlas.image.height) / page.height;
                const offsetX = (index % 16) * 16;
                const offsetY = Math.floor(index / 256) * 16;
                const offsetZ = (Math.floor(index / 16) % 16) * 16;
                for (let face = 0; face < 6; face++) {
                    if (cullMask & template.cullFaces[face]) continue;
                    const start = positions.length / 3;
                    for (let corner = 0; corner < 4; corner++) {
                        const vertex = face * 4 + corner;
                        positions.push(position.getX(vertex) + offsetX, position.getY(vertex) + offsetY, position.getZ(vertex) + offsetZ);
                        normals.push(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
                        uvs.push(mapU(uv.getX(vertex)), mapV(uv.getY(vertex)));
                        uvBounds.push(
                            mapU(bounds?.getX(vertex) ?? 0), mapV(bounds?.getY(vertex) ?? 0),
                            mapU(bounds?.getZ(vertex) ?? 1), mapV(bounds?.getW(vertex) ?? 1)
                        );
                        colors.push(color?.getX(vertex) ?? 1, color?.getY(vertex) ?? 1, color?.getZ(vertex) ?? 1);
                    }
                    for (let corner = 0; corner < 6; corner++) indices.push(start + sourceIndices.getX(face * 6 + corner) - face * 4);
                }
            }
            const geometry = new BufferGeometry();
            geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
            geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
            geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
            geometry.setAttribute("uvBounds", new Float32BufferAttribute(uvBounds, 4));
            geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
            geometry.setIndex(indices);
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
