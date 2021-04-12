import { Instanceable } from "./Instanceable";
import { Euler, Matrix4, Vector3 } from "three";
import { Transformable } from "../Transformable";

export class InstanceReference<T extends Instanceable> implements Transformable {

    public readonly isInstanceReference: true = true;

    constructor(readonly instanceable: T, readonly index: number) {
    }

    nextInstance(): InstanceReference<T> {
        return this.instanceable.nextInstance();
    }

    getMatrix(matrix?: Matrix4): Matrix4 {
        return this.instanceable.getMatrixAt(this.index, matrix);
    }

    setMatrix(matrix: Matrix4): void {
        this.instanceable.setMatrixAt(this.index, matrix);
    }

    setPositionRotationScale(position?: Vector3, rotation?: Euler, scale?: Vector3): void {
        this.instanceable.setPositionRotationScaleAt(this.index, position, rotation, scale);
    }

    setPosition(position: Vector3): void {
        this.instanceable.setPositionAt(this.index, position);
    }

    setRotation(rotation: Euler): void {
        this.instanceable.setRotationAt(this.index, rotation);
    }

    setScale(scale: Vector3): void {
        this.instanceable.setScaleAt(this.index, scale);
    }

}

export function isInstanceReference(obj: any): obj is InstanceReference<any> {
    return (<InstanceReference<any>>obj).isInstanceReference;
}
