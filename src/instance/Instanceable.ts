import { InstanceReference } from "./InstanceReference";
import { MineRenderError } from "../error/MineRenderError";
import { Euler, Matrix4, Vector3 } from "three";
import { isInstancedMesh } from "../util/three";

export interface Instanceable {

    nextInstance(): InstanceReference<this>;

    getMatrixAt(index: number, matrix?: Matrix4): Matrix4;

    setMatrixAt(index: number, matrix: Matrix4): void;

    setPositionRotationScaleAt(index: number, position?: Vector3, rotation?: Euler, scale?: Vector3): void;

    setPositionAt(index: number, position: Vector3): void;

    getPositionAt(index: number, vector?: Vector3): Vector3;

    setRotationAt(index: number, rotation: Euler): void;

    getRotationAt(index: number, euler?: Euler): Euler;

    setScaleAt(index: number, scale: Vector3): void;

    getScaleAt(index: number, vector?: Vector3): Vector3;

}

export function isInstanceable(obj: any): obj is Instanceable {
    return 'nextInstance' in obj;
}
