import type { Vector3 } from "three";
import type { Block } from "../model/block/Block";

/** The nearest rendered block triangle hit by a world raycast. */
export interface WorldBlockIntersection {
    /** Integer world block coordinates of the geometry's owner. */
    position: Vector3;
    /** Detached block data; use world setters to change the block. */
    block: Block;
    /** Hit position in scene units. */
    point: Vector3;
    /** Unit face normal in scene space. Sloped and rotated faces retain their geometric normal. */
    normal: Vector3;
    /** Distance from the ray origin, in scene units. */
    distance: number;
}
