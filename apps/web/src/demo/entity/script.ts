import { AssetKey, Entities, EntityObject, Renderer, SceneInspector } from "minerender";
import { Color, Intersection, Vector3 } from "three";

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
const entityStates = document.getElementById("entity-states") as HTMLFieldSetElement;
const entityStatus = document.getElementById("entity-status")!;

/**
 * Without `layers`, draws main and the dataset passes enabled by the `when` labels;
 * explicit `layers` draw exactly those geometry layers.
 */
async function setEntity(entity: string, layers?: string[], when: string[] = [], tints: Record<string, string | number> = {}) {
    entityInput.value = entity;
    entityInput.disabled = entityLayers.disabled = true;
    entityStatus.textContent = "Loading entity…";
    try {
        const key = AssetKey.parse("entities", entity);
        const availableLayers = await Entities.getLayerList(key);
        if (!availableLayers.length) throw new Error(`No layers found for entity: ${entity}`);
        const selectedLayers = layers?.filter(name => availableLayers.includes(name));
        if (selectedLayers && !selectedLayers.length) {
            entityStatus.textContent = "Select at least one layer.";
            return;
        }

        const passes = await Entities.getPassList(key);
        const entityModel = await Entities.getEntity(key, undefined, selectedLayers ? { layers: selectedLayers } : { when });
        if (!entityModel) throw new Error(`Entity model not found: ${entity}`);
        // Repeated draws of a geometry layer are keyed "<layer>#<n>".
        const drawn = Object.keys(entityModel.layers ?? {}).map(name => name.split("#")[0]);
        entityLayers.replaceChildren(...availableLayers.map(name => {
            const option = document.createElement("option");
            option.value = option.textContent = name;
            option.selected = drawn.includes(name);
            return option;
        }));
        const labels = (field: "when" | "tint") => [...new Set(passes.map(pass => pass[field]).filter(label => label !== undefined))];
        entityStates.hidden = !labels("when").length && !labels("tint").length;
        entityStates.replaceChildren(entityStates.firstElementChild!, ...labels("when").map(name => {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = !selectedLayers && when.includes(name);
            input.addEventListener("change", () => {
                const enabled = input.checked ? [...when, name] : when.filter(other => other !== name);
                setEntity(entity, undefined, enabled, tints).catch(console.error);
            });
            label.append(input, ` ${name}`, document.createElement("br"));
            return label;
        }), ...labels("tint").map(name => {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "color";
            input.value = `#${new Color(tints[name] ?? 0xffffff).getHexString()}`;
            input.addEventListener("change", () => {
                setEntity(entity, layers, when, { ...tints, [name]: input.value }).catch(console.error);
            });
            label.append(input, ` ${name}`, document.createElement("br"));
            return label;
        }));

        const replacement = await renderer.scene.addEntity(entityModel, { tints }) as EntityObject;
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
