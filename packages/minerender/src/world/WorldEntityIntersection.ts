import type { Vector3 } from "three";
import type { EntityObject } from "../entity/scene/EntityObject";

/** The nearest rendered mob triangle hit by a world entity raycast. */
export interface WorldEntityIntersection {
    /** Minecraft entity ID, such as minecraft:pig. */
    type: string;
    /** Copied saved position in Minecraft block units, including fractional coordinates. */
    position: Vector3;
    /** Live rendered root, removed and disposed when its column unloads or the world clears. */
    object: EntityObject;
    /** Hit position in scene units. */
    point: Vector3;
    /** Unit face normal in scene space. */
    normal: Vector3;
    /** Distance from the ray origin, in scene units. */
    distance: number;
}
