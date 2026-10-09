import { ClampToEdgeWrapping, CustomBlending, DoubleSide, EqualDepth, Float32BufferAttribute, LinearFilter, Mesh, OneFactor, RepeatWrapping, ShaderMaterial, SrcColorFactor, Vector2, ZeroFactor } from "three";
import type { BufferGeometry, Object3D, Texture } from "three";
import { AssetKey } from "../assets/AssetKey";
import { ModelTextures } from "../assets/ModelTextures";
import type { SceneObject } from "../renderer/SceneObject";
import { Textures } from "../texture/Textures";
import { Ticker } from "../Ticker";
import { CUBE_FACES } from "../CubeFace";
import type { ModelFaces } from "./ModelElement";
import type { TextureAtlas } from "../texture/TextureAtlas";

/** An owned glint pass over ordinary item geometry; the base atlas and geometry retain their owners. */
export class ItemGlint {
    private ticker?: number;
    private readonly ancestors = new Set<Object3D>();

    private constructor(private readonly owner: SceneObject, readonly material: ShaderMaterial, private readonly texture: Texture) {
        this.updateTime();
        this.updateSubscription();
    }

    /** Supplied enchantments enable glint unless a boolean component overrides them. Registry defaults are not inferred. */
    public static enabled(components: Record<string, unknown> = {}): boolean {
        const component = (id: string): unknown => {
            if (Object.prototype.hasOwnProperty.call(components, id) && Object.prototype.hasOwnProperty.call(components, `minecraft:${id}`)) {
                throw new Error(`Duplicate item-preview component: minecraft:${id}`);
            }
            return Object.prototype.hasOwnProperty.call(components, id) ? components[id] : components[`minecraft:${id}`];
        };
        const override = component("enchantment_glint_override");
        if (override !== undefined) {
            if (typeof override !== "boolean") throw new Error("Item enchantment_glint_override must be a boolean");
            return override;
        }
        const enchantments = component("enchantments");
        if (enchantments === undefined) return false;
        if (!enchantments || typeof enchantments !== "object" || Array.isArray(enchantments)) throw new Error("Item enchantments must be an object keyed by enchantment identifier");
        const entries = Object.entries(enchantments);
        const ids = new Set<string>();
        for (const [id, level] of entries) {
            const normalized = id.includes(":") ? id : `minecraft:${id}`;
            if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(normalized) || ids.has(normalized)) throw new Error(`Invalid or duplicate item enchantment: ${id}`);
            if (!Number.isInteger(level) || level < 1 || level > 255) throw new Error("Item enchantment levels must be integers from 1 to 255");
            ids.add(normalized);
        }
        return entries.length > 0;
    }

    public static async create(owner: SceneObject, baseMap: Texture, root?: string): Promise<ItemGlint> {
        const key = new AssetKey("minecraft", "enchanted_glint_item", "textures", "misc", "assets", ".png", root);
        const [image, metadata] = await Promise.all([ModelTextures.get(key), ModelTextures.getMeta(key)]);
        if (!image) throw new Error(`Missing item glint texture ${key.toNamespacedString()}`);
        const texture = Textures.createCanvasTexture((image.data as CanvasRenderingContext2D).canvas);
        texture.wrapS = texture.wrapT = metadata?.texture?.clamp ? ClampToEdgeWrapping : RepeatWrapping;
        if (metadata?.texture?.blur) texture.magFilter = texture.minFilter = LinearFilter;
        const material = new ShaderMaterial({
            name: "item-glint", transparent: true, depthWrite: false, depthFunc: EqualDepth, side: DoubleSide, forceSinglePass: true,
            blending: CustomBlending, blendSrc: SrcColorFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
            toneMapped: false,
            uniforms: { baseMap: { value: baseMap }, glintMap: { value: texture }, glintOffset: { value: new Vector2() }, glintAlpha: { value: 0.75 } },
            vertexShader: `
                uniform vec2 glintOffset;
                attribute vec4 uvBounds;
                attribute vec2 glintUv;
                flat out vec4 vUvBounds;
                centroid out vec2 vUv;
                varying vec2 vGlintUv;
                void main() {
                    vUv = uv;
                    vUvBounds = uvBounds;
                    vec2 p = glintUv * 8.0;
                    float angle = radians(10.0);
                    vGlintUv = vec2(cos(angle) * p.x - sin(angle) * p.y, sin(angle) * p.x + cos(angle) * p.y) + glintOffset;
                    vec4 mvPosition = vec4(position, 1.0);
                    mvPosition = modelViewMatrix * mvPosition;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform sampler2D baseMap;
                uniform sampler2D glintMap;
                uniform float glintAlpha;
                flat in vec4 vUvBounds;
                centroid in vec2 vUv;
                varying vec2 vGlintUv;
                void main() {
                    vec2 mapUv = clamp(vUv, vUvBounds.xy, vUvBounds.zw);
                    if (texture2D(baseMap, mapUv).a < 0.01) discard;
                    vec4 color = texture2D(glintMap, vec2(vGlintUv.x, 1.0 - vGlintUv.y));
                    if (color.a < 0.1) discard;
                    gl_FragColor = vec4(color.rgb * glintAlpha, color.a);
                    #include <colorspace_fragment>
                }
            `
        });
        Object.assign(material.defaultAttributeValues, { uvBounds: [0, 0, 1, 1] });
        const bases: Mesh[] = [];
        owner.iterateAllMeshes(mesh => bases.push(mesh));
        for (const base of bases) {
            const pass = new Mesh(base.geometry, material);
            pass.name = `${base.name}:glint`;
            pass.userData.minerenderItemGlint = true;
            pass.renderOrder = base.renderOrder + 0.5;
            base.add(pass);
        }
        return new ItemGlint(owner, material, texture);
    }

    /** Uses a fixed sprite span and local phase to approximate glint density without Minecraft's shared item atlas. */
    public static mapUvs(geometry: BufferGeometry, faces: ModelFaces, atlas: TextureAtlas): void {
        const uv = geometry.getAttribute("uv");
        const mapped = new Float32Array(uv.count * 2);
        for (const [faceIndex, face] of CUBE_FACES.entries()) {
            const texture = faces[face]?.texture?.substring(1);
            const position = texture && atlas.positions[texture] || [0, 0];
            const size = texture && atlas.sizes[texture] || [atlas.image.width, atlas.image.height];
            for (let corner = 0; corner < 4; corner++) {
                const index = faceIndex * 4 + corner;
                mapped[index * 2] = (uv.getX(index) * atlas.image.width - position[0]) / size[0] / 32;
                mapped[index * 2 + 1] = ((1 - uv.getY(index)) * atlas.image.height - position[1]) / size[1] / 32;
            }
        }
        geometry.setAttribute("glintUv", new Float32BufferAttribute(mapped, 2));
    }

    private updateTime(): void {
        const time = Math.trunc(Date.now() * 4);
        (this.material.uniforms.glintOffset.value as Vector2).set(-(time % 110000) / 110000, (time % 30000) / 30000);
    }

    private readonly updateSubscription = (): void => {
        const current = new Set<Object3D>();
        let attached = false;
        for (let node: Object3D | null = this.owner; node; node = node.parent) {
            current.add(node);
            if ((node as { isScene?: boolean }).isScene) attached = true;
        }
        for (const node of this.ancestors) {
            if (!current.has(node)) {
                node.removeEventListener("added", this.updateSubscription);
                node.removeEventListener("removed", this.updateSubscription);
            }
        }
        for (const node of current) {
            if (!this.ancestors.has(node)) {
                node.addEventListener("added", this.updateSubscription);
                node.addEventListener("removed", this.updateSubscription);
            }
        }
        this.ancestors.clear();
        for (const node of current) this.ancestors.add(node);
        if (attached && this.ticker === undefined) {
            this.updateTime();
            this.ticker = Ticker.add(() => { this.updateTime(); this.owner.notifyDirty(); });
        } else if (!attached) {
            Ticker.remove(this.ticker);
            this.ticker = undefined;
        }
    };

    public dispose(): void {
        Ticker.remove(this.ticker);
        this.ticker = undefined;
        for (const node of this.ancestors) {
            node.removeEventListener("added", this.updateSubscription);
            node.removeEventListener("removed", this.updateSubscription);
        }
        this.ancestors.clear();
        this.material.dispose();
        this.texture.dispose();
    }
}
