import test from "ava";
import { BufferGeometry, Vector3 } from "three";
import { Axis } from "../src/Axis";
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

for (const axis of [Axis.X, Axis.Y, Axis.Z]) {
    test(`${axis}-axis element rescaling preserves the pivot and rotation-axis length`, t => {
        for (const angle of [-45, -22.5, 22.5, 45]) {
            for (const rescale of [false, true]) {
                const rotation: ElementRotation = { origin: [8, 8, 8], axis, angle, rescale };
                const radians = angle * Math.PI / 180;
                const scale = rescale ? 1 / Math.cos(radians) : 1;
                const cosine = 3 * Math.cos(radians) * scale;
                const sine = 3 * Math.sin(radians) * scale;
                const points = {
                    [Axis.X]: new Vector3(10, 11, 8),
                    [Axis.Y]: new Vector3(8, 10, 11),
                    [Axis.Z]: new Vector3(11, 8, 10)
                };
                const expected = {
                    [Axis.X]: new Vector3(10, 8 + cosine, 8 + sine),
                    [Axis.Y]: new Vector3(8 + sine, 10, 8 + cosine),
                    [Axis.Z]: new Vector3(8 + cosine, 8 + sine, 10)
                };
                const geometry = new BufferGeometry().setFromPoints([new Vector3(8, 8, 8), points[axis]]);

                applyElementRotation(rotation, geometry);

                const position = geometry.getAttribute("position");
                t.deepEqual(new Vector3().fromBufferAttribute(position, 0).toArray(), [8, 8, 8]);
                t.true(new Vector3().fromBufferAttribute(position, 1).distanceTo(expected[axis]) < 1e-6,
                    `${angle} degrees, rescale=${rescale}`);
            }
        }
    });
}
