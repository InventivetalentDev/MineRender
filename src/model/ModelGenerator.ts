import { Model } from "./Model";
import { BufferGeometry } from "three/src/core/BufferGeometry";
import { ImageData } from "canvas";
import { BoxGeometry, PlaneGeometry } from "three";
import { UVMapper } from "../UVMapper";
import { ModelElement } from "./ModelElement";

export class ModelGenerator {

    public static readonly ITEM_LAYERS: string[] = ["layer0", "layer1", "layer2", "layer3", "layer4"];

    public static generateItemModel(imageData: ImageData, layer: string): ModelElement[] {
        const mainElement: ModelElement = {
            from: [0,0,7.5],
            to: [16,16,8.5],
            faces: {
                "south": {
                    uv: [0,0,16,16],
                    texture: `#${layer}`
                },
                "north": {
                    uv: [16,0,0,16],
                    texture: `#${layer}`
                }
            },
            shade: true
        };
        //TODO: wrapped edges
        return [mainElement];
    }

}
