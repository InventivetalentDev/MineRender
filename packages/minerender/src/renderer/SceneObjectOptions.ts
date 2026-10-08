/** Shared settings passed to scene-object constructors or the scene's `addModel` and `addBlock` methods. */
export interface SceneObjectOptions {
    wireframe: boolean;
    /** Combines compatible model elements into one geometry. */
    mergeMeshes: boolean;
    /** Allows compatible models to share geometry through instance references. */
    instanceMeshes: boolean;
    /** Initial instance capacity. Buffers grow when more placements are added. */
    maxInstanceCount: number;
}
