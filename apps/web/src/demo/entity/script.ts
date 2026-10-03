import "../../assets";
import { AssetKey, BasicAssetKey, BlockStates, Entities, EntityObject, Renderer, SceneInspector, SkinObject, Skins } from "minerender";
import { Intersection, Vector3 } from "three";
import { OrbitControls } from "minerender";

console.log("hi");

const renderer = new Renderer({
    camera: {
        near: 1,
        far: 2000,
        position: [50, 35, 50]
    },
    render: {
        stats: true,
        fpsLimit: 60,
        antialias: false
    },
    composer: {
        enabled: true
    },
    debug: {
        grid: true,
        axes: true
    }
});
renderer.appendTo(document.body);
renderer.start();
window["renderer"] = renderer;

const sceneInspector = new SceneInspector(renderer);
sceneInspector.appendTo(document.getElementById('inspector'));

let entityObject: EntityObject;

setEntity("pig");

function setEntity(entity: string) {
    console.log("setting entity to", entity);

    if (typeof entityObject !== "undefined") {
        entityObject.removeFromScene();
        entityObject.disposeAndRemoveAllChildren();
        renderer.scene.remove(entityObject);
        entityObject = undefined;
    }

    const key = AssetKey.parse("entities", entity);
    Entities.getEntity(key).then(entityModel => {
        if (typeof entityModel !== "undefined" && typeof entityModel.parts !== "undefined") {
            return entityModel;
        }
        return Entities.getBlock(key)
    }).then(entityModel => {
        console.log(entityModel)
        return renderer.scene.addEntity(entityModel);
    }).then(entityObject_ => {
        entityObject = entityObject_ as EntityObject;//TODO
        window["entity"] = entityObject;

        // dummy intersection
        const intersection: Intersection = {
            object: entityObject,
            distance: 0,
            point: new Vector3(),
            instanceId: entityObject.isInstanced ? entityObject.instanceCounter : undefined
        }
        sceneInspector.selectObject(entityObject, intersection)
    })
}

window["setEntity"] = setEntity;

const entityInput = document.getElementById("entity-input") as HTMLInputElement;
entityInput.addEventListener("change", () => {
    setEntity(entityInput.value);
})
const entitySuggestions = document.getElementById("entity-suggestions") as HTMLDataListElement;
Entities.getEntityList().then(list => {
    list.forEach(l => {
        const option = document.createElement("option");
        option.value = l;
        entitySuggestions.appendChild(option);
    })
})
Entities.getBlockList().then(list => {
    list.forEach(l => {
        const option = document.createElement("option");
        option.value = l;
        entitySuggestions.appendChild(option);
    })
})


//TODO: include this in renderer constructor
// @ts-ignore meh.
const controls = new OrbitControls(renderer.camera, renderer.renderer.domElement);
renderer.registerEventDispatcher(controls);
controls.update();
