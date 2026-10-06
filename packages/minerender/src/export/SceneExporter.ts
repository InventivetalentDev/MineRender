import { BufferGeometry, ClampToEdgeWrapping, Color, DataTexture, Float32BufferAttribute, InstancedMesh, Material, Matrix4, Mesh, MeshBasicMaterial, NearestFilter, Object3D, RGBAFormat, Scene, ShaderMaterial, TextureSource, Texture, UnsignedByteType } from "three";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { PLYExporter } from "three/examples/jsm/exporters/PLYExporter.js";
import type { PLYExporterOptions } from "three/examples/jsm/exporters/PLYExporter.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { MineRenderError } from "../error/MineRenderError";
import { DisplayTransforms } from "../model/DisplayTransforms";
import { createCanvas } from "../canvas/CanvasCompat";

export type { PLYExporterOptions } from "three/examples/jsm/exporters/PLYExporter.js";

export interface SceneGLTFExportOptions {
    /** Returns a GLB ArrayBuffer instead of a glTF object. */
    binary?: boolean;
    /** Maximum width and height of each exported texture, in pixels. */
    maxTextureSize?: number;
}

/** Exports the visible meshes at their current poses without changing the source scene. */
export class SceneExporter {

    /** Returns OBJ geometry with normals and UVs; material files and textures are not included. */
    public static toObj(root: Object3D): string {
        const snapshot = createSnapshot(root, false);
        try {
            return new OBJExporter().parse(snapshot.scene);
        } finally {
            snapshot.dispose();
        }
    }

    /** Returns PLY geometry with vertex colors and UVs; texture images are not included. */
    public static toPLY(root: Object3D, options?: PLYExporterOptions): string | ArrayBuffer {
        const snapshot = createSnapshot(root, false, true);
        try {
            // The exporter schedules callbacks with requestAnimationFrame, but also returns the result.
            const result = new PLYExporter().parse(snapshot.scene, undefined as any, options);
            if (result === null) throw new MineRenderError("The scene could not be exported as PLY");
            return result;
        } finally {
            snapshot.dispose();
        }
    }

    /**
     * Exports a static glTF/GLB snapshot in a browser. Atlas textures and vertex tints are retained;
     * MineRender's custom directional lighting is not baked into the exported materials.
     */
    public static async toGLTF(root: Object3D, options: SceneGLTFExportOptions = {}): Promise<Record<string, any> | ArrayBuffer> {
        if (typeof document === "undefined" || typeof FileReader === "undefined") {
            throw new MineRenderError("glTF export requires a browser with canvas and FileReader support");
        }
        if (options.maxTextureSize !== undefined && !(options.maxTextureSize >= 1)) {
            throw new MineRenderError("maxTextureSize must be at least 1 pixel");
        }
        const snapshot = createSnapshot(root, true);
        try {
            return await new GLTFExporter().parseAsync(snapshot.scene, {
                binary: options.binary ?? false,
                maxTextureSize: options.maxTextureSize ?? Infinity
            });
        } finally {
            snapshot.dispose();
        }
    }
}

function localMatrix(object: Object3D): Matrix4 {
    return object.matrixAutoUpdate
        ? new Matrix4().compose(object.position, object.quaternion, object.scale)
        : object.matrix.clone();
}

function createSnapshot(root: Object3D, gltf: boolean, bakeColors: boolean = false) {
    const scene = new Scene();
    const geometries: BufferGeometry[] = [];
    const materials: Material[] = [];
    const textures: Texture[] = [];
    const textureCopies = new Map<Texture, Texture>();
    const dispose = () => {
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        for (const texture of textures) texture.dispose();
    };

    const copyMaterial = (source: Material, geometry: BufferGeometry): Material => {
        let material: Material;
        const shader = source as ShaderMaterial;
        if (shader.isShaderMaterial && gltf) {
            const uniforms = shader.uniforms;
            if (!uniforms.map?.value?.isTexture || !uniforms.SHADE || !uniforms.BRIGHTNESS || !uniforms.EMISSIVE) {
                throw new MineRenderError("glTF export does not support this custom ShaderMaterial");
            }
            material = new MeshBasicMaterial({
                map: uniforms.map.value,
                vertexColors: source.vertexColors,
                transparent: source.transparent,
                side: source.side,
                alphaTest: 0.01,
                depthWrite: source.depthWrite
            });
            material.name = source.name;
        } else if (shader.isShaderMaterial) {
            material = new MeshBasicMaterial({ vertexColors: source.vertexColors });
            material.name = source.name;
        } else {
            // Runtime metadata can contain scene references and must not be serialized by clone().
            const copySource = Object.create(source);
            copySource.userData = {};
            material = source.clone.call(copySource);
        }
        materials.push(material);
        if (gltf) {
            selectAlphaMode(material as MeshBasicMaterial, geometry);
            for (const [key, value] of Object.entries(material)) {
                if (value?.isDataTexture) {
                    let texture = textureCopies.get(value);
                    if (!texture) {
                        texture = copyDataTexture(value);
                        textureCopies.set(value, texture);
                        textures.push(texture);
                    }
                    (material as any)[key] = texture;
                }
            }
        }
        return material;
    };

    const addMesh = (mesh: Mesh, world: Matrix4, instanceColor?: Color) => {
        if (world.determinant() === 0 || !mesh.geometry.getAttribute("position")) return;
        const source = mesh.geometry;
        const count = source.index?.count ?? source.getAttribute("position").count;
        const groups = Array.isArray(mesh.material) ? source.groups : [{ start: 0, count, materialIndex: 0 }];
        for (const group of groups) {
            const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[group.materialIndex ?? 0] : mesh.material;
            if (!sourceMaterial?.visible) continue;
            const start = Math.max(group.start, source.drawRange.start);
            const end = Math.min(count, group.start + group.count, source.drawRange.start + source.drawRange.count);
            const indices: number[] = [];
            for (let i = start; i + 2 < end; i += 3) {
                for (let corner = 0; corner < 3; corner++) indices.push(source.index?.getX(i + corner) ?? i + corner);
            }
            if (!indices.length) continue;
            let geometry = source.clone();
            geometry.setIndex(indices);
            if (new Set(indices).size < geometry.getAttribute("position").count) {
                const compact = geometry.toNonIndexed();
                geometry.dispose();
                geometry = compact;
            }
            geometries.push(geometry);
            geometry.userData = {};
            geometry.clearGroups();
            geometry.setDrawRange(0, Infinity);
            DisplayTransforms.apply(geometry, world);
            const material = copyMaterial(sourceMaterial, geometry);
            if (!sourceMaterial.vertexColors) geometry.deleteAttribute("color");
            if (bakeColors || instanceColor) {
                const tint = ((material as MeshBasicMaterial).color ?? new Color()).clone();
                if (instanceColor) tint.multiply(instanceColor);
                if (bakeColors) {
                    const original = geometry.getAttribute("color");
                    const colors = new Float32BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 3), 3);
                    for (let i = 0; i < colors.count; i++) {
                        colors.setXYZ(i, (original?.getX(i) ?? 1) * tint.r, (original?.getY(i) ?? 1) * tint.g, (original?.getZ(i) ?? 1) * tint.b);
                    }
                    geometry.setAttribute("color", colors);
                } else if ((material as MeshBasicMaterial).color) {
                    (material as MeshBasicMaterial).color.copy(tint);
                }
            }
            const copy = new Mesh(geometry, material);
            copy.name = mesh.name;
            copy.renderOrder = mesh.renderOrder;
            scene.add(copy);
        }
    };

    const visit = (object: Object3D, parentWorld: Matrix4) => {
        if (!object.visible) return;
        const world = parentWorld.clone().multiply(localMatrix(object));
        const mesh = object as Mesh;
        if (mesh.isMesh) {
            const instanced = mesh as InstancedMesh;
            if (instanced.isInstancedMesh) {
                for (let i = 0; i < instanced.count; i++) {
                    const matrix = new Matrix4();
                    instanced.getMatrixAt(i, matrix);
                    const color = instanced.instanceColor ? new Color().fromBufferAttribute(instanced.instanceColor, i) : undefined;
                    addMesh(mesh, world.clone().multiply(matrix), color);
                }
            } else {
                addMesh(mesh, world);
            }
        }
        for (const child of object.children) visit(child, world);
    };

    try {
        const ancestors: Object3D[] = [];
        for (let parent = root.parent; parent; parent = parent.parent) ancestors.unshift(parent);
        const world = new Matrix4();
        for (const ancestor of ancestors) {
            if (!ancestor.visible) return { scene, dispose };
            world.multiply(localMatrix(ancestor));
        }
        visit(root, world);
        return { scene, dispose };
    } catch (error) {
        dispose();
        throw error;
    }
}

function selectAlphaMode(material: MeshBasicMaterial, geometry: BufferGeometry): void {
    const texture = material.map as DataTexture | null;
    if (material.type !== "MeshBasicMaterial" || !material.transparent || !material.depthWrite || material.opacity !== 1 || material.alphaMap ||
        !texture?.isDataTexture || texture.format !== RGBAFormat || texture.type !== UnsignedByteType ||
        texture.wrapS !== ClampToEdgeWrapping || texture.wrapT !== ClampToEdgeWrapping ||
        texture.magFilter !== NearestFilter || texture.minFilter !== NearestFilter || texture.anisotropy > 1 ||
        texture.offset.x !== 0 || texture.offset.y !== 0 || texture.repeat.x !== 1 || texture.repeat.y !== 1 || texture.rotation !== 0 ||
        (!texture.matrixAutoUpdate && !texture.matrix.elements.every((value, i) => value === (i % 4 === 0 ? 1 : 0)))) return;
    const uv = geometry.getAttribute(texture.channel === 0 ? "uv" : `uv${texture.channel}`);
    const colors = geometry.getAttribute("color");
    if (!uv || (material.vertexColors && colors?.itemSize === 4)) return;
    const { data, width, height } = texture.image;
    if (!data || width < 1 || height < 1 || data.length < width * height * 4) return;
    const count = geometry.index?.count ?? uv.count;
    let holes = false;
    // Each primitive can use an opaque region of an atlas whose other regions need blending.
    for (let i = 0; i + 2 < count; i += 3) {
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (let corner = 0; corner < 3; corner++) {
            const index = geometry.index?.getX(i + corner) ?? i + corner;
            const u = uv.getX(index), v = texture.flipY ? 1 - uv.getY(index) : uv.getY(index);
            if (!Number.isFinite(u) || !Number.isFinite(v)) return;
            minU = Math.min(minU, u); maxU = Math.max(maxU, u);
            minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }
        const minX = Math.max(0, Math.min(width - 1, Math.floor(minU * width)));
        const maxX = Math.max(minX, Math.min(width - 1, Math.ceil(maxU * width) - 1));
        const minY = Math.max(0, Math.min(height - 1, Math.floor(minV * height)));
        const maxY = Math.max(minY, Math.min(height - 1, Math.ceil(maxV * height) - 1));
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const alpha = data[(y * width + x) * 4 + 3];
                if (alpha === 255) continue;
                if (alpha !== 0 && alpha / 255 >= material.alphaTest) return;
                holes = true;
            }
        }
    }
    // glTF BLEND disables depth writes in common viewers, even for opaque sampled texels.
    material.transparent = false;
    if (holes && material.alphaTest === 0) material.alphaTest = 1 / 255;
}

function copyDataTexture(source: DataTexture): Texture {
    const image = source.image;
    if (!image.data || source.format !== RGBAFormat || source.type !== UnsignedByteType) {
        throw new MineRenderError("glTF export requires RGBA unsigned-byte data textures");
    }
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!context) throw new MineRenderError("glTF export could not create a 2D canvas context");
    const pixels = context.createImageData(image.width, image.height);
    pixels.data.set(image.data);
    context.putImageData(pixels, 0, 0);
    const copySource = Object.create(source);
    copySource.userData = {};
    // GLTFExporter flips canvas images with drawImage; its DataTexture path ignores flipY.
    copySource.source = new TextureSource(canvas);
    return new Texture().copy(copySource);
}
