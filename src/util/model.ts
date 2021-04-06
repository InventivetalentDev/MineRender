/// https://stackoverflow.com/questions/42812861/three-js-pivot-point/42866733#42866733
// obj - your object (THREE.Object3D or derived)
// point - the point of rotation (THREE.Vector3)
// axis - the axis of rotation (normalized THREE.Vector3)
// theta - radian value of rotation
import { ElementRotation } from "../model/ModelElement";
import { BufferGeometry } from "three/src/core/BufferGeometry";
import { Axis } from "../Axis";
import { toRadians } from "./util";
import { AxesHelper, Box3, BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Matrix4, Mesh, Object3D, Vector3, Vector4 } from "three";

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

export function applyGenericRotation(axis: Axis,  rotation: number, obj: Object3D) {


    // obj.position.sub(new Vector3(8,8,8).add(obj.position))
    //
    // switch (axis) {
    //     case Axis.X:
    //         obj.position.applyAxisAngle(new Vector3(1, 0, 0), toRadians(rotation));
    //         break;
    //     case Axis.Y:
    //         obj.position.applyAxisAngle(new Vector3(0, 1, 0), toRadians(rotation));
    //         break;
    //     case Axis.Z:
    //         obj.position.applyAxisAngle(new Vector3(0, 0, 1), toRadians(rotation));
    //         break;
    // }
    //
    // obj.position.add(new Vector3(8,8,8).add(obj.position))

    switch (axis) {
        case Axis.X:
            obj.rotateOnAxis(new Vector3(1, 0, 0), toRadians(rotation));
            break;
        case Axis.Y:
            obj.rotateOnAxis(new Vector3(0, 1, 0), toRadians(rotation));
            break;
        case Axis.Z:
            obj.rotateOnAxis(new Vector3(0, 0, 1), toRadians(rotation));
            break;
    }

    // subtract origin
    // obj.translateX(-8);
    // obj.translateZ(-8);
    // obj.translateY(-8);
    // // apply rotation
    // switch (axis) {
    //     case Axis.X:
    //         obj.rotateX(toRadians(rotation));
    //         // matrix.makeRotationX(toRadians(rotation));
    //         break;
    //     case Axis.Y:
    //         obj.rotateY(toRadians(rotation));
    //         // matrix.makeRotationY(toRadians(rotation));
    //         break;
    //     case Axis.Z:
    //         obj.rotateZ(toRadians(rotation));
    //         // matrix.makeRotationZ(toRadians(rotation));
    //         break;
    // }
    // // add back origin
    // obj.translateX(8);
    // obj.translateZ(8);
    // obj.translateY(8);

    // obj.applyMatrix4(matrix);
}

export function addBox3WireframeToObject(box: Box3, obj: Object3D, color: number = 0xffffff, w: number = 2) {
    let size = new Vector3();
    box.getSize(size);

    let boxGeo = new BoxGeometry(size.x, size.y, size.z, 1, 1, 1);
    // boxGeo.translate(box.min.x, box.min.y, box.min.z);
    let wireGeo = new EdgesGeometry(boxGeo);
    let wireMat = new LineBasicMaterial({ color: color, linewidth: w, })
    let wireframe = new LineSegments(wireGeo, wireMat);
    obj.add(wireframe);

    let axes = new AxesHelper(1);
    obj.add(axes);
}


export function addWireframeToObject(obj: Object3D, color: number = 0xffffff, w: number = 2) {
    let boxGeo = new BoxGeometry(16, 16, 16, 1, 1, 1);
    let wireGeo = new EdgesGeometry(boxGeo);
    let wireMat = new LineBasicMaterial({ color: color, linewidth: w, })
    let wireframe = new LineSegments(wireGeo, wireMat);
    obj.add(wireframe);

    let axes = new AxesHelper(1);
    obj.add(axes);
}

export function addWireframeToMesh(geo: BufferGeometry, mesh: Mesh, color: number = 0xffffff, w: number = 2) {
    let wireGeo = new EdgesGeometry(geo);
    let wireMat = new LineBasicMaterial({ color: color, linewidth: w, })
    let wireframe = new LineSegments(wireGeo, wireMat);
    mesh.add(wireframe);

    let axes = new AxesHelper(1);
    mesh.add(axes);
}
