import test from "ava";
import { Object3D } from "three";
import { MineRenderScene } from "../src/renderer/MineRenderScene";

test("an added listener that throws leaves the attached object registered", t => {
    const scene = new MineRenderScene();
    const object = new Object3D();
    const error = new Error("added listener failed");
    object.addEventListener("added", () => { throw error; });

    t.throws(() => scene.add(object), { is: error });
    t.is(object.parent, scene);
    t.is(scene.stats.objectCount, 1);
    scene.dirty = false;
    object.dispatchEvent({ type: "change" });
    t.true(scene.dirty);

    scene.remove(object);
    t.is(scene.stats.objectCount, 0);
});
