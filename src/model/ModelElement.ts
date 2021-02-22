import { TripleArray } from "./Model";
import { Axis } from "../Axis";
import { CubeFace } from "../CubeFace";
import { ElementFace } from "./ElementFace";

export interface ModelElement {
    from: TripleArray;
    to: TripleArray;

    rotation: ElementRotation;

    shade: boolean;

    faces: ModelFaces;
}

export type ModelFaces = Record<CubeFace, ElementFace>;

export interface ElementRotation {
    origin: TripleArray;
    axis: Axis;
    angle: number;
    rescale: boolean;
}


