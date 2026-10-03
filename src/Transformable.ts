import { Euler, Vector3 } from "three";

export interface Transformable {

    setPositionRotationScale(position?: Vector3, rotation?: Euler, scale?: Vector3): void;

    setPosition(position: Vector3): void;

    getPosition(): Vector3;

    setRotation(rotation: Euler): void;

    getRotation(): Euler;

    setScale(scale: Vector3): void;

    getScale(): Vector3;

}

export function isTransformable(obj: any): obj is Transformable {
    return "setPosition" in obj && "setRotation" in obj && "setScale" in obj;
}
