import "../../assets";
import {
    AssetKey,
    AssetLoader,
    HostedAssetSource,
    BlockObject,
    BlockStates,
    Models,
    Renderer,
    SceneInspector,
    MineRenderWorld,
    BatchedExecutor,
    Ticker
} from "minerender";
import {
    AmbientLight,
    AxesHelper,
    DirectionalLight,
    DirectionalLightHelper,
    Euler,
    GridHelper,
    HemisphereLight,
    HemisphereLightHelper,
    PointLight,
    PointLightHelper,
    sRGBEncoding,
    Vector3
} from "three";
import { OrbitControls } from "minerender";


console.log("hi")

const info = {
    "objectCount": 0,
    "sceneObjectCount": 0,
    "instanceCount": 0,
    "renderCalls": 0,
    "1sTps": 0,
    "5sTps": 0
}

setInterval(() => {
    for (let k in info) {
        document.getElementById(k)!.innerText = "" + info[k];
    }
}, 500);

setInterval(() => {
    info["1sTps"] = Ticker.tpsOneSecond;
    info["5sTps"] = Ticker.tpsFiveSeconds;

    info["objectCount"] = renderer.scene.stats.objectCount;
    info["sceneObjectCount"] = renderer.scene.stats.sceneObjectCount;
    info["instanceCount"] = renderer.scene.stats.instanceCount;
}, 1000);

function incStat(stat, amount = 1) {
    info[stat] += amount;
}

const start = Date.now();

// var stats = new Stats();
// stats.showPanel( 0 ); // 0: fps, 1: ms, 2: mb, 3+: custom
// document.body.appendChild( stats.dom );

// const MineRender = require("../src");
const renderer = new Renderer({
    camera: {
        near: 1,
        far: 2000
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

setInterval(() => {
    info["renderCalls"] = renderer.renderer.info.render.calls;
}, 1000);

// AssetLoader.ROOT = "https://corsfiles.inventivetalent.dev/resourcepacks/PureBDcraft%20%2064x%20MC117";
// AssetLoader.ROOT = "https://corsfiles.inventivetalent.dev/resourcepacks/PureBDcraft%20256x%20MC117";
// AssetLoader.ROOT = "https://corsfiles.inventivetalent.dev/resourcepacks/Faithful%201.17";
AssetLoader.ROOT = "https://corsfiles.inventivetalent.dev/internal/blockbench";
AssetLoader.addSource("custom-model", new HostedAssetSource(AssetLoader.ROOT, { retryDefaults: false }));

async function createModel(type, name, instances = 1, x = 0, y = 0, z = 0) {
    return Models.getMerged(new AssetKey("minecraft", name, "models", type, "assets")).then(model => {
        console.log(model)
        return Promise.all([
            renderer.scene.addSkin("http://textures.minecraft.net/texture/fb5f93b1ccebf7b385fa488c6d4cfec87cf1b855f8dbe0308da44167cae170b"),
            renderer.scene.addModel(model!, {
                mergeMeshes: true,
                instanceMeshes: true,
                wireframe: true,
                maxInstanceCount: instances
            })
        ]).then(([skin, model]) => {
            model.setPosition(new Vector3(0, 16 * 2.5, 0))
        })
        // let obj = new MineRender.ModelObject(model, {
        //     mergeMeshes: true,
        //     instanceMeshes: true,
        //     wireframe: true,
        //     maxInstanceCount: instances
        // });
        // renderer.scene.initAndAdd(obj).then(()=>{
        //     incStat("modelCount")
        //     for (let i = 0; i < instances; i++) {
        //         let n = obj.nextInstance();
        //         obj.setPositionAt(n.index, new THREE.Vector3(x,y,z));
        //         incStat("instanceCount")
        //     }
        // })

    });
}


createModel("item", "blockbench-test");

// @ts-ignore meh.
const controls = new OrbitControls(renderer.camera, renderer.renderer.domElement);
renderer.registerEventDispatcher(controls);
controls.update();




const inspector = new SceneInspector(renderer);
document.getElementById('rayinfo')!.append(inspector.objectInfoContainer);
document.getElementById('rayinfo')!.append(inspector.objectControlsContainer);


function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}

function getRandomSpherePoint() {
    let u = Math.random();
    let v = Math.random();
    let theta = u * 2.0 * Math.PI;
    let phi = Math.acos(2.0 * v - 1.0);
    let r = Math.cbrt(Math.random());
    let sinTheta = Math.sin(theta);
    let cosTheta = Math.cos(theta);
    let sinPhi = Math.sin(phi);
    let cosPhi = Math.cos(phi);
    let x = r * sinPhi * cosTheta;
    let y = r * sinPhi * sinTheta;
    let z = r * cosPhi;
    return {x: x, y: y, z: z};
}


async function sleep(timeout: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), timeout);
    });
}
