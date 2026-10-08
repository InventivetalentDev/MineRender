import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { BufferGeometry } from "three";
import type { Model } from "./Model";
import { DisplayPosition } from "./DisplayPosition";
import { toRadians } from "../util/util";

/** Resolves Minecraft display poses and applies them to model geometry. */
export class DisplayTransforms {

    /** Resolve hand fallbacks within one model, before inheriting parent display entries. */
    public static withHandFallbacks(display: Model["display"]): Model["display"] {
        if (!display) return undefined;
        const resolved = { ...display };
        for (const [left, right] of [
            [DisplayPosition.THIRDPERSON_LEFTHAND, DisplayPosition.THIRDPERSON_RIGHTHAND],
            [DisplayPosition.FIRSTPERSON_LEFTHAND, DisplayPosition.FIRSTPERSON_RIGHTHAND]
        ]) {
            if (resolved[left] === undefined && resolved[right] !== undefined) resolved[left] = resolved[right];
        }
        return resolved;
    }

    /** Build a display pose for geometry already centered at the model's [8, 8, 8] pivot. */
    public static getMatrix(display: Model["display"], position: DisplayPosition): Matrix4 {
        const transform = this.withHandFallbacks(display)?.[position] ?? {};
        const left = position === DisplayPosition.FIRSTPERSON_LEFTHAND || position === DisplayPosition.THIRDPERSON_LEFTHAND;
        const sign = left ? -1 : 1;
        const [x, y, z] = transform.rotation ?? [0, 0, 0];
        const rotation = new Quaternion().setFromEuler(new Euler(toRadians(x), sign * toRadians(y), sign * toRadians(z), "XYZ"));
        // MineRender uses model units: vanilla's five-block translation limit is 80 units.
        const translation = new Vector3(...(transform.translation ?? [0, 0, 0])).clampScalar(-80, 80);
        translation.x *= sign;
        const scale = new Vector3(...(transform.scale ?? [1, 1, 1])).clampScalar(-4, 4);
        return new Matrix4().compose(translation, rotation, scale);
    }

    /** Transforms geometry in place and reverses triangle winding when the matrix reflects it. */
    public static apply(geometry: BufferGeometry, matrix: Matrix4): void {
        geometry.applyMatrix4(matrix);
        if (matrix.determinant() < 0) {
            // Baking a reflection into vertices must also reverse winding to retain front faces.
            if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute("position").count }, (_, i) => i));
            const index = geometry.index!;
            for (let i = 0; i < index.count; i += 3) {
                const second = index.getX(i + 1);
                index.setX(i + 1, index.getX(i + 2));
                index.setX(i + 2, second);
            }
            index.needsUpdate = true;
        }
    }

}
