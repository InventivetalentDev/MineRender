import { Intersection, Matrix3, Matrix4, Mesh, Object3D, Raycaster, Vector3 } from "three";
import { isInstancedMesh, isMesh } from "../../util/three";

/** Collects visible meshes attached to the scene on the raycaster's layers. */
export function pickableMeshes(root: Object3D, scene: Object3D, raycaster: Raycaster): Mesh[] {
    const result: Mesh[] = [];
    let attached = false;
    for (let parent: Object3D | null = root; parent; parent = parent.parent) {
        if (!parent.visible) return result;
        if (parent === scene) attached = true;
    }
    if (!attached) return result;
    root.updateWorldMatrix(true, true);
    root.traverseVisible(object => {
        if (isMesh(object) && raycaster.layers.test(object.layers)) result.push(object);
    });
    return result;
}

/** Returns nearest-first hits with a face and visible material. */
export function visibleHits(raycaster: Raycaster, meshes: Mesh[]): Intersection[] {
    return raycaster.intersectObjects(meshes, false).filter(hit => {
        if (!hit.face) return false;
        const mesh = hit.object as Mesh;
        const material = Array.isArray(mesh.material) ? mesh.material[hit.face.materialIndex] : mesh.material;
        return material?.visible;
    });
}

/** Returns the face normal in scene space, including any instance transform. */
export function hitNormal(hit: Intersection): Vector3 {
    const mesh = hit.object as Mesh;
    const matrix = mesh.matrixWorld.clone();
    if (isInstancedMesh(mesh) && hit.instanceId !== undefined) {
        const instance = new Matrix4();
        mesh.getMatrixAt(hit.instanceId, instance);
        matrix.multiply(instance);
    }
    return hit.face!.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(matrix));
}
