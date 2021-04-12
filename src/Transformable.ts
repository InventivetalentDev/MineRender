import { Euler, Vector3 } from "three";

export interface Transformable {

    setPosition(position: Vector3): void;

    setRotation(rotation: Euler): void;

    setScale(scale: Vector3): void;

}
