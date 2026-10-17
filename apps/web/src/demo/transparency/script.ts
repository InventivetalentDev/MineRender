import { AssetLoader, Caching, shutdown } from "minerender";
import * as THREE from "three";
import { createFixture, installFixtureAssets } from "./fixture";

type Fixture = Awaited<ReturnType<typeof createFixture>>;
type View = Fixture & { grid: THREE.GridHelper };
const width = 480, height = 360;
const button = document.getElementById("reverse") as HTMLButtonElement;
const slider = document.getElementById("camera-angle") as HTMLInputElement;
const controls = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input"));
const status = document.getElementById("status")!;
const order = document.getElementById("order")!;
const angleOutput = document.getElementById("angle")!;
const explanation = document.getElementById("explanation")!;
const measurements = document.getElementById("measurements")!;
let reversed = false;
let views: View[] = [];
const renderers: THREE.WebGLRenderer[] = [];

function meshCount(scene: THREE.Scene): number {
    let count = 0;
    scene.traverse(object => { if (object instanceof THREE.Mesh) count++; });
    return count;
}

function draw() {
    if (views.length !== 2) return;
    const angle = Number(slider.value), radians = angle * Math.PI / 180;
    const front = angle > 90 ? "A" : "B", rear = front === "A" ? "B" : "A";
    angleOutput.textContent = angle + "° · " + (angle === 90 ? "edge-on" : front + " in front");
    const pixels: Uint8Array[] = [];
    for (const [index, view] of views.entries()) {
        const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 500);
        camera.position.set(Math.sin(radians) * 80, 20, view.targetZ + Math.cos(radians) * 80);
        camera.lookAt(0, 0, view.targetZ);
        const renderer = renderers[index];
        renderer.render(view.scene, camera);
        const gl = renderer.getContext(), data = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL error while drawing the panels");
        pixels.push(data);
    }
    let differentPixels = 0;
    for (let i = 0; i < pixels[0].length; i += 4) {
        if ([0, 1, 2].some(channel => Math.abs(pixels[0][i + channel] - pixels[1][i + channel]) > 8)) differentPixels++;
    }
    const differs = differentPixels > 100;
    status.textContent = differs ? "Issue visible: part of the rear panel is missing in the merged section."
        : "These views match at this angle. Try the opposite camera preset.";
    explanation.textContent = differs ? "Look inside panel " + front + ": panel " + rear
        + "’s letter and grid contribute in the comparison, but are hidden in the merged section."
        : "Both views include the same panel detail. Moving the camera changes which panel is nearer; reversing placement changes the draw order.";
    measurements.textContent = differentPixels.toLocaleString() + " pixels differ between the views (RGB tolerance: 8/255).";
    const result = { angle, reversed, differentPixels, differs, mergedMeshes: meshCount(views[0].scene), separateMeshes: meshCount(views[1].scene) };
    window["transparencyResult"] = result;
    return result;
}

async function release(items: View[]) {
    for (const view of items) {
        await view.world.clear();
        view.grid.dispose();
    }
}

async function refresh() {
    controls.forEach(control => { control.disabled = true; });
    status.textContent = "Loading the two panels…";
    const next: View[] = [];
    try {
        for (const split of [false, true]) {
            const fixture = await createFixture(split, reversed);
            const grid = new THREE.GridHelper(64, 8, 0x71808c, 0x39434f);
            grid.position.set(0, -12, fixture.targetZ);
            fixture.scene.add(grid);
            fixture.scene.background = new THREE.Color(0x151b23);
            next.push({ ...fixture, grid });
        }
        if (meshCount(next[0].scene) !== 1 || meshCount(next[1].scene) !== 2) {
            throw new Error("Expected one merged mesh and two separate meshes");
        }
        await release(views);
        views = next;
        order.textContent = reversed ? "Placement: B, then A" : "Placement: A, then B";
        return draw();
    } catch (error) {
        if (views !== next) await release(next);
        throw error;
    } finally {
        controls.forEach(control => { control.disabled = false; });
    }
}

function reload() {
    window["transparencyTest"] = refresh().catch(error => {
        status.textContent = "Could not render the comparison: " + (error instanceof Error ? error.message : String(error));
        return { error: status.textContent };
    });
}

try {
    installFixtureAssets();
    for (const id of ["merged", "separate"]) {
        const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true });
        renderer.setSize(width, height, false);
        renderer.domElement.setAttribute("aria-label", id === "merged" ? "Merged glass panels" : "Separate glass panels for comparison");
        document.getElementById(id)!.append(renderer.domElement);
        renderers.push(renderer);
    }
    slider.addEventListener("input", draw);
    for (const preset of document.querySelectorAll<HTMLButtonElement>("[data-angle]")) {
        preset.addEventListener("click", () => { slider.value = preset.dataset.angle!; draw(); });
    }
    button.addEventListener("click", () => { reversed = !reversed; reload(); });
    window.addEventListener("pagehide", event => {
        if (event.persisted) return;
        void release(views);
        for (const renderer of renderers) renderer.dispose();
        AssetLoader.removeSource("transparency-fixture");
        Caching.clear();
        shutdown();
    });
    reload();
} catch (error) {
    status.textContent = "Could not start the comparison: " + (error instanceof Error ? error.message : String(error));
    window["transparencyTest"] = Promise.resolve({ error: status.textContent });
}
