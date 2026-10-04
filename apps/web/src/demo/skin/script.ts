import { CapeLayout, Renderer, SceneInspector, SkinObject, Skins } from "minerender";
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

let skinObject: SkinObject;

renderer.scene.addSkin().then(skinObject_ => {
    skinObject = skinObject_;
    window["skin"] = skinObject_;

    setSkin("inventivetalent").catch(console.error);


    // dummy intersection
    const intersection: Intersection = {
        object: skinObject_,
        distance: 0,
        point: new Vector3(),
        instanceId: skinObject_.isInstanced ? skinObject_.instanceCounter : undefined
    }
    sceneInspector.selectObject(skinObject_, intersection)
});

async function setSkin(skin: string) {
    const src = skin.startsWith("http") ? skin : await Skins.fromUuidOrUsername(skin);
    if (src !== undefined) await skinObject.setSkinTexture(src);
}

window["setSkin"] = setSkin;

const capeInput = document.getElementById("cape-input") as HTMLInputElement;
const capeType = document.getElementById("cape-type") as HTMLSelectElement;
const capeStatus = document.getElementById("cape-status")!;

async function setCape(cape: string, layout: CapeLayout = capeType.value as CapeLayout) {
    capeInput.disabled = capeType.disabled = true;
    capeStatus.textContent = cape ? "Loading cape…" : "";
    try {
        const src = !cape ? undefined : cape.startsWith("http") ? cape : await Skins.capeFromCapesDev(cape, layout);
        await skinObject.setCapeTexture(src, layout);
        capeStatus.textContent = cape && src === undefined ? "No cape found." : "";
    } catch (error) {
        capeStatus.textContent = "Could not load cape.";
        throw error;
    } finally {
        capeInput.disabled = capeType.disabled = false;
    }
}

window["setCape"] = setCape;

const skinInput = document.getElementById("skin-input") as HTMLInputElement;
skinInput.addEventListener("change", () => {
    setSkin(skinInput.value).catch(console.error);
});

capeInput.addEventListener("change", () => {
    setCape(capeInput.value).catch(console.error);
});
capeType.addEventListener("change", () => {
    setCape(capeInput.value).catch(console.error);
});
