import { MaterialKey, serializeMaterialKey } from "./cache/CacheKey";
import { Color, DoubleSide, FrontSide, Material, MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial, MeshStandardMaterial, ShaderMaterial } from "three";
import { Textures } from "./texture/Textures";
import { Caching } from "./cache/Caching";
import { AssetKey } from "./assets/AssetKey";

export class Materials {

    public static readonly MISSING_TEXTURE = Materials.getImage({ texture: { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAABlBMVEX/AP8AAACfphTyAAAAFUlEQVQoz2MIhQKGVVAwKjIqQrwIAHRz/wFI17TEAAAAAElFTkSuQmCC" } });

    public static createImage(key: MaterialKey): MeshBasicMaterial {
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

    public static createShadedCanvasMaterial(canvas: HTMLCanvasElement, transparent: boolean = false, shade:boolean=false):Material {
        //TODO
        //  this might help https://github.com/JannisX11/blockbench/blob/1701f764641376414d29100c4f6c7cd74997fad8/js/preview/canvas.js#L62


        // Based on https://github.com/JannisX11/blockbench/blob/cc73aa8a9c0494fd9fe1cee4d062d060af4db06d/js/texturing/textures.js#L59
        //  + support for instanced meshes
        const vertShader =`
            uniform bool SHADE;
            
            varying vec2 vUv;
            varying float light;
            varying float lift;

            float AMBIENT = 0.5;
            float XFAC = -0.15;
            float ZFAC = 0.05;

            void main()
            {

                if (SHADE) {

                    vec3 N = vec3( modelMatrix * vec4(normal, 0.0) );

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

            varying vec2 vUv;
            varying float light;
            varying float lift;

            void main(void)
            {
                vec4 color = texture2D(map, vUv);
                
                if (color.a < 0.01) discard;

                if (EMISSIVE == false) {

                    gl_FragColor = vec4(lift + color.rgb * light * BRIGHTNESS, color.a);

                } else {

                    float light2 = (light * BRIGHTNESS) + (1.0 - light * BRIGHTNESS) * (1.0 - color.a);
                    gl_FragColor = vec4(lift + color.rgb * light2, 1.0);

                }
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

    public static getImage(key: MaterialKey): Material {
        const keyStr = serializeMaterialKey(key);
        return Caching.materialCache.get(keyStr, k => {
            return Materials.createImage(key);
        })!;
    }

}
