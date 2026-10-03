import { AssetKey, AssetLoader, BlockObject, BlockStates, Models, Renderer, SceneInspector, MineRenderWorld, BatchedExecutor, Ticker } from "minerender";
import { AmbientLight, AxesHelper, DirectionalLight, DirectionalLightHelper, Euler, GridHelper, HemisphereLight, HemisphereLightHelper, PointLight, PointLightHelper, sRGBEncoding, Vector3 } from "three";


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
    controls: {
        enabled: true
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

async function createModel(type, name, instances = 1, x = 0, y = 0, z = 0) {
    return Models.getMerged(new AssetKey("minecraft", name, "models", type, "assets")).then(model => {
        console.log(model)
        return renderer.scene.addModel(model!, {
            mergeMeshes: true,
            instanceMeshes: true,
            wireframe: true,
            maxInstanceCount: instances
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

function createBlockState(name, instances = 1, x = 0, y = 0, z = 0) {
    BlockStates.get(new AssetKey("minecraft", name, "blockstates", undefined, ".json"))
        .then(blockState => {
            console.log(blockState);

            let obj =  renderer.scene.addBlock(blockState!, {
                mergeMeshes: false,
                instanceMeshes: true,
                wireframe: true,
                maxInstanceCount: instances + 5
            })
            // let obj = new BlockObject(blockState!, {
            //     mergeMeshes: false,
            //     instanceMeshes: true,
            //     wireframe: true,
            //     maxInstanceCount: instances + 5
            // });
            console.log(obj);
            // renderer.scene.initAndAdd(obj).then(() => {
            //     // incStat("instanceCount")
            //     console.log("added");
            //     setTimeout(() => {
            //         if (!obj.isInstanced) return;
            //         for (let i = 0; i < instances; i++) {
            //             let n = obj.nextInstance();
            //             n.setPosition(new Vector3(x, y, z))
            //             // obj.setPositionAt(n.index, new THREE.Vector3(16,64,16));
            //             // obj.setRotationAt(n.index, new THREE.Euler(0,1.5708,0));
            //             // incStat("instanceCount")
            //         }
            //     }, 100)
            // })

        })
}

//TODO: fire in wrong position, rescale thingy maybe?
// createBlockState("campfire",5);
// createBlockState("glass",1,0,16,0);
// (async () => {
//     await createModel("block", "acacia_log", 1, 32, 32, 32)
//     await createModel("block", "acacia_log", 1, 32, 32, 16)
//     await createModel("block", "acacia_log", 1, 32, 32, 16)
// })();
// createModel("block", "stone");



const world = new MineRenderWorld(renderer.scene);
window["world"] = world;
console.log(world);







const executor = new BatchedExecutor(1, 50);


world.setBlockAt(0, 0, 0, {
    type: "stone"
}).then(info => {
    console.log(info)

    setTimeout(() => {
        for (let x = 0; x < 20; x++) {
            for (let z = 0; z < 20; z++) {
                for (let y = 0; y < 20; y++) {
                    if (Math.random() < 0.2) {
                        executor.submit(() => {
                            world.setBlockAt(x, y, z, {
                                type: "stone"
                            }).then(info => {
                                console.log(info)
                            })
                        })
                    }
                }
            }
        }
    }, 5000)
})










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
    return { x: x, y: y, z: z };
}


async function sleep(timeout: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), timeout);
    });
}
