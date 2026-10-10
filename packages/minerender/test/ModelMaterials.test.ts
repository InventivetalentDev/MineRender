import test from "ava";
import { DoubleSide, FrontSide, Material, Mesh, MeshBasicMaterial } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES } from "../src/CubeFace";
import { Materials } from "../src/Materials";
import { ModelObject } from "../src/model/scene/ModelObject";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { UVMapper } from "../src/UVMapper";
import type { CanvasImage } from "../src/canvas/CanvasImage";
import type { Model } from "../src/model/Model";

test.serial("model materials blend only partial alpha and keep transparent atlases double-sided", async t => {
    const originals = { atlas: UVMapper.getAtlas, material: Materials.getImage };
    const placeholder = new MeshBasicMaterial();
    const objects: ModelObject[] = [];
    Caching.clear();
    Materials.getImage = () => placeholder;
    t.teardown(() => {
        for (const object of objects) object.dispose();
        UVMapper.getAtlas = originals.atlas;
        Materials.getImage = originals.material;
        placeholder.dispose();
        Caching.clear();
    });
    const model: Model = {
        key: new AssetKey("test", "material_cube", "models", "block"),
        textures: { side: "block/stone" },
        elements: [{
            from: [0, 0, 0], to: [16, 16, 16],
            faces: Object.fromEntries(CUBE_FACES.map(face => [face, { texture: "#side" }])),
            mappedUv: CUBE_FACES.flatMap(() => [0, 1, 1, 1, 0, 0, 1, 0])
        }]
    };
    for (const [hasTransparency, hasTranslucency] of [[false, false], [true, false], [true, true]]) {
        const atlas = new TextureAtlas(model, { width: 16, height: 16, canvas: {} } as CanvasImage,
            { side: [16, 16] }, { side: [0, 0] }, false, {}, hasTransparency, hasTranslucency);
        UVMapper.getAtlas = async () => atlas;
        const object = new ModelObject(model, { instanceMeshes: false });
        objects.push(object);
        await object.init();

        const material = (object.children[0] as Mesh).material as Material;
        t.is(material.transparent, hasTranslucency);
        t.is(material.side, hasTransparency ? DoubleSide : FrontSide);
    }
});
