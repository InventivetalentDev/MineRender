/// https://stackoverflow.com/questions/42812861/three-js-pivot-point/42866733#42866733
// obj - your object (THREE.Object3D or derived)
// point - the point of rotation (THREE.Vector3)
// axis - the axis of rotation (normalized THREE.Vector3)
// theta - radian value of rotation
import { ElementRotation } from "../model/ModelElement";
import { BufferGeometry } from "three/src/core/BufferGeometry";
import { Axis } from "../Axis";
import { toRadians } from "./util";
import { AxesHelper, Box3, BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Matrix4, Mesh, Object3D, Quaternion, Vector3, Vector4 } from "three";
import { ModelPart } from "../model/ModelPart";

function rotateAboutPoint(obj: THREE.Object3D, point: THREE.Vector3, axis: THREE.Vector3, theta: number) {
    obj.position.sub(point); // remove the offset
    obj.position.applyAxisAngle(axis, theta); // rotate the POSITION
    obj.position.add(point); // re-add the offset

    obj.rotateOnAxis(axis, theta); // rotate the OBJECT
}

export function applyElementRotation(rotation: ElementRotation, geometry: BufferGeometry) {
    const origin = new Vector3(rotation.origin[0], rotation.origin[1], rotation.origin[2]);
    // origin.multiplyScalar(0.0625);


    // let axisVector: Vector3;
    // let inverseAxisVector: Vector3;
    // switch (rotation.axis) {
    //     case Axis.X:
    //         axisVector = new Vector3(1, 0, 0);
    //         inverseAxisVector = new Vector3(0, 1, 1);
    //         break;
    //     case Axis.Y:
    //         axisVector = new Vector3(0, 1, 0);
    //         inverseAxisVector = new Vector3(1, 0, 1);
    //         break;
    //     case Axis.Z:
    //         axisVector = new Vector3(0, 0, 1);
    //         inverseAxisVector = new Vector3(1, 1, 0);
    //         break;
    // }
    // const quat = new Quaternion().setFromAxisAngle(axisVector, (rotation.angle*0.017453292));
    // if (rotation.rescale) {
    //     if (Math.abs(rotation.angle) === 22.5) {
    //         inverseAxisVector.multiplyScalar(1.0 / Math.cos(0.39269909262657166) - 1.0)
    //     }else {
    //         inverseAxisVector.multiplyScalar(1.0 / Math.cos(0.7853981852531433) - 1.0)
    //     }
    //
    //     inverseAxisVector.add(new Vector3(1, 1, 1));
    // }else{
    //     inverseAxisVector.set(1, 1, 1);
    // }

    // Vector4 vec4 = new Vector4(geometry.getAttribute("position").)


    // subtract origin
    geometry.translate(-origin.x, -origin.y, -origin.z);
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


    // if (rotation.rescale) {
    //     console.log("angle", Math.abs(rotation.angle) )
    //     if (Math.abs(rotation.angle) === 22.5) {
    //         const s = 2;
    //         geometry.scale(s, s, s);
    //     }else{
    //         const s = 2;
    //         geometry.scale(s, s, s);
    //     }
    // }
    if (rotation.rescale) {
        //TODO: y height seems a bit too tall (1 pixel)
        if (Math.abs(rotation.angle) === 22.5) {
            const s = 1.0 / Math.cos(0.39269909262657166);
            geometry.scale(s, 1, s);
        }else {
            const s = 1.0 / Math.cos(0.7853981852531433);
            geometry.scale(s, 1, s);
        }
    }

    // add back origin
    geometry.translate(origin.x, origin.y, origin.z);


}

export function applyModelPartRotation(modelPart: ModelPart, geometry: BufferGeometry) {
    const origin = new Vector3(modelPart.pivotX,modelPart.pivotY,modelPart.pivotZ);


    // subtract origin
    geometry.translate(-origin.x, -origin.y, -origin.z);
    // apply rotation
    //TODO: these might be the wrong order
            geometry.rotateX(toRadians(modelPart.pitch));
            geometry.rotateY(toRadians(modelPart.yaw));
            geometry.rotateZ(toRadians(modelPart.roll));


    // add back origin
    geometry.translate(origin.x, origin.y, origin.z);


}

export function applyGenericRotation(axis: Axis, rotation: number, obj: Object3D) {


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
