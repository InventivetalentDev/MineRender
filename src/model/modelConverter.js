import * as pako from "pako";
import * as NBT from "prismarine-nbt";
import SkinRender from "../skin/index";
import { loadBlockState } from "../functions";

/**
 * Helper to convert multi-block structures to models used by {@link ModelRender}
 * @constructor
 */
function ModelConverter() {
}

/**
 * Converts a {@link https://minecraft.gamepedia.com/Structure_block_file_format|Minecraft structure file} to models
 * @param {object} structure structure file info
 * @param {string} structure.url URL to a structure file
 * @param {(Blob|File)} structure.file uploaded file
 * @param {(Uint8Array|ArrayBuffer)} structure.raw Raw NBT data
 * @param cb
 */
ModelConverter.prototype.structureToModels = function (structure, cb) {
    loadNBT(structure).then((rawNbt) => {
        NBT.parse(rawNbt, (err, data) => {
            if (err) {
                console.warn("Error while parsing NBT data");
                console.warn(err);
                return;
            }

            if (!PRODUCTION) {
                console.log("NBT Data:")
                console.log(data);
            }

            parseStructureData(data).then((data) => {
                cb(data);
            })
        })
    })
};


/**
 * Converts a Minecraft schematic file to models
 * @param {object} schematic structure file info
 * @param {string} schematic.url URL to a structure file
 * @param {(Blob|File)} schematic.file uploaded file
 * @param {(Uint8Array|ArrayBuffer)} schematic.raw Raw NBT data
 * @param cb
 */
ModelConverter.prototype.schematicToModels = function (schematic, cb) {
    loadNBT(schematic).then(rawNbt => {
        NBT.parse(rawNbt, (err, data) => {
            if (err) {
                console.warn("Error while parsing NBT data");
                console.warn(err);
                return;
            }

            if (!PRODUCTION) {
                console.log("NBT Data:")
                console.log(data);
            }

            let xhr = new XMLHttpRequest();
            xhr.open('GET', "https://minerender.org/res/idsToNames.json", true);
            xhr.onloadend = function () {
                if (xhr.status === 200) {
                    console.log(xhr.response || xhr.responseText);

                    let idsToNames = JSON.parse(xhr.response || xhr.responseText);
                    parseSchematicData(data, idsToNames).then(data => cb(data));
                }
            };
            xhr.send();

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
                    let array = new Uint8Array(xhr.response || xhr.responseText);

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

function parseStructureData(data, paletteIndex) {
    return new Promise((resolve, reject) => {
        if (data.type === "compound") {
            if (data.value.hasOwnProperty("blocks") && (data.value.hasOwnProperty("palette") || data.value.hasOwnProperty("palettes"))) {
                let originalPalette;
                if (data.value.hasOwnProperty("palette")) {
                    originalPalette = data.value["palette"].value.value;
                } else {
                    if (typeof paletteIndex === "undefined") paletteIndex = 0;
                    if (paletteIndex >= data.value["palettes"].value.value.length || !data.value["palettes"].value.value[paletteIndex]) {
                        console.warn("Specified palette index (" + paletteIndex + ") is outside of available palettes (" + data.value["palettes"].value.value.length + ")")
                        return;
                    }
                    originalPalette = data.value["palettes"].value.value[paletteIndex].value;
                }


                // Simplify palette
                let palette = [];
                for (let i = 0; i < originalPalette.length; i++) {
                    palette.push(originalPalette[i]);
                }

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

                    let multipartConditions = {};

                    let variantString = "";
                    if (palette[blocks[i].state.value].hasOwnProperty("Properties")) {
                        let strs = [];
                        for (let p in  palette[blocks[i].state.value].Properties.value) {
                            if (palette[blocks[i].state.value].Properties.value.hasOwnProperty(p)) {
                                let prop = palette[blocks[i].state.value].Properties.value[p];

                                strs.push(p + "=" + prop.value);

                                multipartConditions[p] = prop.value;
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
                        variantString = "";
                    }

                    let block = {
                        blockstate: shortBlockType,
                        variant: variantString,
                        multipart: multipartConditions,
                        offset: [pos[0] * 16, pos[1] * 16, pos[2] * 16]
                    };
                    arr.push(block)
                }

                resolve(arr);
            } else {
                console.warn("Invalid NBT - Missing blocks/palette(s)");
                reject();
            }
        } else {
            console.warn("Invalid NBT - Root tag should be compound");
            reject();
        }
    })
}

function parseSchematicData(data, idToNameMap) {
    return new Promise((resolve, reject) => {
        let width = data.value.Width.value;
        let height = data.value.Height.value;
        let length = data.value.Length.value;

        let infoAt = function (x, y, z) {
            let index = (y * length + z) * width + x;
            return {
                id: data.value.Blocks.value[index],
                data: data.value.Data.value[index]
            }
        };

        let convertLegacy = function (id, data) {
            let mapped = idToNameMap.blocks[id + ":" + data];
            if (!mapped) {
                console.warn("Missing legacy mapping for " + id + ":" + data);
                return "minecraft:air";
            }
            return mapped;
        };

        let arr = [];

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                for (let z = 0; z < length; z++) {
                    let info = infoAt(x, y, z);
                    let convertedInfo = convertLegacy(info.id, info.data);

                    let infoSplit = convertedInfo.replace("minecraft:", "").replace("]", "").split("[");
                    let shortName = infoSplit[0];
                    let variantString = infoSplit[1] || "";

                    if (shortName === "air") continue;

                    if (variantString !== "") {
                        variantString = variantString.split(",").sort().join(",");
                    }

                    arr.push({
                        blockstate: shortName,
                        variant: variantString,
                        offset: [x * 16, y * 16, z * 16]
                    });
                }
            }
        }

        resolve(arr);
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
