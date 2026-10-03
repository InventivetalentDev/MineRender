import { TripleArray } from "../model/Model";
import { Face } from "./Face";

export interface Cube {
    origin: TripleArray;
    size: TripleArray;
    rotation: TripleArray;
    faces: { [side: string]: Face };
}
