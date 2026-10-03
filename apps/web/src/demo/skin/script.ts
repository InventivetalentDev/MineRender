import "../../assets";
import { Renderer, SceneInspector, SkinObject, Skins } from "minerender";
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

let skinObject: SkinObject;

renderer.scene.addSkin().then(skinObject_ => {
    skinObject = skinObject_;
    window["skin"] = skinObject_;

    setSkin("inventivetalent");


    // dummy intersection
    const intersection: Intersection = {
        object: skinObject_,
        distance: 0,
        point: new Vector3(),
        instanceId: skinObject_.isInstanced ? skinObject_.instanceCounter : undefined
    }
    sceneInspector.selectObject(skinObject_, intersection)
});

function setSkin(skin: string) {
    console.log("setting skin to", skin);
    if (skin.startsWith("http")) {
        skinObject.setSkinTexture(skin)
    } else {
        Skins.fromUuidOrUsername(skin).then(skin => {
            console.log(skin);
            if (typeof skin !== "undefined") {
                skinObject.setSkinTexture(skin)
            }
        })
    }
}

window["setSkin"] = setSkin;

const skinInput = document.getElementById("skin-input") as HTMLInputElement;
skinInput.addEventListener("change", () => {
    setSkin(skinInput.value);
})


//TODO: include this in renderer constructor
// @ts-ignore meh.
const controls = new OrbitControls(renderer.camera, renderer.renderer.domElement);
renderer.registerEventDispatcher(controls);
controls.update();
