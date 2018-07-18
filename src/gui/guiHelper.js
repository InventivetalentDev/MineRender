import guiPositions from "./guiPositions";

/**
 * Helper functions for GUI creation
 */
const guiHelper = {
    addPos: function (arr1, arr2, a) {
        if (arr1.length === 2 && arr2.length === 2) {
            if (!a || a === "xy") {
                return [arr1[0] + arr2[0], arr1[1] + arr2[1]];
            }
            if (a === "x") {
                return [arr1[0] + arr2[0], arr1[1]];
            }
            if (a === "y") {
                return [arr1[0], arr1[1] + arr2[1]];
            }
        }
    },
    subtractPos: function (arr1, arr2, a) {
        if (arr1.length === 2 && arr2.length === 2) {
            if (!a || a === "xy") {
                return [arr1[0] - arr2[0], arr1[1] - arr2[1]];
            }
            if (a === "x") {
                return [arr1[0] - arr2[0], arr1[1]];
            }
            if (a === "y") {
                return [arr1[0], arr1[1] - arr2[1]];
            }
        }
    },
    multiplyPos: function (arr1, n, a) {
        if (arr1.length === 2) {
            if (!a || a === "xy") {
                return [arr1[0] * n, arr1[1] * n];
            }
            if (a === "x") {
                return [arr1[0] * n, arr1[1]];
            }
            if (a === "y") {
                return [arr1[0], arr1[1] * n];
            }
        }
    },

    inventorySlot: function (n, origin, offset, rowSize) {
        if (!rowSize) rowSize = 9;
        let row, col;

        if (n instanceof Array) {
            row = n[1];
            col = n[0];
        } else {
            row = Math.floor(n / rowSize);
            col = n % rowSize;
        }

        let x = origin[0] + (col * offset[0]);
        let y = origin[1] + (row * offset[1]);

        return [x, y];
    },
    recipe: function (recipeData, textureMap) {

        let renderData = [];
        renderData.push({
            name: "base",
            texture: "/gui/container/crafting_table",
            layer: 0,
            uv: guiPositions.container.crafting_table.uv,
            pos: [0, 0]
        });

        if (recipeData.type === "crafting_shaped") {
            let pattern = recipeData.pattern;
            for (let l = 0; l < pattern.length; l++) {
                let line = pattern[l];
                for (let c = 0; c < line.length; c++) {
                    let char = line[c];
                    if (char === ' ') continue;
                    if (!recipeData.key.hasOwnProperty(char)) {
                        console.warn("Missing recipe key " + char);
                        continue;
                    }

                    let slot = this.inventorySlot([c, l], guiPositions.container.crafting_table.left_origin, guiPositions.container.crafting_table.item_offset, 3);
                    let item = recipeData.key[char].item;
                    let itemSplit = item.split(":");
                    let itemNamespace = itemSplit[0];
                    let itemName = itemSplit[1];

                    if (textureMap.hasOwnProperty(itemName)) {
                        itemName = textureMap[itemName];
                    } else {
                        itemName = "/item/" + itemName;
                    }

                    renderData.push({
                        name: item,
                        texture: itemName,
                        layer: 1,
                        pos: slot
                    });
                }
            }
        } else if (recipeData.type === "crafting_shapeless") {
            for (let i = 0; i < recipeData.ingredients.length; i++) {
                let ingredient = recipeData.ingredients[i];

                let slot = this.inventorySlot(i, guiPositions.container.crafting_table.left_origin, guiPositions.container.crafting_table.item_offset, 3);
                let item = ingredient.item;
                let itemSplit = item.split(":");
                let itemNamespace = itemSplit[0];
                let itemName = itemSplit[1];

                if (textureMap.hasOwnProperty(itemName)) {
                    itemName = textureMap[itemName];
                } else {
                    itemName = "/item/" + itemName;
                }

                renderData.push({
                    name: item,
                    texture: itemName,
                    layer: 1,
                    pos: slot
                });
            }
        }

        let resultItem = recipeData.result.item;
        let itemSplit = resultItem.split(":");
        let itemNamespace = itemSplit[0];
        let itemName = itemSplit[1];
        if (textureMap.hasOwnProperty(itemName)) {
            itemName = textureMap[itemName];
        } else {
            itemName = "/item/" + itemName;
        }

        renderData.push({
            name: resultItem,
            texture: itemName,
            layer: 1,
            pos: guiPositions.container.crafting_table.right_origin
        });


        return renderData;
    }
};

export default guiHelper;