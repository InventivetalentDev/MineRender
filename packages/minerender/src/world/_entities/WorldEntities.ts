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
            await Promise.all(placements.map(async placement => {
                const current = () => this.columns.get(placement.column) === placement.owner;
                let object: EntityObject | undefined;
                try {
                    if (!current()) return;
                    const models = await Entities.getEntityList();
                    if (!models.includes(placement.key.path) || !current()) return;
                    const model = await Entities.getEntity(placement.key, placement.texture, { when: placement.when });
                    if (!model || !current()) return;
                    object = new EntityObject(model, { instanceMeshes: false, tints: placement.tints });
                    object.scene = this.scene;
                    // Block geometry is centered on integer coordinates; saved positions use block corners.
                    object.position.fromArray(placement.position).multiplyScalar(16).addScalar(-8);
                    object.rotation.y = placement.yaw;
                    await object.init();
                    if (!current()) return;
                    placement.owner.add(object);
                    this.scene.add(object);
                } catch (error) {
                    console.warn(`Could not draw saved entity ${placement.key.toNamespacedString()}, skipping it`, error);
                } finally {
                    if (object && !placement.owner.has(object)) object.dispose();
                }
            }));
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
