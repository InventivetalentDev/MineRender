import { BufferAttribute, BufferGeometry, Color, DoubleSide, ShaderMaterial } from "three";
import { AssetKey } from "../../assets/AssetKey";
import { Materials } from "../../Materials";
import { ModelObject, ModelObjectOptions } from "../scene/ModelObject";
import { createFluidGeometry, FluidKind, FluidSampler } from "./FluidGeometry";
import { fluidLightLevel, lightBrightness } from "../../world/_light/FaceLight";

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
                origin?: AssetKey, options?: Partial<ModelObjectOptions>) {
        super({
            key: new AssetKey("minecraft", kind, "models", "fluid", "assets", ".json", origin?.root),
            textures: { still: `minecraft:block/${kind}_still`, flow: `minecraft:block/${kind}_flow` },
            elements: []
        }, options);
    }

    protected createMeshes(): void {
        const geometry = this.geometry = createFluidGeometry(this.kind, this.sample);
        const atlas = this.textureAtlas!;
        const uv = geometry.getAttribute("uv");
        for (const group of geometry.groups) {
            const name = group.materialIndex === 0 ? "still" : "flow";
            const [x, y] = atlas.positions[name];
            const [width, height] = atlas.sizes[name];
            const vertices = new Set(Array.from(geometry.index!.array.slice(group.start, group.start + group.count)));
            for (const vertex of vertices) {
                uv.setXY(vertex, (x + uv.getX(vertex) * width) / atlas.image.width,
                    1 - (y + (1 - uv.getY(vertex)) * height) / atlas.image.height);
            }
        }
        geometry.clearGroups();
        const color = new Color(this.options.tints?.[0] ?? (this.kind === "water" ? 0x3f76e4 : 0xffffff));
        const colors = new Float32Array(geometry.getAttribute("position").count * 3);
        const normals = geometry.getAttribute("normal");
        for (let vertex = 0; vertex < normals.count; vertex++) {
            const light = this.options.light;
            const brightness = light ? lightBrightness(fluidLightLevel(light[0], light[normals.getY(vertex) < 0 ? 4 : 3])) : 1;
            colors.set([color.r * brightness, color.g * brightness, color.b * brightness], vertex * 3);
        }
        geometry.setAttribute("color", new BufferAttribute(colors, 3));
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        if (this.options.instanceMeshes) {
            this.add(this.createInstancedMesh(undefined, geometry, Materials.MISSING_TEXTURE, this.options.maxInstanceCount));
        } else {
            this.createAndAddMesh(undefined, undefined, geometry, Materials.MISSING_TEXTURE);
        }
    }

    protected applyTextures(): void {
        if (!this.geometry!.index!.count) return;
        super.applyTextures();
        this.iterateAllMeshes(mesh => {
            const material = mesh.material as ShaderMaterial;
            material.side = DoubleSide;
            material.forceSinglePass = true;
            material.depthWrite = !material.transparent;
        });
    }

    public disposeAndRemoveAllChildren(): void {
        this.geometry?.dispose();
        this.geometry = undefined;
        super.disposeAndRemoveAllChildren();
    }
}
