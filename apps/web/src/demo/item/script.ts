import { AssetKey, DISPLAY_POSITIONS, DisplayPosition, ModelObject, Models, Renderer, SceneInspector } from "minerender";
import { Intersection, Vector3 } from "three";

const renderer = new Renderer({
    camera: {
        near: 1,
        far: 2000,
        position: [20, 14, 30]
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
        enabled: false
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

let itemObject: ModelObject | undefined;

const itemInput = document.getElementById("item-input") as HTMLInputElement;
const itemDisplay = document.getElementById("item-display") as HTMLSelectElement;
const itemStatus = document.getElementById("item-status")!;

itemDisplay.replaceChildren(...["", ...DISPLAY_POSITIONS].map(position => {
    const option = document.createElement("option");
    option.value = position;
    option.textContent = position || "none";
    return option;
}));

async function setItem(item: string, displayPosition = itemDisplay.value as DisplayPosition | "") {
    itemInput.value = item;
    itemDisplay.value = displayPosition;
    itemStatus.textContent = "Loading item…";
    try {
        const model = await Models.getMerged(new AssetKey("minecraft", item, "models", "item"));
        if (!model) throw new Error(`Item model not found: ${item}`);
        // A plain object rather than a shared instance, so the inspector can select it.
        const replacement = await renderer.scene.addModel(model, { displayPosition: displayPosition || undefined, instanceMeshes: false }) as ModelObject;
        if (itemObject) {
            itemObject.removeFromScene();
            itemObject.disposeAndRemoveAllChildren();
        }
        itemObject = replacement;
        window["item"] = itemObject;

        const intersection: Intersection = {
            object: itemObject,
            distance: 0,
            point: new Vector3(),
            instanceId: undefined
        };
        sceneInspector.selectObject(itemObject, intersection);
        itemStatus.textContent = "";
        return itemObject;
    } catch (error) {
        itemStatus.textContent = error instanceof Error ? error.message : "Could not load item.";
        throw error;
    }
}

window["setItem"] = setItem;

itemInput.addEventListener("change", () => {
    setItem(itemInput.value).catch(console.error);
});
itemDisplay.addEventListener("change", () => {
    setItem(itemInput.value).catch(console.error);
});

const itemSuggestions = document.getElementById("item-suggestions") as HTMLDataListElement;
Models.getItemList().then(list => {
    list.filter(file => file.endsWith(".json") && file !== "_list.json").forEach(file => {
        const option = document.createElement("option");
        option.value = file.slice(0, -5);
        itemSuggestions.appendChild(option);
    });
}).catch(error => {
    itemStatus.textContent = "Could not load item list.";
    console.error(error);
});

setItem(itemInput.value).catch(console.error);
