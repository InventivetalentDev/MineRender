import { BoxGeometry, Mesh, Object3D, Vector3 } from "three";
import { ModelElement, ModelFaces } from "./model/ModelElement";
import { Geometries } from "./Geometries";
import { UVMapper } from "./UVMapper";
import { DoubleArray, TripleArray } from "./model/Model";
import { Axis, axisToVec3 } from "./Axis";
import { BufferGeometry } from "three/src/core/BufferGeometry";
import { Material } from "three/src/materials/Material";
import { SkinPart } from "./renderers/skin/SkinPart";
import { Maybe } from "./util";

export class SceneObject extends Object3D {


    constructor() {
        super();
    }

    /// GROUPS

    protected createAndAddGroup(name?: string, x: number = 0, y: number = 0, z: number = 0, offsetAxis?: Axis, offset: number = 0): Object3D {
        const group = this.createGroup(name, x, y, z, offsetAxis, offset);
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

    /**
     * Get a group by its name
     */
    public getGroupByName(name: string): Maybe<Object3D> {
        return this.getObjectByName(`group:${ name }`) as Object3D;
    }

    /**
     * Toggle visibility of a group
     * @param name name of the group
     * @param visible set the visibility directly, if not set toggles it
     */
    public toggleGroupVisibility(name: string, visible?: boolean): boolean {
        return this.toggleObjectVisibility(this.getGroupByName(name), visible);
    }

    /// MESHES

    protected createAndAddMesh(name?: string, group?: Object3D, geometry?: BufferGeometry, material?: Material | Material[],offsetAxis?: Axis, offset: number = 0): Mesh {
        const mesh = this.createMesh(name, geometry, material,offsetAxis,offset);
        if (group) {
            group.add(mesh);
        } else {
            this.add(mesh);
        }
        return mesh;
    }

    protected createMesh(name?: string, geometry?: BufferGeometry, material?: Material | Material[],offsetAxis?: Axis, offset: number = 0): Mesh {
        const mesh = new Mesh(geometry, material);
        if (name) {
            mesh.name = `mesh:${ name }`;
        }
        if (offsetAxis) {
            mesh.translateOnAxis(axisToVec3(offsetAxis), offset);
        }
        return mesh;
    }

    /**
     * Get a mesh by its name
     */
    public getMeshByName(name: string): Maybe<Mesh> {
        return this.getObjectByName(`mesh:${ name }`) as Mesh;
    }

    /**
     * Toggle visibility of a mesh
     * @param name name of the mesh
     * @param visible set the visibility directly, if not set toggles it
     */
    public toggleMeshVisibility(name: string, visible?: boolean): boolean {
        return this.toggleObjectVisibility(this.getMeshByName(name), visible);
    }

    /// GEOMETRIES

    protected _getBoxGeometryFromDimensions([width, height, depth]: TripleArray, faces: ModelFaces, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray): BoxGeometry {
        const uv = UVMapper.facesToUvArray(faces, originalTextureSize, actualTextureSize);
        return Geometries.getBox({
            width,
            height,
            depth,
            uv
        });
    }

    protected _getBoxGeometryFromElement(model: ModelElement, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray): BoxGeometry {
        const width = model.to[0] - model.from[0];
        const height = model.to[1] - model.from[1];
        const depth = model.to[2] - model.from[1];

        const uv = UVMapper.facesToUvArray(model.faces, originalTextureSize, actualTextureSize);

        return Geometries.getBox({
            width,
            height,
            depth,
            uv
        });
    }

    ////

    protected toggleObjectVisibility(object?: Object3D, visible?: boolean): boolean {
        if (object) {
            if (typeof visible !== "undefined") {
                object.visible = visible;
            } else {
                object.visible = !object.visible;
            }
            return object.visible;
        }
        return false;
    }

}
