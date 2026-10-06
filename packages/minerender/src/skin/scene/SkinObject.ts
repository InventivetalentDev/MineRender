import { SceneObject } from "../../renderer/SceneObject";
import { BoxGeometry, Material } from "three";
import { SKIN_PARTS, SkinPart } from "../SkinPart";
import { classicSkinTextureCoordinates, SkinTextureCoordinates, slimSkinTextureCoordinates } from "../SkinTextureCoordinates";
import { classicSkinGeometries, SkinGeometries, slimSkinGeometries } from "../SkinGeometries";
import { Axis } from "../../Axis";
import { Materials } from "../../Materials";
import merge from "ts-deepmerge";
import { SceneObjectOptions } from "../../renderer/SceneObjectOptions";
import { DeepPartial, toRadians } from "../../util/util";
import { SkinTextures } from "../SkinTextures";

export class SkinObject extends SceneObject {

    public readonly options: SkinObjectOptions;

    private slim: boolean = false;
    private detectedSlim: boolean = false;
    private skinTextureSrc?: string;
    private skinMaterial?: Material;
    private skinLoad: number = 0;

    private capeLoad: number = 0;


    constructor(options?: DeepPartial<SkinObjectOptions>) {
        super();
        this.options = merge({}, SceneObject.DEFAULT_OPTIONS, options ?? {});
        this.slim = this.options.slim ?? false;
    }

    async init(): Promise<void> {
        this.createMeshes();
    }

    protected removeMeshes(): void {

    }

    protected createMeshes() {
        console.log("#createMeshes")
        const mat = this.skinMaterial ?? Materials.MISSING_TEXTURE;

        {
            const headGroup = this.createAndAddGroup("head", 0, 28, 0, Axis.Y, -4);

            const headGeo = this.getBoxGeometry(SkinPart.HEAD);
            const head = this.createAndAddMesh("head", headGroup, headGeo, mat, Axis.Y, 4);

            const hatGeo = this.getBoxGeometry(SkinPart.HAT);
            const hat = this.createAndAddMesh("hat", headGroup, hatGeo, mat, Axis.Y, 4);
        }

        {
            const bodyGroup = this.createAndAddGroup("body", 0, 18, 0);

            const bodyGeo = this.getBoxGeometry(SkinPart.BODY);
            const body = this.createAndAddMesh("body", bodyGroup, bodyGeo, mat);

            const jacketGeo = this.getBoxGeometry(SkinPart.JACKET);
            const jacket = this.createAndAddMesh("jacket", bodyGroup, jacketGeo, mat);
        }

        {
            {
                const leftArmGroup = this.createAndAddGroup("leftArm", this.slim ? -5.5 : -6, 18, 0, Axis.Y, 4);

                const leftArmGeo = this.getBoxGeometry(SkinPart.LEFT_ARM);
                const leftArm = this.createAndAddMesh("leftArm", leftArmGroup, leftArmGeo, mat, Axis.Y, -4);

                const leftSleeveGeo = this.getBoxGeometry(SkinPart.LEFT_SLEEVE);
                const leftSleeve = this.createAndAddMesh("leftSleeve", leftArmGroup, leftSleeveGeo, mat, Axis.Y, -4);
            }
            {
                const rightArmGroup = this.createAndAddGroup("rightArm", this.slim ? 5.5 : 6, 18, 0, Axis.Y, 4);

                const rightArmGeo = this.getBoxGeometry(SkinPart.RIGHT_ARM);
                const rightArm = this.createAndAddMesh("rightArm", rightArmGroup, rightArmGeo, mat, Axis.Y, -4);

                const rightSleeveGeo = this.getBoxGeometry(SkinPart.RIGHT_SLEEVE);
                const rightSleeve = this.createAndAddMesh("rightSleeve", rightArmGroup, rightSleeveGeo, mat, Axis.Y, -4);
            }
        }

        {
            {
                const leftLegGroup = this.createAndAddGroup("leftLeg", -2, 6, 0, Axis.Y, 4);

                const leftLegGeo = this.getBoxGeometry(SkinPart.LEFT_LEG);
                const leftLeg = this.createAndAddMesh("leftLeg", leftLegGroup, leftLegGeo, mat, Axis.Y, -4);

                const leftTrousersGeo = this.getBoxGeometry(SkinPart.LEFT_TROUSERS);
                const leftTrousers = this.createAndAddMesh("leftTrousers", leftLegGroup, leftTrousersGeo, mat, Axis.Y, -4);
            }
            {
                const rightLegGroup = this.createAndAddGroup("rightLeg", 2, 6, 0, Axis.Y, 4);

                const rightLegGeo = this.getBoxGeometry(SkinPart.RIGHT_LEG);
                const rightLeg = this.createAndAddMesh("rightLeg", rightLegGroup, rightLegGeo, mat, Axis.Y, -4);

                const rightTrousersGeo = this.getBoxGeometry(SkinPart.RIGHT_TROUSERS);
                const rightTrousers = this.createAndAddMesh("rightTrousers", rightLegGroup, rightTrousersGeo, mat, Axis.Y, -4);
            }
        }

        console.log("#createMeshes done")

    }


    public async setSkinTexture(src: string): Promise<void> {
        if (typeof src === "undefined") return;
        this.skinTextureSrc = src;
        const load = ++this.skinLoad;
        const texture = await SkinTextures.get(src, this.options.legacy);
        if (load !== this.skinLoad) return;

        this.skinMaterial = texture.material;
        this.detectedSlim = texture.slim;
        this.updateSlim(this.options.slim ?? this.detectedSlim);
        for (const part of SKIN_PARTS) {
            if (part === SkinPart.CAPE) continue;
            const mesh = this.getMeshByName(part);
            if (mesh) {
                mesh.material = texture.material;
            }
        }
        this.notifyDirty();
    }

    /** Load a vanilla cape texture, or pass undefined to remove the cape. */
    public async setCapeTexture(src?: string): Promise<void> {
        const load = ++this.capeLoad;
        if (src === undefined) {
            const group = this.getGroupByName(SkinPart.CAPE);
            if (group) this.remove(group);
            this.notifyDirty();
            return;
        }

        const material = await SkinTextures.getCape(src);
        if (load !== this.capeLoad) return;
        const mesh = this.getMeshByName(SkinPart.CAPE);
        if (mesh) {
            mesh.material = material;
        } else {
            const group = this.createAndAddGroup(SkinPart.CAPE, 0, 24, 2);
            group.rotation.set(toRadians(-6), Math.PI, 0);
            const geometry = this._getBoxGeometryFromDimensions(
                classicSkinGeometries.cape, classicSkinTextureCoordinates.cape, [64, 32], [64, 32]);
            const cape = this.createAndAddMesh(SkinPart.CAPE, group, geometry, material);
            cape.position.set(0, -8, -0.5);
        }
        this.notifyDirty();
    }

    /** Select the arm model, or pass undefined to use texture detection. */
    public setSlim(slim?: boolean): void {
        this.options.slim = slim;
        this.updateSlim(slim ?? this.detectedSlim);
    }

    private updateSlim(slim: boolean): void {
        if (slim === this.slim) return;
        this.slim = slim;

        for (const part of [SkinPart.LEFT_ARM, SkinPart.LEFT_SLEEVE, SkinPart.RIGHT_ARM, SkinPart.RIGHT_SLEEVE]) {
            const mesh = this.getMeshByName(part);
            if (mesh) mesh.geometry = this.getBoxGeometry(part);
        }

        const offset = slim ? 0.5 : -0.5;
        const leftArm = this.getGroupByName(SkinPart.LEFT_ARM);
        const rightArm = this.getGroupByName(SkinPart.RIGHT_ARM);
        if (leftArm) leftArm.position.x += offset;
        if (rightArm) rightArm.position.x -= offset;
        this.notifyDirty();
    }

    /** Select the texture layout, or pass undefined to detect it from image dimensions. */
    public async setLegacy(legacy?: boolean): Promise<void> {
        if (legacy === this.options.legacy) return;
        this.options.legacy = legacy;
        if (this.skinTextureSrc) await this.setSkinTexture(this.skinTextureSrc);
    }

    public dispose(): void {
        this.skinLoad++;
        this.capeLoad++;
        super.dispose();
    }

    //TODO: layer toggles


    protected getBoxGeometry(part: SkinPart): BoxGeometry {
        console.log("slim", this.slim)
        const coordinates: SkinTextureCoordinates = this.slim ? slimSkinTextureCoordinates : classicSkinTextureCoordinates;
        const geometries: SkinGeometries = this.slim ? slimSkinGeometries : classicSkinGeometries;
        return this._getBoxGeometryFromDimensions(geometries[part], coordinates[part], [64, 64], [64, 64]);
    }


}

export interface SkinObjectOptions extends SceneObjectOptions {
    slim?: boolean;
    legacy?: boolean;
}
