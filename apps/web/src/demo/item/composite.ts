import { ArchiveAssetSource } from "minerender";

export const COMPOSITE_ITEM = "minerender_demo:composite";

const pieces = [
    { name: "red", from: [0, 0, 4], to: [6, 10, 12], color: 0xd64b4b },
    { name: "green", from: [7, 0, 4], to: [13, 16, 12], color: 0x64b85b },
    { name: "blue", from: [14, 0, 4], to: [20, 7, 12], color: 0x5b8cdb }
];
const children = pieces.map(piece => ({
    type: "minecraft:model", model: `minerender_demo:item/${piece.name}`,
    tints: [{ type: "minecraft:constant", value: piece.color }]
}));
const assets = {
    "assets/minerender_demo/items/composite.json": {
        model: { type: "minecraft:composite", models: [children[0], { type: "minecraft:composite", models: children.slice(1) }] }
    },
    ...Object.fromEntries(pieces.map(piece => [`assets/minerender_demo/models/item/${piece.name}.json`, {
        textures: { all: "minecraft:block/white_concrete" },
        gui_light: "front",
        elements: [{ from: piece.from, to: piece.to, faces: Object.fromEntries(
            ["east", "west", "up", "down", "south", "north"].map(face => [face, { texture: "#all", tintindex: 0 }])) }],
        display: { gui: { rotation: [30, 225, 0], scale: [0.625, 0.625, 0.625] } }
    }]))
};

export function compositeSource(): ArchiveAssetSource {
    return new ArchiveAssetSource({
        id: "minerender-composite-demo-v1",
        getEntries: async () => Object.entries(assets).map(([filename, asset]) => ({
            filename, directory: false, getData: async () => new Blob([JSON.stringify(asset)])
        }))
    });
}

export function compositeSourceCode(): string {
    return `const assets = ${JSON.stringify(assets, null, 2)};
MineRender.AssetLoader.addSource("composite-demo", new MineRender.ArchiveAssetSource({
    getEntries: async () => Object.entries(assets).map(([filename, asset]) => ({
        filename, directory: false, getData: async () => new Blob([JSON.stringify(asset)])
    }))
}));\n`;
}
