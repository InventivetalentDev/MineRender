import { TripleArray } from "./Model";
import { Axis } from "../Axis";
import { CubeFace } from "../CubeFace";
import { ElementFace } from "./ElementFace";

export interface FromTo {
    from: TripleArray;
    to: TripleArray;
}

export interface ModelElement extends FromTo {
    rotation: ElementRotation;

    shade: boolean;

    faces: ModelFaces;
}

export type ModelFaces = Record<CubeFace, Partial<ElementFace>>;

export interface ElementRotation {
    origin: TripleArray;
    axis: Axis;
    angle: number;
    rescale: boolean;
}


