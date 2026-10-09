import type { AssetContext } from "../assets/AssetContext";

/** Shared settings passed to scene-object constructors or the scene's `addModel` and `addBlock` methods. */
export interface SceneObjectOptions {
    /** Asset configuration retained for this object and its dependent resources. */
    assets?: AssetContext;
    wireframe: boolean;
    /** Combines compatible model elements into one geometry. */
    mergeMeshes: boolean;
    /** Allows compatible models to share geometry through instance references. */
    instanceMeshes: boolean;
    /** Initial instance capacity. Buffers grow when more placements are added. */
    maxInstanceCount: number;
}
