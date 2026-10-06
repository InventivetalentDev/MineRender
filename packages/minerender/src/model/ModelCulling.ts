import { Euler, Vector3 } from "three";
import { CUBE_FACE_OFFSETS, CUBE_FACES } from "../CubeFace";
import { TextureAtlas } from "../texture/TextureAtlas";
import { Maybe } from "../util/util";

export class ModelCulling {

    public static toLocalMask(worldMask: number, rotation: Euler): number {
        let localMask = 0;
        for (const [localFace, offset] of CUBE_FACE_OFFSETS.entries()) {
            const normal = new Vector3(...offset).applyEuler(rotation);
            const worldFace = CUBE_FACE_OFFSETS.findIndex(([x, y, z]) =>
                Math.abs(normal.x - x) < 1e-6 && Math.abs(normal.y - y) < 1e-6 && Math.abs(normal.z - z) < 1e-6);
            if (worldFace < 0) return 0;
            if (worldMask & (1 << worldFace)) localMask |= 1 << localFace;
        }
        return localMask;
    }

    public static isOpaqueFullCube(atlas: Maybe<TextureAtlas>): boolean {
        if (!atlas || atlas.hasTransparency !== false || atlas.model.elements?.length !== 1) return false;
        const element = atlas.model.elements[0];
        if (element.from.length !== 3 || !element.from.every(value => value === 0)
            || element.to.length !== 3 || !element.to.every(value => value === 16)
            || (element.rotation && element.rotation.angle !== 0)
            || element.mappedUv?.length !== 48 || !element.mappedUv.every(Number.isFinite)) return false;
        if (!(atlas.image.width > 0 && atlas.image.height > 0)) return false;
        return CUBE_FACES.every((face, faceIndex) => {
            const texture = element.faces[face]?.texture;
            if (!texture?.startsWith("#")) return false;
            const key = texture.slice(1);
            const position = atlas.positions[key];
            const size = atlas.sizes[key];
            if (position?.length !== 2 || !position.every(Number.isFinite)
                || size?.length !== 2 || !size.every(value => value > 0 && Number.isFinite(value))) return false;
            for (let vertex = 0; vertex < 4; vertex++) {
                const uvIndex = (faceIndex * 4 + vertex) * 2;
                const x = element.mappedUv![uvIndex] * atlas.image.width;
                const y = (1 - element.mappedUv![uvIndex + 1]) * atlas.image.height;
                if (x < position[0] - 1e-6 || x > position[0] + size[0] + 1e-6
                    || y < position[1] - 1e-6 || y > position[1] + size[1] + 1e-6) return false;
            }
            return true;
        });
    }

}
