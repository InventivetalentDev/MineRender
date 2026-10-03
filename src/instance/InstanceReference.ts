import { Instanceable } from "./Instanceable";
import { Euler, Matrix4, Vector3 } from "three";
import { Transformable } from "../Transformable";
import { SceneObject } from "../renderer/SceneObject";

export class InstanceReference<T extends Instanceable> implements Transformable {

    public readonly isInstanceReference: true = true;

    constructor(readonly instanceable: T, readonly index: number) {
    }

    nextInstance(): InstanceReference<SceneObject> {
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
        // console.log("InstanceReference#setPosition",position)
        this.instanceable.setPositionAt(this.index, position);
    }

    getPosition(): Vector3 {
        return this.instanceable.getPositionAt(this.index);
    }

    setRotation(rotation: Euler): void {
        // console.log("InstanceReference#setRotation",rotation)
        this.instanceable.setRotationAt(this.index, rotation);
    }

    getRotation(): Euler {
        // console.log("InstanceReference#getRotation")
        return this.instanceable.getRotationAt(this.index);
    }

    setScale(scale: Vector3): void {
        this.instanceable.setScaleAt(this.index, scale);
    }

    getScale(): Vector3 {
        return this.instanceable.getScaleAt(this.index);
    }

    //TODO: support for custom methods e.g. setting block variants

}

export function isInstanceReference(obj: any): obj is InstanceReference<any> {
    return (<InstanceReference<any>>obj).isInstanceReference;
}
