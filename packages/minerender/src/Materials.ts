import { MaterialKey, serializeMaterialKey } from "./cache/CacheKey";
import { Color, ColorRepresentation, CustomBlending, DoubleSide, OneFactor, OneMinusSrcAlphaFactor, RepeatWrapping, FrontSide, Material, MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, MeshStandardMaterial, ShaderChunk, ShaderMaterial } from "three";
import { Textures } from "./texture/Textures";
import { TextureLoader } from "./texture/TextureLoader";
import { Caching } from "./cache/Caching";
import { AssetKey } from "./assets/AssetKey";
import type { EntityRenderMode } from "./entity/EntityModel";

/** Creates Minecraft model, entity, and GUI materials, with shared caches for image materials. */
export class Materials {

    /** Shared checkerboard material, created on first access. */
    public static get MISSING_TEXTURE(): Material {
        return Caching.materialCache.get("builtin:missing-texture", () => new MeshBasicMaterial({
            map: Textures.getMissing(),
            alphaTest: 0.5
        }))!;
    }

    public static createImage(key: MaterialKey): Material {
        //TODO: type from key
        const transparent = key.transparent || false;
        return new MeshBasicMaterial({
            map: Textures.getImage(key.texture),
            transparent: transparent,
            side: transparent ? DoubleSide : FrontSide,
            alphaTest: 0.5
        });
        //TODO: params
    }


    public static createBasicCanvasMaterial(canvas: HTMLCanvasElement, transparent: boolean = false, shade: boolean = false): Material {
        if (shade) {
            return new MeshStandardMaterial({
                map: Textures.createCanvasTexture(canvas),
                transparent: transparent,
                side: transparent ? DoubleSide : FrontSide,
                alphaTest: 0.5,

            })
        }
        return new MeshBasicMaterial({
            map: Textures.createCanvasTexture(canvas),
            transparent: transparent,
            side: transparent ? DoubleSide : FrontSide,
            alphaTest: 0.5,

        })
    }

    /** Whether vanilla's render type for the mode culls back faces. */
    public static entityModeCulls(mode: EntityRenderMode = "cutout"): boolean {
        return mode === "cutout_cull" || mode === "solid" || mode === "eyes" || mode === "water_mask";
    }

    /** UV offset per tick of entity age for the scrolling modes, as vanilla's texture matrix applies it. */
    public static entityModeScroll(mode: EntityRenderMode = "cutout"): [number, number] | undefined {
        if (mode === "energy_swirl") return [0.01, 0.01];
        if (mode === "breeze_wind") return [0.02, 0];
        return undefined;
    }

    /**
     * Entity material for one of vanilla's render types. Entities are unlit here, so the lit and full-bright modes
     * differ only in blending and depth state. Culling is not a material property: {@link entityModeCulls} decides
     * whether the geometry gets inward faces.
     */
    public static createEntityCanvasMaterial(canvas: HTMLCanvasElement, mode: EntityRenderMode = "cutout", tint?: ColorRepresentation): MeshBasicMaterial {
        const material = Materials.createBasicCanvasMaterial(canvas) as MeshBasicMaterial;
        switch (mode) {
            case "cutout":
            case "cutout_cull":
                break;
            case "cutout_z_offset":
                material.polygonOffset = true;
                material.polygonOffsetFactor = -1;
                material.polygonOffsetUnits = -10;
                break;
            case "solid":
                material.alphaTest = 0;
                break;
            case "translucent":
            case "breeze_wind":
                material.transparent = true;
                material.alphaTest = 0.1;
                break;
            case "translucent_emissive":
                material.transparent = true;
                material.alphaTest = 0.1;
                material.depthWrite = false;
                break;
            case "eyes":
                material.transparent = true;
                material.alphaTest = 0;
                material.depthWrite = false;
                break;
            case "energy_swirl":
                material.transparent = true;
                material.alphaTest = 0.1;
                material.blending = CustomBlending;
                material.blendSrc = OneFactor;
                material.blendDst = OneFactor;
                // The canvas is premultiplied: a glow pixel needs alpha, or browsers and image exports drop it wherever
                // nothing opaque is behind it. Its brightness serves as coverage, so the glow stays visible outside the body.
                material.blendSrcAlpha = OneFactor;
                material.blendDstAlpha = OneMinusSrcAlphaFactor;
                material.onBeforeCompile = shader => {
                    shader.fragmentShader = shader.fragmentShader.replace("#include <dithering_fragment>",
                        "gl_FragColor.a = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));\n#include <dithering_fragment>");
                };
                material.customProgramCacheKey = () => "energy_swirl";
                // Vanilla submits the swirl with half-grey vertex colour.
                material.color.set(0x808080);
                break;
            case "water_mask":
                material.alphaTest = 0;
                material.colorWrite = false;
                break;
        }
        if (Materials.entityModeScroll(mode)) {
            material.map!.wrapS = material.map!.wrapT = RepeatWrapping;
        }
        if (tint !== undefined) material.color.multiply(new Color(tint));
        return material;
    }

    /** Creates an unlit, transparent GUI material without depth writes or tone mapping. */
    public static createGuiCanvasMaterial(canvas: HTMLCanvasElement): MeshBasicMaterial {
        const material = new MeshBasicMaterial({
            map: Textures.createCanvasTexture(canvas),
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            toneMapped: false
        });
        material.onBeforeCompile = shader => {
            // Keep MSAA edge pixels inside the layer's cropped texture region.
            for (const [stage, direction] of [["vertex", "out"], ["fragment", "in"]] as const) {
                const chunk = `uv_pars_${stage}` as const;
                shader[`${stage}Shader`] = shader[`${stage}Shader`].replace(`#include <${chunk}>`,
                    ShaderChunk[chunk].replace("varying vec2 vMapUv;", `
                        #if __VERSION__ >= 300
                        centroid ${direction} vec2 vMapUv;
                        #else
                        varying vec2 vMapUv;
                        #endif
                    `));
            }
        };
        return material;
    }

    public static createShadedCanvasMaterial(canvas: HTMLCanvasElement, transparent: boolean = false, shade:boolean=false):Material {
        //TODO
        //  this might help https://github.com/JannisX11/blockbench/blob/1701f764641376414d29100c4f6c7cd74997fad8/js/preview/canvas.js#L62


        // Based on https://github.com/JannisX11/blockbench/blob/cc73aa8a9c0494fd9fe1cee4d062d060af4db06d/js/texturing/textures.js#L59
        //  + support for instanced meshes
        const vertShader =`
            uniform bool SHADE;
            
            // Keep MSAA edge pixels from sampling outside the face's atlas region.
            #if __VERSION__ >= 300
            centroid out vec2 vUv;
            #else
            varying vec2 vUv;
            #endif
            varying vec3 vTint;
            varying float light;
            varying float lift;

            float AMBIENT = 0.5;
            float XFAC = -0.15;
            float ZFAC = 0.05;

            void main()
            {

                if (SHADE) {

                    #ifdef USE_INSTANCING
                        vec3 N = vec3( modelMatrix * instanceMatrix * vec4(normal, 0.0) );
                    #else
                        vec3 N = vec3( modelMatrix * vec4(normal, 0.0) );
                    #endif

                    float yLight = (1.0+N.y) * 0.5;
                    light = yLight * (1.0-AMBIENT) + N.x*N.x * XFAC + N.z*N.z * ZFAC + AMBIENT;

                } else {

                    light = 1.0;

                } 

                if (color.b > 1.1) {
                    lift = 0.1;
                } else {
                    lift = 0.0;
                }
                
                vUv = uv;
                vTint = color;
               
                #ifdef USE_INSTANCING
                    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
                #else
                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                #endif
                
            }
        `
        const fragShader = `
            #ifdef GL_ES
            precision highp float;
            #endif

            uniform sampler2D map;

            uniform bool SHADE;
            uniform bool EMISSIVE;
            uniform float BRIGHTNESS;

            #if __VERSION__ >= 300
            centroid in vec2 vUv;
            #else
            varying vec2 vUv;
            #endif
            varying vec3 vTint;
            varying float light;
            varying float lift;

            void main(void)
            {
                vec4 color = texture2D(map, vUv);
                color.rgb *= vTint;
                
                if (color.a < 0.01) discard;

                if (EMISSIVE == false) {

                    gl_FragColor = vec4(lift + color.rgb * light * BRIGHTNESS, color.a);

                } else {

                    float light2 = (light * BRIGHTNESS) + (1.0 - light * BRIGHTNESS) * (1.0 - color.a);
                    gl_FragColor = vec4(lift + color.rgb * light2, 1.0);

                }

                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `
        //TODO: this does add the MC-like shading, but breaks when stuff is instanced (can't updated position)
        //  https://medium.com/@pailhead011/instancing-with-three-js-part-2-3be34ae83c57 might help with that

        try {
            return new ShaderMaterial({
                uniforms: {
                    SHADE: { value: true },
                    BRIGHTNESS: { value: 1 },
                    EMISSIVE:{value:false},
                    base: { value: new Color(0xc1c1c1)/*TODO*/ },
                    map: {value:Textures.createCanvasTexture(canvas)}
                },
                vertexShader: vertShader,
                fragmentShader: fragShader,
                vertexColors: true,
                transparent: transparent,
                side: transparent ? DoubleSide : FrontSide,
                alphaTest: 0.5,
            });
        } catch (e) {
            console.warn(e)
        }

        // fallback
        return this.createBasicCanvasMaterial(canvas, transparent, shade);
    }

    /** Returns a shared image material. Use {@link createImage} for a separate material instance. */
    public static getImage(key: MaterialKey): Material {
        const keyStr = serializeMaterialKey(key);
        const map = (Caching.materialCache.peek(keyStr) as MeshBasicMaterial | undefined)?.map;
        if (map && TextureLoader.hasFailed(map)) {
            Caching.materialCache.invalidate(keyStr);
        }
        return Caching.materialCache.get(keyStr, k => {
            return Materials.createImage(key);
        })!;
    }

    public static needsUpdate(mat: Material) {
        mat.needsUpdate = true;

        if (mat.type === 'ShaderMaterial') {
            let mat1=mat as ShaderMaterial;
            if ("map" in mat1.uniforms) {
                mat1.uniforms.map.value.needsUpdate = true;
            }
        }
        if (mat.type === 'MeshBasicMaterial' || mat.type === 'MeshStandardMaterial') {
            let mat1 = mat as (MeshBasicMaterial | MeshStandardMaterial);
            if (mat1.map) {
                mat1.map.needsUpdate = true;
            }
        }
    }

}
