import { Entities } from "../../assets/Entities";
import { EntityObject } from "../../entity/scene/EntityObject";
import type { MultiBlockEntity } from "../../model/multiblock/MultiBlockStructure";
import type { MineRenderScene } from "../../renderer/MineRenderScene";
import { resolveSavedEntity } from "./SavedEntities";

/** Owns static entity placements independently of the world's block sections. */
export class WorldEntities {
    private readonly columns = new Map<string, Set<EntityObject>>();

    constructor(private readonly scene: MineRenderScene) {}

    /** Captures column ownership before asynchronous block or asset loading starts. */
    prepare(entities: readonly MultiBlockEntity[] = [], column?: [number, number]): () => Promise<void> {
        const placements = entities.flatMap(entity => {
            const resolved = resolveSavedEntity(entity);
            if (!resolved) return [];
            const position = [...entity.position] as MultiBlockEntity["position"];
            const key = column?.join(",") ?? `${Math.floor(position[0] / 16)},${Math.floor(position[2] / 16)}`;
            let owner = this.columns.get(key);
            if (!owner) this.columns.set(key, owner = new Set());
            return [{ ...resolved, position, column: key, owner }];
        });
        return async () => {
            const staged: { object: EntityObject; column: string; owner: Set<EntityObject> }[] = [];
            try {
                for (const placement of placements) {
                    const current = () => this.columns.get(placement.column) === placement.owner;
                    if (!current()) continue;
                    const model = await Entities.getEntity(placement.key);
                    if (!model || !current()) continue;
                    const object = new EntityObject(model, { instanceMeshes: false });
                    staged.push({ object, column: placement.column, owner: placement.owner });
                    object.scene = this.scene;
                    // Block geometry is centered on integer coordinates; saved positions use block corners.
                    object.position.fromArray(placement.position).multiplyScalar(16).addScalar(-8);
                    object.rotation.y = placement.yaw;
                    await object.init();
                }
                for (const { object, column, owner } of staged) {
                    if (this.columns.get(column) !== owner) continue;
                    owner.add(object);
                    this.scene.add(object);
                }
            } finally {
                // Failed batches and columns unloaded during a fetch never retain render resources.
                for (const { object, owner } of staged) {
                    if (!owner.has(object)) object.dispose();
                }
            }
        };
    }

    clearColumn(x: number, z: number): void {
        const key = `${x},${z}`;
        const objects = this.columns.get(key);
        this.columns.delete(key);
        if (!objects) return;
        for (const object of objects) {
            object.removeFromScene();
            object.dispose();
        }
        objects.clear();
    }

    clear(): void {
        for (const key of this.columns.keys()) {
            const [x, z] = key.split(",").map(Number);
            this.clearColumn(x, z);
        }
    }
}
