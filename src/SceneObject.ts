import { BoxGeometry, Color, EdgesGeometry, Euler, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from "three";
import { ModelElement, ModelFaces } from "./model/ModelElement";
import { Geometries } from "./Geometries";
import { UVMapper } from "./UVMapper";
import { DoubleArray, TripleArray } from "./model/Model";
import { Axis, axisToVec3 } from "./Axis";
import { BufferGeometry } from "three/src/core/BufferGeometry";
import { Material } from "three/src/materials/Material";
import { SkinPart } from "./renderers/skin/SkinPart";
import { Maybe } from "./util/util";
import { InstanceReference } from "./InstanceReference";
import { MineRenderError } from "./error/MineRenderError";
import { isInstancedMesh, isMesh } from "./util/three";

export class SceneObject extends Object3D {

    private materialCallbacks: { [key: string]: Array<(mat: Material, key: string) => void>; } = {};

    protected isInstanced: boolean = false;
    protected instanceCounter: number = 0;

    constructor() {
        super();
    }

    //<editor-fold desc="GROUPS">

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

    //</editor-fold>

    //<editor-fold desc="MESHES">

    protected createAndAddMesh(name?: string, group?: Object3D, geometry?: BufferGeometry, material?: Material | Material[], offsetAxis?: Axis, offset: number = 0): Mesh {
        const mesh = this.createMesh(name, geometry, material, offsetAxis, offset);
        if (group) {
            group.add(mesh);
        } else {
            this.add(mesh);
        }
        return mesh;
    }

    protected createMesh(name?: string, geometry?: BufferGeometry, material?: Material | Material[], offsetAxis?: Axis, offset: number = 0): Mesh {
        const mesh = new Mesh(geometry, material);
        if (name) {
            mesh.name = `mesh:${ name }`;
        }
        if (offsetAxis) {
            mesh.translateOnAxis(axisToVec3(offsetAxis), offset);
        }
        return mesh;
    }

    protected createInstancedMesh(name: Maybe<string>, geometry: BufferGeometry, material: Material | Material[], count: number): InstancedMesh {
        const mesh = new InstancedMesh(geometry, material, count);
        if (name) {
            mesh.name = `mesh:${ name }`;
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

    public iterateAllMeshes(cb: (mesh: Mesh) => void) {
        this.children.forEach(obj => {
            if ((<Mesh>obj).isMesh) {
                cb(obj as Mesh);
            }
            obj.children.forEach(obj1 => {
                if ((<Mesh>obj1).isMesh) {
                    cb(obj1 as Mesh);
                }
            })
        })
    }

    //</editor-fold>

    //<editor-fold desc="GEOMETRIES">

    protected _getBoxGeometryFromDimensions([width, height, depth]: TripleArray, faces: ModelFaces, originalTextureSize: DoubleArray, actualTextureSize: DoubleArray): BoxGeometry {
        const uv = UVMapper.facesToUvArray(faces, originalTextureSize, actualTextureSize);
        return Geometries.getBox({
            width,
            height,
            depth,
            uv
        });
    }

    protected _getBoxGeometryFromElement(element: ModelElement): BoxGeometry {
        const width = element.to[0] - element.from[0];
        const height = element.to[1] - element.from[1];
        const depth = element.to[2] - element.from[2];

        const uv = element.mappedUv;

        return Geometries.getBox({
            width,
            height,
            depth,
            uv
        });
    }

    //</editor-fold>

    //<editor-fold desc="INSTANCING">

    nextInstance(): InstanceReference {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const i = this.instanceCounter++;
        this.setMatrixAt(i, new Matrix4());
        return {
            index: i
        }
    }

    getMatrixAt(index: number, matrix: Matrix4 = new Matrix4()): Matrix4 {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const child = this.children[0];
        if (isInstancedMesh(child)) {
            child.getMatrixAt(index, matrix);
        }
        return matrix;
    }

    setMatrixAt(index: number, matrix: Matrix4) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const child = this.children[0];
        if (isInstancedMesh(child)) {
            child.setMatrixAt(index, matrix);
            child.instanceMatrix.needsUpdate = true;
        }
    }

    setPositionRotationScaleAt(index: number, position?: Vector3, rotation?: Euler, scale?: Vector3) {
        const matrix = new Matrix4();
        if (position) {
            matrix.setPosition(position);
        }
        if (rotation) {
            matrix.makeRotationFromEuler(rotation);
        }
        if (scale) {
            matrix.scale(scale);
        }
        this.setMatrixAt(index, matrix);
    }

    setPositionAt(index: number, position: Vector3) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const matrix = this.getMatrixAt(index);
        matrix.setPosition(position);
        this.setMatrixAt(index, matrix);
    }

    setRotationAt(index: number, rotation: Euler) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const matrix = this.getMatrixAt(index);
        matrix.makeRotationFromEuler(rotation);
        this.setMatrixAt(index, matrix);
    }

    setScaleAt(index: number, scale: Vector3) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const matrix = this.getMatrixAt(index);
        matrix.scale(scale);
        this.setMatrixAt(index, matrix);
    }

    //</editor-fold>

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
