import { AssetKey, BlockObject, BlockStates, Renderer, SceneInspector, SkinObject, Skins } from "minerender";
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
        fpsLimit: 0,
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

let blockObject: BlockObject;

setBlock("stone");

function setBlock(block: string) {
    console.log("setting block to", block)

    if (typeof blockObject !== "undefined") {
        blockObject.removeFromScene();
        blockObject.disposeAndRemoveAllChildren();
        renderer.scene.remove(blockObject);
        blockObject = undefined;
    }

    BlockStates.get(AssetKey.parse("blockstates", block)).then(blockState => {
        return renderer.scene.addBlock(blockState,{
            wireframe: true
        });
    }).then(blockObject_ => {
        blockObject = blockObject_ as BlockObject; //TODO
        window["block"] = blockObject;

        // dummy intersection
        const intersection: Intersection = {
            object: blockObject,
            distance: 0,
            point: new Vector3(),
            instanceId: blockObject.isInstanced ? blockObject.instanceCounter : undefined
        }
        sceneInspector.selectObject(blockObject, intersection)
    });
}

window["setBlock"] = setBlock;

const blockInput = document.getElementById("block-input") as HTMLInputElement;
blockInput.addEventListener("change", () => {
    setBlock(blockInput.value);
});
const blockSuggestions = document.getElementById("block-suggestions") as HTMLDataListElement;
BlockStates.getList().then(list => {
    list.forEach(l => {
        const option = document.createElement("option");
        option.value = l.replace("\.json", "");
        blockSuggestions.appendChild(option);
    })
})


//TODO: include this in renderer constructor
// @ts-ignore meh.
const controls = new OrbitControls(renderer.camera, renderer.renderer.domElement);
renderer.registerEventDispatcher(controls);
controls.update();
