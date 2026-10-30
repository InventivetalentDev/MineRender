import test from "ava";
import { MeshBasicMaterial, ShaderLib, Texture } from "three";
import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from "three";
import { Materials } from "../src/Materials";
import { SpecialItems } from "../src/model/SpecialItems";

const canvas = {} as HTMLCanvasElement;

function patched(material: Material): { vertexShader: string; fragmentShader: string } {
    const shader = { ...ShaderLib.basic, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    return shader;
}

// Patches edit three's built-in shader text, and a replace that finds nothing fails silently: run this after a three update.
test("every onBeforeCompile patch still finds its target in three's basic material shaders", t => {
    const source = new MeshBasicMaterial({ map: new Texture() });
    const materials = {
        swirl: Materials.createEntityCanvasMaterial(canvas, "energy_swirl"),
        bounded: Materials.createEntityCanvasMaterial(canvas, "cutout"),
        gui: Materials.createGuiCanvasMaterial(canvas),
        item: SpecialItems.createMaterial(source, true)
    };
    t.teardown(() => [source, ...Object.values(materials)].forEach(material => { material.map!.dispose(); material.dispose(); }));

    t.true(patched(materials.swirl).fragmentShader.includes("gl_FragColor.a = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));"));
    const bounded = patched(materials.bounded);
    t.true(bounded.vertexShader.includes("attribute vec4 uvBounds;") && bounded.vertexShader.includes("vUvBounds = uvBounds;"));
    t.true(bounded.fragmentShader.includes("flat in vec4 vUvBounds;"));
    t.true(bounded.fragmentShader.includes("texture2D( map, clamp( vMapUv, vUvBounds.xy + uvInset, vUvBounds.zw - uvInset ) )"));
    const gui = patched(materials.gui);
    t.true(gui.vertexShader.includes("centroid out vec2 vMapUv;") && gui.fragmentShader.includes("centroid in vec2 vMapUv;"));
    const item = patched(materials.item);
    t.true(item.vertexShader.includes("itemLight = (1.0 + N.y)") && item.fragmentShader.includes("diffuseColor.rgb *= itemLight;"));
    t.true(item.fragmentShader.includes("vUvBounds.xy + uvInset"));
});
