import { AssetLoader, Caching, shutdown } from "minerender";
import * as THREE from "three";
import { createFixture, installFixtureAssets } from "./fixture";

const button = document.getElementById("reverse") as HTMLButtonElement;
const status = document.getElementById("status")!;
const order = document.getElementById("order")!;
const renders = document.getElementById("renders")!;
let reversed = false;

function capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, label: string) {
    renderer.render(scene, camera);
    const gl = renderer.getContext(), pixel = new Uint8Array(4);
    gl.readPixels(160, 120, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL error while rendering " + label);
    const figure = document.createElement("figure"), image = document.createElement("img");
    image.src = renderer.domElement.toDataURL();
    image.alt = label;
    image.width = 320; image.height = 240;
    const caption = document.createElement("figcaption"), sample = document.createElement("span");
    caption.textContent = label;
    sample.className = "sample";
    sample.textContent = "Center pixel RGB: " + Array.from(pixel.slice(0, 3)).join(", ");
    caption.append(sample);
    figure.append(image, caption);
    return { figure, pixel: Array.from(pixel) };
}

function meshes(scene: THREE.Scene) {
    const result: { transparent: boolean; depthWrite: boolean; triangles: number }[] = [];
    scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
            const material = object.material as THREE.Material;
            result.push({ transparent: material.transparent, depthWrite: material.depthWrite,
                triangles: object.geometry.getIndex()!.count / 3 });
        }
    });
    return result;
}

async function run() {
    button.disabled = true;
    status.textContent = "Rendering…";
    order.textContent = reversed ? "Placement: blue, then red" : "Placement: red, then blue";
    const fixtures: Awaited<ReturnType<typeof createFixture>>[] = [];
    let renderer: THREE.WebGLRenderer | undefined;
    try {
        const merged = await createFixture(false, reversed);
        fixtures.push(merged);
        const separate = await createFixture(true, reversed);
        fixtures.push(separate);
        const mergedMeshes = meshes(merged.scene), separateMeshes = meshes(separate.scene);
        if (mergedMeshes.length !== 1 || separateMeshes.length !== 2
            || [...mergedMeshes, ...separateMeshes].some(mesh => !mesh.transparent || mesh.triangles !== (mesh === mergedMeshes[0] ? 8 : 4))) {
            throw new Error("Fixture did not produce one merged mesh and two separate translucent meshes");
        }
        renderer = new THREE.WebGLRenderer({ alpha: false, antialias: false });
        renderer.setSize(320, 240);
        renderer.setClearColor(0x000000, 1);
        const camera = new THREE.OrthographicCamera(-16, 16, 12, -12, 0.1, 200);
        const fragment = document.createDocumentFragment();
        const views: { side: string; merged: number[]; separate: number[]; difference: number }[] = [];
        for (const direction of [1, -1]) {
            const side = direction === 1 ? "From the blue side (+Z)" : "From the red side (−Z)";
            const section = document.createElement("section"), heading = document.createElement("h2");
            heading.textContent = side;
            const pair = document.createElement("div");
            pair.className = "pair";
            const pixels: number[][] = [];
            for (const [index, fixture] of fixtures.entries()) {
                camera.position.set(0, 0, fixture.targetZ + direction * 80);
                camera.lookAt(0, 0, fixture.targetZ);
                camera.updateMatrixWorld();
                const result = capture(renderer, fixture.scene, camera,
                    index === 0 ? "One merged section · 1 mesh" : "Across a section boundary · 2 meshes");
                pair.append(result.figure);
                pixels.push(result.pixel);
            }
            if (pixels[1][0] < 10 || pixels[1][2] < 10) throw new Error("Reference view is missing a translucent slab");
            const difference = Math.max(...pixels[0].map((value, index) => Math.abs(value - pixels[1][index])));
            views.push({ side, merged: pixels[0], separate: pixels[1], difference });
            section.append(heading, pair);
            fragment.append(section);
        }
        renders.replaceChildren(fragment);
        const mismatches = views.filter(view => view.difference > 4).length;
        status.textContent = mismatches ? "PASS: fixture loaded. Issue reproduced in " + mismatches + " of 2 camera views."
            : "PASS: fixture loaded. Both camera views match; the issue was not reproduced.";
        return { reversed, mismatches, views, mergedMeshes, separateMeshes };
    } finally {
        for (const fixture of fixtures) await fixture.world.clear();
        renderer?.dispose();
        button.disabled = false;
    }
}

function refresh() {
    window["transparencyTest"] = run().catch(error => {
        status.textContent = "FAIL: " + (error instanceof Error ? error.message : String(error));
        return { error: status.textContent };
    });
}

installFixtureAssets();
button.addEventListener("click", () => { reversed = !reversed; refresh(); });
window.addEventListener("pagehide", () => {
    AssetLoader.removeSource("transparency-fixture");
    Caching.clear();
    shutdown();
}, { once: true });
refresh();
