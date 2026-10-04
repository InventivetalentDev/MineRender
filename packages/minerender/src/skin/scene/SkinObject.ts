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
import { CapeLayout, capeTextureSizes } from "../CapeLayout";

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
        const cape = this.getGroupByName(SkinPart.CAPE);
        this.createMeshes();
        if (cape) this.getGroupByName(SkinPart.BODY)!.attach(cape);
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
            const bodyGroup = this.createAndAddGroup("body", 0, 24, 0);

            const bodyGeo = this.getBoxGeometry(SkinPart.BODY);
            const body = this.createAndAddMesh("body", bodyGroup, bodyGeo, mat, Axis.Y, -6);

            const jacketGeo = this.getBoxGeometry(SkinPart.JACKET);
            const jacket = this.createAndAddMesh("jacket", bodyGroup, jacketGeo, mat, Axis.Y, -6);
        }

        {
            {
                const leftArmGroup = this.createAndAddGroup("leftArm", -5, 22, 0);

                const leftArmGeo = this.getBoxGeometry(SkinPart.LEFT_ARM);
                const leftArm = this.createAndAddMesh("leftArm", leftArmGroup, leftArmGeo, mat, Axis.Y, -4);
                leftArm.position.x = this.slim ? -0.5 : -1;

                const leftSleeveGeo = this.getBoxGeometry(SkinPart.LEFT_SLEEVE);
                const leftSleeve = this.createAndAddMesh("leftSleeve", leftArmGroup, leftSleeveGeo, mat, Axis.Y, -4);
                leftSleeve.position.x = this.slim ? -0.5 : -1;
            }
            {
                const rightArmGroup = this.createAndAddGroup("rightArm", 5, 22, 0);

                const rightArmGeo = this.getBoxGeometry(SkinPart.RIGHT_ARM);
                const rightArm = this.createAndAddMesh("rightArm", rightArmGroup, rightArmGeo, mat, Axis.Y, -4);
                rightArm.position.x = this.slim ? 0.5 : 1;

                const rightSleeveGeo = this.getBoxGeometry(SkinPart.RIGHT_SLEEVE);
                const rightSleeve = this.createAndAddMesh("rightSleeve", rightArmGroup, rightSleeveGeo, mat, Axis.Y, -4);
                rightSleeve.position.x = this.slim ? 0.5 : 1;
            }
        }

        {
            {
                const leftLegGroup = this.createAndAddGroup("leftLeg", -1.9, 12, 0);

                const leftLegGeo = this.getBoxGeometry(SkinPart.LEFT_LEG);
                const leftLeg = this.createAndAddMesh("leftLeg", leftLegGroup, leftLegGeo, mat, Axis.Y, -6);

                const leftTrousersGeo = this.getBoxGeometry(SkinPart.LEFT_TROUSERS);
                const leftTrousers = this.createAndAddMesh("leftTrousers", leftLegGroup, leftTrousersGeo, mat, Axis.Y, -6);
            }
            {
                const rightLegGroup = this.createAndAddGroup("rightLeg", 1.9, 12, 0);

                const rightLegGeo = this.getBoxGeometry(SkinPart.RIGHT_LEG);
                const rightLeg = this.createAndAddMesh("rightLeg", rightLegGroup, rightLegGeo, mat, Axis.Y, -6);

                const rightTrousersGeo = this.getBoxGeometry(SkinPart.RIGHT_TROUSERS);
                const rightTrousers = this.createAndAddMesh("rightTrousers", rightLegGroup, rightTrousersGeo, mat, Axis.Y, -6);
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

    /** Load a cape texture in the selected layout, or pass undefined to remove the cape. */
    public async setCapeTexture(src?: string, layout: CapeLayout = "minecraft"): Promise<void> {
        const load = ++this.capeLoad;
        if (src === undefined) {
            const group = this.getGroupByName(SkinPart.CAPE);
            group?.removeFromParent();
            this.notifyDirty();
            return;
        }

        const material = await SkinTextures.getCape(src, layout);
        if (load !== this.capeLoad) return;
        const size = capeTextureSizes[layout];
        const geometry = this._getBoxGeometryFromDimensions(
            classicSkinGeometries.cape, classicSkinTextureCoordinates.cape, size, size);
        const mesh = this.getMeshByName(SkinPart.CAPE);
        if (mesh) {
            mesh.material = material;
            mesh.geometry = geometry;
        } else {
            const body = this.getGroupByName(SkinPart.BODY);
            const group = this.createGroup(SkinPart.CAPE, 0, body ? 0 : 24, 2);
            (body ?? this).add(group);
            group.rotation.set(toRadians(-6), Math.PI, 0);
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

        const offset = slim ? 0.5 : -0.5;
        for (const part of [SkinPart.LEFT_ARM, SkinPart.LEFT_SLEEVE, SkinPart.RIGHT_ARM, SkinPart.RIGHT_SLEEVE]) {
            const mesh = this.getMeshByName(part);
            if (mesh) {
                mesh.geometry = this.getBoxGeometry(part);
                mesh.position.x += part === SkinPart.LEFT_ARM || part === SkinPart.LEFT_SLEEVE ? offset : -offset;
            }
        }
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
