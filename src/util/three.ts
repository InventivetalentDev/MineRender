import { InstancedMesh, Mesh, Object3D } from "three";

export function isObject3D(obj: any): obj is Object3D {
    return (<Object3D> obj).isObject3D;
}

export function isMesh(obj: any): obj is Mesh {
    return (<Mesh> obj).isMesh;
}

export function isInstancedMesh(obj: any): obj is InstancedMesh {
    return (<InstancedMesh> obj).isInstancedMesh;
}
