import { Instanceable } from "./Instanceable";
import { Euler, Matrix4, Vector3 } from "three";
import { Transformable } from "../Transformable";
import { MineRenderError } from "../error/MineRenderError";
import { Disposable } from "../Disposable";
import { SceneObject } from "../renderer/SceneObject";

export class InstanceReference<T extends Instanceable> implements Transformable, Disposable {

    public readonly isInstanceReference: true = true;

    constructor(readonly instanceable: T, readonly index: number) {
    }

    nextInstance(): InstanceReference<SceneObject> {
        return this.instanceable.nextInstance();
    }

    private get activeInstanceable(): T {
        if (!this.instanceable.isInstanceActive(this.index, this)) throw new MineRenderError("Instance has been removed");
        return this.instanceable;
    }

    removeFromScene(): void {
        if (this.instanceable.isInstanceActive(this.index, this)) this.instanceable.removeInstanceAt(this.index);
    }

    dispose(): void {
        this.removeFromScene();
    }

    getMatrix(matrix?: Matrix4): Matrix4 {
        return this.activeInstanceable.getMatrixAt(this.index, matrix);
    }

    setMatrix(matrix: Matrix4): void {
        this.activeInstanceable.setMatrixAt(this.index, matrix);
    }

    setPositionRotationScale(position?: Vector3, rotation?: Euler, scale?: Vector3): void {
        this.activeInstanceable.setPositionRotationScaleAt(this.index, position, rotation, scale);
    }

    setPosition(position: Vector3): void {
        this.activeInstanceable.setPositionAt(this.index, position);
    }

    getPosition(): Vector3 {
        return this.activeInstanceable.getPositionAt(this.index);
    }

    setRotation(rotation: Euler): void {
        this.activeInstanceable.setRotationAt(this.index, rotation);
    }

    getRotation(): Euler {
        return this.activeInstanceable.getRotationAt(this.index);
    }

    setScale(scale: Vector3): void {
        this.activeInstanceable.setScaleAt(this.index, scale);
    }

    getScale(): Vector3 {
        return this.activeInstanceable.getScaleAt(this.index);
    }

    //TODO: support for custom methods e.g. setting block variants

}

export function isInstanceReference(obj: any): obj is InstanceReference<any> {
    return (<InstanceReference<any>>obj).isInstanceReference;
}
