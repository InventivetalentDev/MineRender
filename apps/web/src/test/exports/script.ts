import { AssetKey, Models, type InstanceReference, type ModelObject } from "minerender";
import { Box3, Vector3 } from "three";
import { Playground } from "../../playground/Playground";
import { input, note } from "../../playground/controls";

interface ExportScene { tint: string; }
const app = new Playground<ExportScene>({
    title: "Exports",
    defaults: { tint: "#91bd59" },
    renderer: { camera: { position: [85, 65, 100] } },
    async load(ctx, state) {
        if (!/^#[0-9a-f]{6}$/i.test(state.tint)) throw new Error("Invalid tint color.");
        const [stone, grass] = await Promise.all([
            Models.getMerged(AssetKey.parse("models", "minecraft:block/stone")),
            Models.getMerged(AssetKey.parse("models", "minecraft:block/grass_block"))
        ]);
        if (!stone || !grass) throw new Error("A block model is missing.");
        const objects: Array<ModelObject | InstanceReference<ModelObject>> = [];
        ctx.onCleanup(() => objects.forEach(object => { object.removeFromScene(); object.dispose(); }));
        for (const x of [-24, 24]) {
            const block = await ctx.renderer.scene.addModel(stone, { instanceMeshes: true, mergeMeshes: true });
            objects.push(block);
            block.setPosition(new Vector3(x, 0, 0));
        }
        objects.push(await ctx.renderer.scene.addModel(grass, { tints: { 0: Number.parseInt(state.tint.slice(1), 16) } }));
        return {
            bounds: new Box3(new Vector3(-32, -12, -12), new Vector3(32, 12, 12)),
            activate() { tint.value = app.state.tint; }
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
note(app.controls, "Two instanced stone blocks and a tinted grass block: instance placements and vertex tints in the 3D formats. Use Export below.");
const tint = input(app.controls, "Grass tint", app.state.tint, "color");
tint.addEventListener("change", () => { void app.update({ tint: tint.value }); });
void app.start();
