import { BoxGeometry, Object3D, Vector3 } from "three";
import { ModelElement, ModelFaces } from "./model/ModelElement";
import { Geometries } from "./Geometries";
import { UVMapper } from "./UVMapper";
import { TripleArray } from "./model/Model";
import { Axis, axisToVec3 } from "./Axis";

export class SceneObject extends Object3D {

    constructor() {
        super();
    }

    protected createAndAddGroup(name?: string, x: number = 0, y: number = 0, z: number = 0, offsetAxis?: Axis, offset: number = 0): Object3D {
        const group =  this.createGroup(name, x, y, z, offsetAxis, offset);
        this.add(group);
        return group;
    }

    protected createGroup(name?: string, x: number = 0, y: number = 0, z: number = 0, offsetAxis?: Axis, offset: number = 0): Object3D {
        const obj = new Object3D();
        if (name) {
            obj.name = `group:${ name }`;
        }
        if (x > 0 || y > 0 || z > 0) {
            obj.position.set(x, y, z);
        }
        if (offsetAxis) {
            obj.translateOnAxis(axisToVec3(offsetAxis), offset);
        }
        return obj;
    }

    protected _getBoxGeometryFromDimensions([width, height, depth]: TripleArray, faces: ModelFaces, textureWidth: number, textureHeight: number): BoxGeometry {
        const uv = UVMapper.facesToUvArray(faces, textureWidth, textureHeight);
        return Geometries.getBox({
            width,
            height,
            depth,
            uv
        });
    }

    protected _getBoxGeometryFromElement(model: ModelElement, textureWidth: number, textureHeight: number): BoxGeometry {
        const width = model.to[0] - model.from[0];
        const height = model.to[1] - model.from[1];
        const depth = model.to[2] - model.from[1];

        const uv = UVMapper.facesToUvArray(model.faces, textureWidth, textureHeight);

        return Geometries.getBox({
            width,
            height,
            depth,
            uv
        });
    }

}
