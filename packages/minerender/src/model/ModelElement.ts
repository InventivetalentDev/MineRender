import { TripleArray } from "./Model";
import { Axis } from "../Axis";
import { CubeFace } from "../CubeFace";
import { ElementFace } from "./ElementFace";

export interface FromTo {
    from: TripleArray;
    to: TripleArray;
}

/** A cuboid in model units, where 16 units equal one block. */
export interface ModelElement extends FromTo {
    rotation?: ElementRotation;

    shade?: boolean;

    faces: ModelFaces;

    mappedUv?: number[];
}

export type ModelFaces = Partial<Record<CubeFace, Partial<ElementFace>>>;

/** Rotates one cuboid around an origin in model units, using an angle in degrees. */
export interface ElementRotation {
    origin: TripleArray;
    axis: Axis;
    angle: number;
    rescale: boolean;
}


