import { AssetKey, Entities, EntityObject, Renderer, SceneInspector } from "minerender";
import { Intersection, Vector3 } from "three";

console.log("hi");

const renderer = new Renderer({
    camera: {
        near: 1,
        far: 2000,
        position: [50, 35, 50]
    },
    controls: {
        enabled: true
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

let entityObject: EntityObject | undefined;

const entityInput = document.getElementById("entity-input") as HTMLInputElement;
const entityLayers = document.getElementById("entity-layers") as HTMLSelectElement;
const entityStatus = document.getElementById("entity-status")!;

async function setEntity(entity: string, layers: string[] = ["main"]) {
    entityInput.value = entity;
    entityInput.disabled = entityLayers.disabled = true;
    entityStatus.textContent = "Loading entity…";
    try {
        const key = AssetKey.parse("entities", entity);
        const availableLayers = await Entities.getLayerList(key);
        entityLayers.replaceChildren(...availableLayers.map(name => {
            const option = document.createElement("option");
            option.value = option.textContent = name;
            option.selected = layers.includes(name);
            return option;
        }));
        if (!availableLayers.length) throw new Error(`No layers found for entity: ${entity}`);
        const selectedLayers = Array.from(entityLayers.selectedOptions, option => option.value);
        if (!selectedLayers.length) {
            entityStatus.textContent = "Select at least one layer.";
            return;
        }

        const entityModel = await Entities.getEntity(key, undefined, { layers: selectedLayers });
        if (!entityModel) throw new Error(`Entity model not found: ${entity}`);
        const replacement = await renderer.scene.addEntity(entityModel) as EntityObject;
        if (entityObject) {
            entityObject.removeFromScene();
            entityObject.disposeAndRemoveAllChildren();
        }
        entityObject = replacement;
        window["entity"] = entityObject;

        const intersection: Intersection = {
            object: entityObject,
            distance: 0,
            point: new Vector3(),
            instanceId: entityObject.isInstanced ? entityObject.instanceCounter : undefined
        };
        sceneInspector.selectObject(entityObject, intersection);
        entityStatus.textContent = "";
        return entityObject;
    } catch (error) {
        entityStatus.textContent = error instanceof Error ? error.message : "Could not load entity.";
        throw error;
    } finally {
        entityInput.disabled = entityLayers.disabled = false;
    }
}

window["setEntity"] = setEntity;

entityInput.addEventListener("change", () => {
    setEntity(entityInput.value).catch(console.error);
});
entityLayers.addEventListener("change", () => {
    const layers = Array.from(entityLayers.selectedOptions, option => option.value);
    setEntity(entityInput.value, layers).catch(console.error);
});

const entitySuggestions = document.getElementById("entity-suggestions") as HTMLDataListElement;
Entities.getEntityList().then(list => {
    list.forEach(l => {
        const option = document.createElement("option");
        option.value = l;
        entitySuggestions.appendChild(option);
    });
}).catch(error => {
    entityStatus.textContent = "Could not load entity list.";
    console.error(error);
});

setEntity("bat").catch(console.error);
