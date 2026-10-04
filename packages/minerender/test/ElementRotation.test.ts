import test from "ava";
import { BufferGeometry, Vector3 } from "three";
import type { ElementRotation } from "../src/model/ModelElement";
import { applyElementRotation } from "../src/util/model";

test("JSON x-axis element rotations rotate geometry around their origin", t => {
    const rotation: ElementRotation = JSON.parse('{"origin":[8,8,8],"axis":"x","angle":45}');
    const geometry = new BufferGeometry().setFromPoints([new Vector3(8, 10, 8)]);

    applyElementRotation(rotation, geometry);

    const actual = new Vector3().fromBufferAttribute(geometry.getAttribute("position"), 0);
    const expected = new Vector3(8, 8 + Math.SQRT2, 8 + Math.SQRT2);
    t.true(actual.distanceTo(expected) < 1e-6);
});
