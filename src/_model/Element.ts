import { Cube } from "./Cube";
import { TripleArray } from "../model/Model";

export interface Element {
    name: string;
    parent?: string;
    pivot: TripleArray;
    rotation: TripleArray;
    cubes: Cube[];
}
