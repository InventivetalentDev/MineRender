import { AssetKey, AssetLoader, BlockObject, BlockStates, Models, Renderer, SceneInspector, MineRenderWorld, BatchedExecutor, Ticker } from "minerender";
import { AmbientLight, AxesHelper, DirectionalLight, DirectionalLightHelper, Euler, GridHelper, HemisphereLight, HemisphereLightHelper, PointLight, PointLightHelper, sRGBEncoding, Vector3 } from "three";
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


/*
for(let i=0;i<100;i++){
    let x = Math.floor(Math.random()*50);
    let y = Math.floor(Math.random()*50);
    let z = Math.floor(Math.random()*50);

    world.setBlockAt(x, y, z, {
        type: "stone"
    }).then(info=>{
        console.log(info)
    })

}
*/





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




const structureAsset = new AssetKey("minecraft", "end_city/ship", "structures", undefined, "data", ".nbt");
// const structureAsset = new AssetKey("minecraft", "pillager_outpost/watchtower", "structures", undefined, "data", ".nbt");
// const structureAsset = new AssetKey(undefined, "all_blocks_16", undefined, undefined, undefined, ".nbt", "https://corsfiles.inventivetalent.dev")
// const structureAsset = new AssetKey(undefined, "world_test", undefined, undefined, undefined, ".nbt", "https://corsfiles.inventivetalent.dev")


/*
AssetLoader.loadOrRetryWithDefaults(structureAsset, AssetLoader.NBT).then(asset => {
    console.log(asset);
    return StructureParser.parse(asset).then(async structure => {
        console.log(structure)
        await world.placeMultiBlock(structure, true, new BatchedExecutor(1, 32));
    });
})
    .catch(err => console.log(err));
 */

// renderer.scene.addSkin("https://i.imgur.com/lmoTpEB.png")


/*
AssetLoader.loadOrRetryWithDefaults(structureAsset, AssetLoader.NBT).then(asset => {
    console.log(asset);
    StructureParser.parse(asset).then(async structure => {
        console.log(structure);

        const pos = new Vector3(0, 0, 0);
        const rotation = new Euler(0, 0, 0);
        const scale = new Vector3(1, 1, 1);
        let i = 2;
        for (let block of structure.blocks) {
            // await sleep(1);
            const blockState = await BlockStates.get(AssetKey.parse("blockstates", block.type));
            console.log("state", blockState)
            if (blockState) {
                const blockObjectOrReference = await renderer.scene.addBlock(blockState, {
                    mergeMeshes: true,
                    instanceMeshes: true,
                    wireframe: true,
                    maxInstanceCount: 5000
                });
                console.log("ref", blockObjectOrReference)
                if (isBlockObject(blockObjectOrReference)) {
                    await blockObjectOrReference.setState(block.properties)
                }
                // await sleep(5);
                console.log("move", blockObjectOrReference)
                console.log(block)
                blockObjectOrReference.setPosition(pos.set(block.position[0] * 16, block.position[1] * 16, block.position[2] * 16));
            } else {
                console.warn("missing blockstate for " + block.type);
            }
        }
    })

})

 */



BlockStates.getList().then(blockList_ => {
    const blockList = [...blockList_];
    const a = 10;
    let c = 0
    for (let x = 0; x < a; x++) {
        for (let y = 0; y < a; y++) {
            c++;

            const blockName = blockList[c].split("\.")[0];
            if (!blockName) continue;

            ((xc, yc, blockName) => {
                setTimeout(() => {

                    // createBlockState(blockName, 1, xc * 16, 16, yc * 16)

                    executor.submit(() => {
                        world.setBlockAt(xc, 0, yc, {
                            type: blockName
                        }).then(info => {
                            console.log(info)
                        })
                    })
                }, c * 5)
            })(x, y, blockName);

        }
    }
    console.log(blockList)
})



// MineRender.Entities.getEntity(new MineRender.BasicAssetKey("minecraft", "armor_stand"), new MineRender.BasicAssetKey("minecraft","armorstand/wood")).then(model => {
//     let obj = new MineRender.EntityObject(model, {
//         wireframe: true,
//     });
//     renderer.scene.initAndAdd(obj);
// });

// MineRender.BlockStates.getList().then(blockList_=>{
//     const blockList = [...blockList_];
//     const c = 0
//     for (let i = 0; i < c; i++) {
//         // const blockName = blockList[i].split("\.")[0]
//         const blockName = blockList.splice(Math.floor(Math.random() * blockList.length), 1)[0].split("\.")[0];
//         if(!blockName) continue;
//
//         setTimeout(() => {
//
//             MineRender.BlockStates.get({
//                 assetType: "blockstates",
//                 type: undefined,
//                 path: blockName,
//                 extension: ".json"
//             }).then(blockState => {
//                 console.log(blockState);
//
//                 const R = 64;
//
//                 let obj = new MineRender.BlockObject(blockState, {
//                     mergeMeshes: true,
//                     instanceMeshes: true,
//                     wireframe: false,
//                     maxInstanceCount: 50
//                 });
//                 incStat("modelCount")
//                 renderer.scene.initAndAdd(obj).then(() => {
//                     for (let i = 0; i < 100; i++) {
//                         let n = obj.nextInstance();
//                         // obj.setPositionAt(n.index, new THREE.Vector3(getRandomInt(-64, 64) * 16, getRandomInt(-32, 32) * 16, getRandomInt(-64, 64) * 16));
//                         let p = getRandomSpherePoint();
//                         obj.setPositionAt(n.index, new THREE.Vector3(p.x * R * 16, p.y * R * 16, p.z * R * 16));
//                         incStat("instanceCount")
//                     }
//                 })
//
//             })
//         }, i * 5)
//     }
//     console.log(blockList)
//     setTimeout(()=>{
//         console.log(blockList)
//     }, c*5)
// })

/*
BlockStates.get(new AssetKey("minecraft", "stone", "blockstates", undefined, "assets", ".json")).then(blockState=>{
    renderer.scene.addBlock(blockState).then(block=>{

    })
})

 */



// let skinObj = new MineRender.SkinObject();
// skinObj.setSkinTexture("https://crafatar.com/skins/bcd2033c63ec4bf88aca680b22461340?overlay");
// renderer.scene.add(skinObj)

// let modelList = itemList.files;
// for (let i = 0; i < 500; i++) {
//     if(i>=modelList.length) continue;
//
//     setTimeout(() => {
//         // let modelName = modelList[Math.floor(Math.random() * modelList.length)];
//         let modelName = modelList[i];
//         let split = modelName.split("\.");
//         modelName = split[0];
//
//
//         MineRender.Models.getMerged({
//             assetType: "models",
//             type: "item",
//             path: modelName,
//             extension: ".json"
//         }).then(model => {
//             const instanceCount = 200;
//
//             // console.log(model)
//             let obj = new MineRender.ModelObject(model, {
//                 mergeMeshes: true,
//                 instanceMeshes: true,
//                 wireframe: true,
//                 maxInstanceCount: instanceCount
//             });
//
//             // obj.translateX(getRandomInt(-16, 16) * 16)
//             // obj.translateY(getRandomInt(-8, 8) * 16)
//             // obj.translateZ(getRandomInt(-16, 16) * 16);
//
//             renderer.scene.initAndAdd(obj).then(()=>{
//                 incStat("modelCount")
//
//                 const R = 128;
//
//                 //TODO: add event for finished mesh loading or set isInstanced sooner
//                 setTimeout(() => {
//                     for (let i = 0; i < instanceCount; i++) {
//                         let n = obj.nextInstance();
//                         // obj.setPositionAt(n.index, new THREE.Vector3(getRandomInt(-64, 64) * 16, getRandomInt(-32, 32) * 16, getRandomInt(-64, 64) * 16));
//                         let p = getRandomSpherePoint();
//                         obj.setPositionAt(n.index, new THREE.Vector3(p.x * R * 16, p.y * R * 16, p.z * R * 16));
//                         incStat("instanceCount")
//                     }
//                 }, 2000);
//
//                 console.log("Time to scene add: " + (Date.now() - start) + "ms");
//             });
//         })
//     }, i * 5)
// }


// let obj = new MineRender.ModelObject({
//     "gui_light": "side",
//     "display": {
//         "gui": {"rotation": [30, 225, 0], "translation": [0, 0, 0], "scale": [0.625, 0.625, 0.625]},
//         "ground": {"rotation": [0, 0, 0], "translation": [0, 3, 0], "scale": [0.25, 0.25, 0.25]},
//         "fixed": {"rotation": [0, 0, 0], "translation": [0, 0, 0], "scale": [0.5, 0.5, 0.5]},
//         "thirdperson_righthand": {"rotation": [75, 45, 0], "translation": [0, 2.5, 0], "scale": [0.375, 0.375, 0.375]},
//         "firstperson_righthand": {"rotation": [0, 45, 0], "translation": [0, 0, 0], "scale": [0.4, 0.4, 0.4]},
//         "firstperson_lefthand": {"rotation": [0, 225, 0], "translation": [0, 0, 0], "scale": [0.4, 0.4, 0.4]}
//     },
//     "key": {"namespace": "minecraft", "type": "block", "path": "stone"},
//     "name": "stone",
//     "elements": [{"from": [0, 0, 0], "to": [16, 16, 16], "faces": {"down": {"texture": "#down", "cullface": "down"}, "up": {"texture": "#up", "cullface": "up"}, "north": {"texture": "#north", "cullface": "north"}, "south": {"texture": "#south", "cullface": "south"}, "west": {"texture": "#west", "cullface": "west"}, "east": {"texture": "#east", "cullface": "east"}}}],
//     "textures": {"particle": "#all", "down": "#all", "up": "#all", "north": "#all", "east": "#all", "south": "#all", "west": "#all", "all": "minecraft:block/stone"},
//     "names": ["block", "cube", "cube_all"]
// });
// renderer.scene.add(obj);

// let wireGeo = new THREE.EdgesGeometry(obj);
// let wireMat = new THREE.LineBasicMaterial({color: 0xffffff, linewidth: 2})
// let wireframe = new THREE.LineSegments(wireGeo, wireMat);
// obj.add(wireframe);

// setInterval(() => {
//     renderer.scene.clear();
// }, 2000);

/*
{
    const gridHelper = new GridHelper(128, 16);
    renderer.scene.add(gridHelper);

    const gridHelper2 = new GridHelper(128, 16);
    gridHelper2.rotation.x = 90 * (Math.PI / 180)
    renderer.scene.add(gridHelper2);

    const gridHelper3 = new GridHelper(128, 16);
    gridHelper3.rotation.z = 90 * (Math.PI / 180)
    renderer.scene.add(gridHelper3);
}
const axesHelper = new AxesHelper(64);
renderer.scene.add(axesHelper);

renderer.camera.position.set(50, 35, 50);
renderer.camera.lookAt(new Vector3(0, 0, 0))

{
    const hemiLight = new HemisphereLight( 0xffffff, 0xffffff, 0.3 );
    // hemiLight.color.setHSL( 0.6, 1, 0.6 );
    // hemiLight.groundColor.setHSL( 0.095, 1, 0.75 );
    hemiLight.position.set( 0, 256*16, 0 );
    renderer.scene.add( hemiLight );

    const hemiLightHelper = new HemisphereLightHelper( hemiLight, 10 );
    renderer.scene.add( hemiLightHelper );

    //

    const dirLight = new DirectionalLight( 0xffffff, 0.4 );
    // dirLight.color.setHSL( 0.1, 1, 0.95 );
    dirLight.position.set( - 1, 2, -1 );
    // dirLight.position.multiplyScalar( 30 );
    renderer.scene.add( dirLight );

    dirLight.castShadow = true;

    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;

    const d = 50;

    dirLight.shadow.camera.left = - d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = - d;

    dirLight.shadow.camera.far = 3500;
    dirLight.shadow.bias = - 0.0001;

    const dirLightHelper = new DirectionalLightHelper( dirLight, 10 );
    renderer.scene.add( dirLightHelper );


    const ambientLight = new AmbientLight(0xffffff, 0.5);
    renderer.scene.add(ambientLight);

    // const hemiLight = new HemisphereLight(0xffffff,0xffffff,0.8);
    // hemiLight.position.set(0, 256, 0);
    // renderer.scene.add(hemiLight);
    // renderer.scene.add(new HemisphereLightHelper(hemiLight, 10,0xff0000));

    // const pointLight = new PointLight(0xffffff, 0.8);
    // pointLight.position.set(0, 50, 0);
    // renderer.scene.add(pointLight)
    // renderer.scene.add(new PointLightHelper(pointLight, 1))
}

 */


// @ts-ignore meh.
const controls = new OrbitControls(renderer.camera, renderer.renderer.domElement);
renderer.registerEventDispatcher(controls);
controls.update();




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
    return { x: x, y: y, z: z };
}


async function sleep(timeout: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), timeout);
    });
}
