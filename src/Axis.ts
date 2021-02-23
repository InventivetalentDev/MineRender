import { Vector3 } from "three";

export enum Axis {
    X = "X",
    Y = "y",
    Z = "z"
}

export const AXES = Object.values(Axis);

export function axisToVec3(axis: Axis): Vector3 {
    switch (axis) {
        case Axis.X:
            return new Vector3(1, 0, 0);
        case Axis.Y:
            return new Vector3(0, 1, 0);
        case Axis.Z:
            return new Vector3(0, 0, 1);
    }
}
