import test, { type ExecutionContext } from "ava";
import { Mesh, MeshBasicMaterial, SRGBColorSpace } from "three";
import { Fonts, type BitmapGlyph } from "../src/assets/Fonts";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";
import { createGuiTextGeometry, layoutGuiText } from "../src/gui/GuiText";
import { MineRenderScene } from "../src/renderer/MineRenderScene";

function fixture(t: ExecutionContext) {
    const get = Fonts.get;
    const image = { width: 64, height: 32 } as CompatCanvas;
    const glyphs = new Map<string, BitmapGlyph>();
    for (const [character, advance] of [["W", 7], ["i", 2], [" ", 4], ["😀", 5]] as const) {
        glyphs.set(character, { image: character === " " ? undefined : image,
            x: 16, y: 8, width: 8, height: 8, scale: 1, ascent: 7, advance });
    }
    Fonts.get = async () => ({ glyphs });
    t.teardown(() => { Fonts.get = get; });
    return { image, glyphs };
}

test.serial("text wraps proportional glyphs across styled runs, explicit newlines, and long words", async t => {
    fixture(t);
    const runs = Object.freeze([
        Object.freeze({ text: "Wi ", color: 0xff5555 }),
        Object.freeze({ text: "Wi", bold: true }),
        Object.freeze({ text: "\nWWWWW" })
    ]);
    const layout = await layoutGuiText(runs, { maxWidth: 20, lineHeight: 12, color: 0x55ffff });
    t.deepEqual(layout.lineWidths, [9, 11, 14, 14, 7]);
    t.deepEqual([layout.width, layout.height], [14, 60]);
    t.deepEqual(layout.glyphs.map(glyph => [glyph.character, glyph.x, glyph.y]), [
        ["W", 0, 0], ["i", 7, 0], ["W", 0, 12], ["i", 8, 12],
        ["W", 0, 24], ["W", 7, 24], ["W", 0, 36], ["W", 7, 36], ["W", 0, 48]
    ]);
    t.deepEqual(layout.glyphs[0].style, { color: 0xff5555, bold: false, italic: false });
    t.deepEqual(layout.glyphs[2].style, { color: 0x55ffff, bold: true, italic: false });
    t.deepEqual((await layoutGuiText("W\r\n\n😀\n")).lineWidths, [7, 0, 5, 0]);
    const narrow = await layoutGuiText("Wii", { maxWidth: 3 });
    t.deepEqual(narrow.lineWidths, [7, 2, 2]);
    t.deepEqual((await layoutGuiText("W ", { maxWidth: 7 })).lineWidths, [7]);
});

test.serial("text geometry keeps bitmap UVs while applying bold, italic, shadow, and sRGB colors", async t => {
    const { image } = fixture(t);
    const layout = await layoutGuiText("W", { bold: true, italic: true, color: 0x80c0ff });
    const batches = createGuiTextGeometry(layout);
    t.teardown(() => batches.forEach(batch => batch.geometry.dispose()));
    t.is(layout.width, 8);
    t.is(batches.length, 2);
    const [shadow, foreground] = batches.map(batch => batch.geometry);
    t.true(batches.every(batch => batch.image === image));
    t.deepEqual(Array.from(foreground.getAttribute("position").array, value => value || 0), [
        1, 0, 0, 9, 0, 0, -1, -8, 0, 7, -8, 0,
        2, 0, 0, 10, 0, 0, 0, -8, 0, 8, -8, 0
    ]);
    const frontPosition = foreground.getAttribute("position"), shadowPosition = shadow.getAttribute("position");
    for (let index = 0; index < frontPosition.count; index++) {
        t.is(shadowPosition.getX(index), frontPosition.getX(index) + 1);
        t.is(shadowPosition.getY(index), frontPosition.getY(index) - 1);
    }
    t.deepEqual(Array.from(foreground.getAttribute("uv").array), [
        0.25, 0.75, 0.375, 0.75, 0.25, 0.5, 0.375, 0.5,
        0.25, 0.75, 0.375, 0.75, 0.25, 0.5, 0.375, 0.5
    ]);
    const foregroundColor = foreground.getAttribute("color"), shadowColor = shadow.getAttribute("color");
    for (const [actual, expected] of [
        [foregroundColor.getX(0), 0.2158605], [foregroundColor.getY(0), 0.5271151], [foregroundColor.getZ(0), 1],
        [shadowColor.getX(0), 0.0144438], [shadowColor.getY(0), 0.0295568], [shadowColor.getZ(0), 0.0497066]
    ]) t.true(Math.abs(actual - expected) < 0.000001);
    t.is(foreground.index!.count, 12);
    const unshadowed = createGuiTextGeometry(layout, false);
    t.is(unshadowed.length, 1);
    unshadowed.forEach(batch => batch.geometry.dispose());
});

test.serial("GUI text bounds include styled overhang and disposal releases only the object's render resources", async t => {
    const { image, glyphs } = fixture(t);
    const scene = new MineRenderScene();
    const gui = await scene.addGui([
        { name: "styled", text: "W", italic: true, position: [10, 20], size: [14, 18] },
        { name: "plain", text: "W", position: [40, 20] }
    ]);
    const other = await scene.addGui([{ name: "other", text: "W" }]);
    t.teardown(() => { gui.dispose(); other.dispose(); });
    t.deepEqual([gui.bounds.min.toArray(), gui.bounds.max.toArray()], [[8, 20], [49, 38]]);
    const styled = gui.getGroupByName("styled")!, plain = gui.getGroupByName("plain")!;
    t.deepEqual(styled.scale.toArray(), [2, 2, 1]);
    const meshes = [...styled.children, ...plain.children] as Mesh[];
    const material = meshes[0].material as MeshBasicMaterial;
    t.true(meshes.every(mesh => mesh.material === material));
    t.true(meshes.every((mesh, index) => index === 0 || mesh.renderOrder > meshes[index - 1].renderOrder));
    t.true(material.vertexColors && material.transparent);
    t.false(material.depthWrite || material.toneMapped);
    t.is(material.map!.colorSpace, SRGBColorSpace);
    t.is(material.map!.image, image);
    const otherMaterial = (other.getGroupByName("other")!.children[0] as Mesh).material as MeshBasicMaterial;
    t.not(material, otherMaterial);
    t.not(material.map, otherMaterial.map);
    t.is(otherMaterial.map!.image, image);
    let geometryDisposals = 0, materialDisposals = 0, textureDisposals = 0, otherDisposals = 0;
    meshes.forEach(mesh => mesh.geometry.addEventListener("dispose", () => geometryDisposals++));
    material.addEventListener("dispose", () => materialDisposals++);
    material.map!.addEventListener("dispose", () => textureDisposals++);
    otherMaterial.addEventListener("dispose", () => otherDisposals++);
    otherMaterial.map!.addEventListener("dispose", () => otherDisposals++);
    scene.dirty = false;
    gui.dispose(); gui.dispose();
    t.true(scene.dirty);
    t.deepEqual([geometryDisposals, materialDisposals, textureDisposals, otherDisposals], [4, 1, 1, 0]);
    t.true(gui.bounds.isEmpty());
    t.is(gui.children.length, 0);
    t.is(glyphs.get("W")!.image, image);
    t.is(other.getGroupByName("other")!.children.length, 2);
});
