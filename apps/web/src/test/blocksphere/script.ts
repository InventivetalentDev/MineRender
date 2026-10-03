import "../../assets";
import {
    AssetKey,
    AssetLoader,
    BlockObject,
    BlockStates,
    Models,
    Renderer,
    SceneInspector,
    MineRenderWorld,
    BatchedExecutor,
    Ticker,
    BasicAssetKey
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


const world = new MineRenderWorld(renderer.scene);
window["world"] = world;
console.log(world);


const executor = new BatchedExecutor(1, 10);


// setTimeout(() => {
//     BlockStates.getList().then(blockList_ => {
//         const blockList = [...blockList_];
//         const a = 64;
//         let c = 0
//         for (let x = 0; x < a; x++) {
//             for (let y = 0; y < a; y++) {
//                 c++;
//
//                 const blockName = blockList[c].split("\.")[0];
//                 if (!blockName) continue;
//
//                 ((xc, yc, blockName) => {
//                     setTimeout(() => {
//
//                         executor.submit(() => {
//                             world.setBlockAt(xc, 0, yc, {
//                                 type: blockName
//                             }).then(info => {
//                                 console.log(info)
//                             })
//                         })
//                     }, c * 50)
//                 })(x, y, blockName);
//
//             }
//         }
//         console.log(blockList)
//     })
//
// }, 2000);

BlockStates.getList().then(blockList_ => {
    const blockList = [...blockList_];
    const c = 32
    const d = 128;
    const R = 32;
    for (let i = 0; i < c; i++) {
        // const blockName = blockList[i].split("\.")[0]
        const blockName = blockList.splice(Math.floor(Math.random() * blockList.length), 1)[0].split("\.")[0];
        if (!blockName) continue;

        setTimeout(() => {

            BlockStates.get(AssetKey.parse("blockstates", blockName))
                .then(blockState => {
                    console.log(blockState);

                    for (let j = 0; j < d; j++) {


                        setTimeout(() => {
                            // incStat("modelCount")
                            renderer.scene.addBlock(blockState, {
                                mergeMeshes: true,
                                instanceMeshes: true,
                                wireframe: false,
                                maxInstanceCount: 100
                            }).then(obj => {
                                let p = getRandomSpherePoint();
                                obj.setPosition(new Vector3(p.x * R * 16, p.y * R * 16, p.z * R * 16));
                                // obj.nextInstance();
                                // for (let i = 0; i < 100; i++) {
                                //     // setTimeout(() => {
                                //         let n = obj.nextInstance();
                                //         console.log(n)
                                //         // obj.setPositionAt(n.index, new THREE.Vector3(getRandomInt(-64, 64) * 16, getRandomInt(-32, 32) * 16, getRandomInt(-64, 64) * 16));
                                //         let p = getRandomSpherePoint();
                                //         n.setPosition(new Vector3(p.x * R * 16, p.y * R * 16, p.z * R * 16));
                                //         // incStat("instanceCount")
                                //     // }, i * 10);
                                // }
                            })
                        }, j * 10);
                    }

                })
        }, i * 5)
    }
    console.log(blockList)
    setTimeout(() => {
        console.log(blockList)
    }, c * 5)
})






const inspector = new SceneInspector(renderer);
document.getElementById('rayinfo')!.append(inspector.objectInfoContainer);
document.getElementById('rayinfo')!.append(inspector.objectControlsContainer);

// https://github.com/mrdoob/three.js/blob/master/examples/webgl_interactive_cubes.html
// const raycaster = new THREE.Raycaster();
// document.addEventListener("click", event => {
//     let mouse = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
//     raycaster.setFromCamera(mouse, renderer.camera);
//     let intersects = raycaster.intersectObjects(renderer.scene.children, true);
//     if (intersects.length > 0) {
//         console.log(intersects);
//         const first = intersects[0];
//         if (first && first.object && first.object.parent) {
//             const modelObject = first.object.parent;
//             if (modelObject.originalModel) {
//                 const blockObject = modelObject.parent;
//                 document.getElementById("rayinfo").innerHTML =
//                     `<span>D: ${ first.distance }</span><br/>` +
//
//                     `<span>Model Key:</span>` +
//                     `<pre>${ JSON.stringify(modelObject.originalModel.key, null, 2) }</pre>` +
//
//                     `<span>State</span>` +
//                     `<pre>${ JSON.stringify(blockObject.state, null, 2) }</pre>` +
//
//                     `<span>Model</span>` +
//                     `<pre>${ JSON.stringify(modelObject.originalModel, null, 2) }</pre>` +
//                     `<span>BlockState</span>` +
//                     `<pre>${ JSON.stringify(blockObject.blockState, null, 2) }</pre>`
//             }else{
//                 document.getElementById("rayinfo").innerHTML =
//                     `<span>D: ${ first.distance }</span><br/>` +
//                     `<span>N: ${first.object.name}</span>`
//             }
//         }
//     }
// })


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
