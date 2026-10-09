import { ClampToEdgeWrapping, CustomBlending, DoubleSide, EqualDepth, Float32BufferAttribute, LinearFilter, Mesh, OneFactor, RepeatWrapping, ShaderMaterial, SrcColorFactor, Vector2, ZeroFactor } from "three";
import type { BufferGeometry, Texture } from "three";
import { AssetKey } from "../assets/AssetKey";
import { Models } from "../assets/Models";
import { ModelTextures } from "../assets/ModelTextures";
import { Caching } from "../cache/Caching";
import type { SceneObject } from "../renderer/SceneObject";
import { Textures } from "../texture/Textures";
import { Ticker } from "../Ticker";
import { CUBE_FACES } from "../CubeFace";
import type { ModelFaces } from "./ModelElement";
import type { TextureAtlas } from "../texture/TextureAtlas";

/** An owned glint material over ordinary item geometry; textures and geometry retain their owners. */
export class ItemGlint {
    private ticker?: number;

    private constructor(private readonly owner: SceneObject, readonly material: ShaderMaterial) {
        this.updateTime();
    }

    /** Supplied enchantments enable glint unless a boolean component overrides them. Registry defaults are not inferred. */
    public static enabled(components: Record<string, unknown> = {}): boolean {
        const override = Models.componentValue(components, "enchantment_glint_override");
        if (override !== undefined) {
            if (typeof override !== "boolean") throw new Error("Item enchantment_glint_override must be a boolean");
            return override;
        }
        const enchantments = Models.componentValue(components, "enchantments");
        if (enchantments === undefined) return false;
        if (!enchantments || typeof enchantments !== "object" || Array.isArray(enchantments)) throw new Error("Item enchantments must be an object");
        return Object.keys(enchantments).length > 0;
    }

    /** @internal */
    public static async create(owner: SceneObject, baseMap: Texture, root?: string): Promise<ItemGlint> {
        const key = new AssetKey("minecraft", "enchanted_glint_item", "textures", "misc", "assets", ".png", root);
        const assetKey = key.serialize(), textureKey = `item-glint:${assetKey}`;
        let texture = Caching.textureCache.getIfPresent(textureKey);
        if (!texture) {
            const pending = ModelTextures.get(key);
            const cachedAsset = Caching.textureAssetCache.getIfPresent(assetKey);
            const [image, metadata] = await Promise.all([pending, ModelTextures.getMeta(key)]);
            if (!image) throw new Error(`Missing item glint texture ${key.toNamespacedString()}`);
            // A cache clear during decoding must not restore an older source's texture.
            if (cachedAsset && Caching.textureAssetCache.getIfPresent(assetKey) !== cachedAsset) return this.create(owner, baseMap, root);
            texture = Caching.textureCache.get(textureKey, () => {
                const texture = Textures.createCanvasTexture((image.data as CanvasRenderingContext2D).canvas);
                texture.wrapS = texture.wrapT = metadata?.texture?.clamp ? ClampToEdgeWrapping : RepeatWrapping;
                if (metadata?.texture?.blur) texture.magFilter = texture.minFilter = LinearFilter;
                return texture;
            });
        }
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
                    gl_FragColor = color;
                    #include <colorspace_fragment>
                    gl_FragColor.rgb *= glintAlpha;
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
            pass.raycast = () => {};
            pass.renderOrder = base.renderOrder + 0.5;
            base.add(pass);
        }
        return new ItemGlint(owner, material);
    }

    /**
     * Uses a fixed sprite span and local phase to approximate glint density without Minecraft's shared item atlas.
     * @internal
     */
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

    /** @internal */
    public updateSubscription(active: boolean): void {
        if (active && this.ticker === undefined) {
            this.updateTime();
            this.ticker = Ticker.add(() => { this.updateTime(); this.owner.notifyDirty(); });
        } else if (!active) {
            Ticker.remove(this.ticker);
            this.ticker = undefined;
        }
    }

    public dispose(): void {
        Ticker.remove(this.ticker);
        this.ticker = undefined;
        this.material.dispose();
    }
}
