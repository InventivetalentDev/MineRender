import { AssetKey, Models, type InstanceReference, type ModelObject } from "minerender";
import { Box3, Euler, Vector3 } from "three";
import { Playground } from "../../playground/Playground";
import { checkbox, input, note } from "../../playground/controls";

interface ExportScene { animate: boolean; speed: number; tint: string; }
let current: { apply(): void; isCurrent(): boolean } | undefined;
const app = new Playground<ExportScene>({
    title: "Exports",
    defaults: { animate: false, speed: 1, tint: "#91bd59" },
    renderer: { camera: { position: [85, 65, 100] } },
    async load(ctx, state) {
        if (typeof state.animate !== "boolean" || !Number.isFinite(state.speed) || state.speed < 0 || state.speed > 5
            || !/^#[0-9a-f]{6}$/i.test(state.tint)) throw new Error("Invalid export scene settings.");
        const [stone, grass] = await Promise.all([
            Models.getMerged(AssetKey.parse("models", "minecraft:block/stone")),
            Models.getMerged(AssetKey.parse("models", "minecraft:block/grass_block"))
        ]);
        if (!stone || !grass) throw new Error("A block model is missing.");
        const objects: Array<ModelObject | InstanceReference<ModelObject>> = [];
        let unsubscribe: (() => void) | undefined;
        ctx.onCleanup(() => {
            unsubscribe?.();
            objects.forEach(object => { object.removeFromScene(); object.dispose(); });
        });
        for (const x of [-24, 24]) {
            const block = await ctx.renderer.scene.addModel(stone, { instanceMeshes: true, mergeMeshes: true });
            objects.push(block);
            block.setPosition(new Vector3(x, 0, 0));
        }
        objects.push(await ctx.renderer.scene.addModel(grass, { tints: { 0: Number.parseInt(state.tint.slice(1), 16) } }));
        let angle = 0;
        const apply = () => {
            unsubscribe?.();
            unsubscribe = app.state.animate ? ctx.renderer.onFrame(({ delta }) => {
                if (!ctx.isCurrent()) { unsubscribe?.(); return; }
                angle += delta * app.state.speed;
                objects[0].setRotation(new Euler(0, angle, 0));
            }) : undefined;
        };
        return {
            bounds: new Box3(new Vector3(-32, -12, -12), new Vector3(32, 12, 12)),
            activate() {
                animation.checked = app.state.animate;
                speed.value = String(app.state.speed);
                tint.value = app.state.tint;
                current = { apply, isCurrent: ctx.isCurrent };
                apply();
            }
        };
    },
    code(state) {
        return `const stone = await MineRender.Models.getMerged(MineRender.AssetKey.parse("models", "minecraft:block/stone"));
for (const x of [-24, 24]) {
    const block = await renderer.scene.addModel(stone, { instanceMeshes: true, mergeMeshes: true });
    block.setPosition(new THREE.Vector3(x, 0, 0));
}
const grass = await MineRender.Models.getMerged(MineRender.AssetKey.parse("models", "minecraft:block/grass_block"));
await renderer.scene.addModel(grass, { tints: { 0: ${Number.parseInt(state.tint.slice(1), 16)} } });
const png = renderer.toImage();
const gltf = await MineRender.SceneExporter.toGLTF(renderer.scene);\n`;
    }
});
note(app.controls, "Two instanced stone blocks and a tinted grass block. Use Export below to download the preview as an image or 3D file.");
const animation = checkbox(app.controls, "Rotate one stone block", app.state.animate);
const speed = input(app.controls, "Rotation speed (rad/s)", app.state.speed, "number");
Object.assign(speed, { min: "0", max: "5", step: "0.1" });
const tint = input(app.controls, "Grass tint", app.state.tint, "color");
function record(patch: Partial<ExportScene>): boolean {
    if (!current?.isCurrent()) { void app.update(patch); return false; }
    app.record(patch);
    return true;
}
animation.addEventListener("change", () => { if (record({ animate: animation.checked })) current?.apply(); });
speed.addEventListener("change", () => {
    if (!speed.checkValidity()) return speed.reportValidity();
    record({ speed: speed.valueAsNumber });
});
tint.addEventListener("change", () => { void app.update({ tint: tint.value }); });
void app.start();
