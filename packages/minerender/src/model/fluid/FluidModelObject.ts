import { BufferAttribute, BufferGeometry, Color, FrontSide, Mesh, ShaderMaterial } from "three";
import { AssetKey } from "../../assets/AssetKey";
import { Materials } from "../../Materials";
import { ModelObject, ModelObjectOptions } from "../scene/ModelObject";
import { createFluidGeometry, FluidFaces, FluidKind, FluidSampler } from "./FluidGeometry";

/** Saved fluid levels and solid neighbors determine the geometry shared by an instance pool. */
export function sampleFluid(kind: FluidKind, sample: FluidSampler): { key: string; sample: FluidSampler } {
    const cells = [] as ReturnType<FluidSampler>[];
    const key: string[] = [];
    for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
            for (let x = -1; x <= 1; x++) {
                const cell = sample(x, y, z);
                const level = Math.min(8, Number(cell.level ?? 0));
                cells.push(cell.fluid === kind ? { fluid: kind, level } : { fluid: cell.fluid, solid: cell.solid });
                key.push(cell.fluid === kind ? level.toString(16) : cell.fluid ? "o" : cell.solid ? "s" : "_");
            }
        }
    }
    return { key: key.join(""), sample: (x, y, z) => cells[(y + 1) * 9 + (z + 1) * 3 + x + 1] };
}

/** Renders water or lava with neighbor-dependent surfaces and animated still/flow textures. */
export class FluidModelObject extends ModelObject {
    private geometry?: BufferGeometry;

    constructor(readonly kind: FluidKind, private readonly sample: FluidSampler,
                origin?: AssetKey, options?: Partial<ModelObjectOptions>, readonly faces: FluidFaces = "front") {
        super({
            key: new AssetKey("minecraft", kind, "models", "fluid", "assets", ".json", origin?.root),
            textures: { still: `minecraft:block/${kind}_still`, flow: `minecraft:block/${kind}_flow` },
            elements: []
        }, options);
    }

    protected createMeshes(): void {
        const geometry = this.geometry = createFluidGeometry(this.kind, this.sample, this.faces);
        const atlas = this.textureAtlas!;
        const uv = geometry.getAttribute("uv");
        const bounds = new Float32Array(uv.count * 4);
        const [atlasWidth, atlasHeight] = [atlas.image.width, atlas.image.height];
        for (const group of geometry.groups) {
            const name = group.materialIndex === 0 ? "still" : "flow";
            const [x, y] = atlas.positions[name];
            const [width, height] = atlas.sizes[name];
            const vertices = new Set(Array.from(geometry.index!.array.slice(group.start, group.start + group.count)));
            for (const vertex of vertices) {
                uv.setXY(vertex, (x + uv.getX(vertex) * width) / atlasWidth, 1 - (y + (1 - uv.getY(vertex)) * height) / atlasHeight);
                // Texel centres of the sprite, as UVMapper.setAtlasUvBounds keeps model faces inside their textures.
                bounds.set([(x + 0.5) / atlasWidth, 1 - (y + height - 0.5) / atlasHeight,
                    (x + width - 0.5) / atlasWidth, 1 - (y + 0.5) / atlasHeight], vertex * 4);
            }
        }
        geometry.setAttribute("uvBounds", new BufferAttribute(bounds, 4));
        geometry.clearGroups();
        const color = new Color(this.options.tints?.[0] ?? (this.kind === "water" ? 0x3f76e4 : 0xffffff));
        const colors = new Float32Array(geometry.getAttribute("position").count * 3);
        for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
        geometry.setAttribute("color", new BufferAttribute(colors, 3));
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        let mesh: Mesh;
        if (this.options.instanceMeshes) {
            mesh = this.createInstancedMesh(undefined, geometry, Materials.MISSING_TEXTURE, this.options.maxInstanceCount);
            this.add(mesh);
        } else {
            mesh = this.createAndAddMesh(undefined, undefined, geometry, Materials.MISSING_TEXTURE);
        }
        // Separate blocks and instance pools are not sorted against each other. A ray from outside a convex body of fluid
        // enters through a front face and leaves through a back face, so drawing every back face first keeps that order.
        if (this.faces === "back") mesh.renderOrder = -1;
    }

    protected applyTextures(): void {
        if (!this.geometry!.index!.count) return;
        super.applyTextures();
        this.iterateAllMeshes(mesh => {
            const material = mesh.material as ShaderMaterial;
            // The geometry holds one side of each face, as vanilla's fluid renderer emits them.
            material.side = FrontSide;
            material.depthWrite = !material.transparent;
        });
    }

    public disposeAndRemoveAllChildren(): void {
        this.geometry?.dispose();
        this.geometry = undefined;
        super.disposeAndRemoveAllChildren();
    }
}
