import { InstancedMesh, Mesh, Object3D, OrthographicCamera, PerspectiveCamera } from "three";
import { SceneObject } from "../renderer/SceneObject";

export function isObject3D(obj: any): obj is Object3D {
    return (<Object3D> obj).isObject3D;
}

export function isMesh(obj: any): obj is Mesh {
    return (<Mesh> obj).isMesh;
}

export function isInstancedMesh(obj: any): obj is InstancedMesh {
    return (<InstancedMesh> obj).isInstancedMesh;
}

export function isPerspectiveCamera(obj: any): obj is PerspectiveCamera {
    return (<PerspectiveCamera>obj).isPerspectiveCamera;
}

export function isOrthographicCamera(obj: any): obj is OrthographicCamera {
    return (<OrthographicCamera>obj).isOrthographicCamera;
}
