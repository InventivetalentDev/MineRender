/// https://stackoverflow.com/questions/42812861/three-js-pivot-point/42866733#42866733
// obj - your object (THREE.Object3D or derived)
// point - the point of rotation (THREE.Vector3)
// axis - the axis of rotation (normalized THREE.Vector3)
// theta - radian value of rotation
import { ElementRotation } from "../model/ModelElement";
import { BufferGeometry } from "three/src/core/BufferGeometry";
import { Axis } from "../Axis";
import { toRadians } from "./util";
import { EdgesGeometry, LineBasicMaterial, LineSegments, Mesh } from "three";

function rotateAboutPoint(obj: THREE.Object3D, point: THREE.Vector3, axis: THREE.Vector3, theta: number) {
    obj.position.sub(point); // remove the offset
    obj.position.applyAxisAngle(axis, theta); // rotate the POSITION
    obj.position.add(point); // re-add the offset

    obj.rotateOnAxis(axis, theta); // rotate the OBJECT
}

export function applyElementRotation(rotation: ElementRotation, geometry: BufferGeometry) {
    // subtract origin
    geometry.translate(-rotation.origin[0], -rotation.origin[1], -rotation.origin[2]);
    // apply rotation
    switch (rotation.axis) {
        case Axis.X:
            geometry.rotateX(toRadians(rotation.angle));
            break;
        case Axis.Y:
            geometry.rotateY(toRadians(rotation.angle));
            break;
        case Axis.Z:
            geometry.rotateZ(toRadians(rotation.angle));
            break;
    }
    // add back origin
    geometry.translate(rotation.origin[0], rotation.origin[1], rotation.origin[2]);
}


export function addWireframeToMesh(geo: BufferGeometry, mesh: Mesh) {
    let wireGeo = new EdgesGeometry(geo);
    let wireMat = new LineBasicMaterial({ color: 0xffffff, linewidth: 2, })
    let wireframe = new LineSegments(wireGeo, wireMat);
    mesh.add(wireframe);
}
