import {
    AssetKey,
    AssetLoader,
    AssetParser,
    NBTAsset,
    BatchedExecutor,
    BlockObject,
    BlockStates,
    MineRenderWorld,
    Renderer,
    SceneInspector,
    SkinObject,
    Skins,
    StructureParser,
    Ticker
} from "minerender";

console.log("hi");

const renderer = new Renderer({
    camera: {
        near: 1,
        far: 2000,
        position: [550, 400, 550]
    },
    controls: {
        enabled: true
    },
    render: {
        stats: true,
        fpsLimit: 0,
        antialias: true
    },
    composer: {
        enabled: false
    },
    debug: {
        grid: false,
        axes: false
    }
});
renderer.appendTo(document.body);
renderer.start();
window["renderer"] = renderer;

const info = {
    "objectCount": 0,
    "sceneObjectCount": 0,
    "instanceCount": 0,
    "renderCalls": 0,
    "1sTps": 0,
    "5sTps": 0
}

const sceneInspector = new SceneInspector(renderer);
sceneInspector.appendTo(document.getElementById('inspector'));


let world = new MineRenderWorld(renderer.scene);
window["world"] = world;

setInterval(() => {
    for (let k in info) {
        document.getElementById(k)!.innerText = "" + info[k];
    }
}, 500);

setInterval(() => {
    info["renderCalls"] = renderer.renderer.info.render.calls;
}, 1000);


setInterval(() => {
    info["1sTps"] = Ticker.tpsOneSecond;
    info["5sTps"] = Ticker.tpsFiveSeconds;

    info["objectCount"] = renderer.scene.stats.objectCount;
    info["sceneObjectCount"] = renderer.scene.stats.sceneObjectCount;
    info["instanceCount"] = renderer.scene.stats.instanceCount;
}, 1000);

setTimeout(()=>{
    setStructure("end_city/ship")
    // setStructure("igloo/bottom");
},10)

async function setStructure(structureName: string) {
    structureInput.disabled = true;
    console.log("setting structure to", structureName);

    await world.clear();

   try{
       const structureAsset = new AssetKey("minecraft", structureName, "structure", undefined, "data", ".nbt");

       const asset = await AssetLoader.get<NBTAsset>(structureAsset, AssetParser.NBT);
       console.log(asset);

       const structure = await StructureParser.parse(asset);
       console.log(structure)

       await world.placeMultiBlock(structure, true, new BatchedExecutor(1, 32));
       console.log("done placing structure!")

       structureInput.disabled = false;
   }catch (e){
       console.error(e);
       structureInput.disabled = false;
   }
}


window["setStructure"] = setStructure;

const structureInput = document.getElementById("structure-input") as HTMLInputElement;
structureInput.addEventListener("change", () => {
    setStructure(structureInput.value);
});
const structureSuggestions = document.getElementById("structure-suggestions") as HTMLDataListElement;
setTimeout(() => {
    fetch(AssetLoader.ROOT + "/data/minecraft/structure/_list.json").then(res => res.json()).then(rootList => {
        console.log(rootList)
        rootList["directories"].forEach(dir => {
            fetch(AssetLoader.ROOT + "/data/minecraft/structure/" + dir + "/_list.json").then(res => res.json()).then(list => {
                console.log(list)
                list["files"].forEach(file => {
                    const option = document.createElement("option");
                    option.value = dir + "/" + file.replace("\.nbt", "");
                    structureSuggestions.appendChild(option);
                });
            }).catch(err => console.error(err))
        })
    }).catch(err => console.error(err))
}, 10)
