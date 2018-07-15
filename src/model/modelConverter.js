import * as pako from "pako";
import * as NBT from "prismarine-nbt";
import SkinRender from "../skin/index";
import { loadBlockState, loadModel, loadTextures, mergeParents, renderModel } from "../renderBase";


function ModelConverter() {
}

ModelConverter.prototype.structureToModels = function (structure, cb) {
    loadNBT(structure).then((rawNbt) => {
        NBT.parse(rawNbt, (err, data) => {
            if (err) {
                console.warn("Error while parsing NBT data");
                console.warn(err);
                return;
            }

            console.log(data);

            parseStructureData(data).then((data) => {
                cb(data);
            })
        })
    })
};

function loadNBT(source) {
    return new Promise((resolve, reject) => {
        if (source.file) {
            let reader = new FileReader();
            reader.onload = function () {
                let arrayBuffer = this.result;
                let array = new Uint8Array(arrayBuffer);

                resolve(array);
            }
            reader.readAsArrayBuffer(source.file);
        } else if (source.url) {
            let xhr = new XMLHttpRequest();
            xhr.open('GET', source.url, true);
            xhr.responseType = 'arraybuffer';
            xhr.onloadend = function () {
                if (xhr.status === 200) {
                    let array = new Uint8Array(this.response);

                    resolve(array);
                }
            };
            xhr.send();
        } else if (source.raw) {
            if (source.raw instanceof Uint8Array) {
                resolve(source.raw)
            } else {
                resolve(new Uint8Array(source.raw));
            }
        } else {
            reject();
        }
    })
}

function parseStructureData(data) {
    return new Promise((resolve, reject) => {
        if (data.type === "compound") {
            if (data.value.hasOwnProperty("blocks") && data.value.hasOwnProperty("palette")) {
                // Simplify palette
                let palette = [];
                for (let i = 0; i < data.value.palette.value.value.length; i++) {
                    palette.push(data.value.palette.value.value[i]);
                }
                console.log(palette);

                let arr = [];

                // Iterate blocks
                let blocks = data.value.blocks.value.value;
                for (let i = 0; i < blocks.length; i++) {
                    let blockType = palette[blocks[i].state.value].Name.value;
                    if (blockType === "minecraft:air") {
                        // No need to add air
                        continue;
                    }
                    let shortBlockType = blockType.substr("minecraft:".length);

                    let pos = blocks[i].pos.value.value;


                    let variantString = "normal";
                    if (palette[blocks[i].state.value].hasOwnProperty("Properties")) {
                        variantString = "";

                        let strs = [];
                        for (let p in  palette[blocks[i].state.value].Properties.value) {
                            if (palette[blocks[i].state.value].Properties.value.hasOwnProperty(p)) {
                                let prop = palette[blocks[i].state.value].Properties.value[p];

                                strs.push(p + "=" + prop.value);
                            }
                        }

                        // Make sure the variants are sorted properly, or it won't match the game files
                        strs.sort();

                        for (let i = 0; i < strs.length; i++) {
                            variantString += "," + strs[i];
                        }

                        variantString = variantString.substr(1);
                    }

                    if (specialVariants.hasOwnProperty(shortBlockType)) {
                        shortBlockType = specialVariants[shortBlockType](palette[blocks[i].state.value].Properties.value);
                        variantString = "normal";
                    }

                    let block = {
                        blockstate: shortBlockType,
                        variant: variantString,
                        offset: [pos[0] * 16, pos[1] * 16, pos[2] * 16]
                    };
                    arr.push(block)
                }

                resolve(arr);
            } else {
                console.warn("Invalid NBT - Missing blocks/palette");
                reject();
            }
        } else {
            console.warn("Invalid NBT - Root tag should be compound");
            reject();
        }
    })
}

let specialVariants = {
    "stained_glass": function (properties) {
        return properties.color.value + "_stained_glass";
    },
    "planks": function (properties) {
        return properties.variant.value + "_planks";
    }
};


ModelConverter.prototype.constructor = ModelConverter;

window.ModelConverter = ModelConverter;

export default ModelConverter;