import { Entities } from "../../assets/Entities";
import { EntityObject } from "../../entity/scene/EntityObject";
import type { MultiBlockEntity } from "../../model/multiblock/MultiBlockStructure";
import type { MineRenderScene } from "../../renderer/MineRenderScene";
import { resolveSavedEntity } from "./SavedEntities";
import { BannerPatterns } from "../../assets/BannerPatterns";
import { AssetLoader } from "../../assets/AssetLoader";

/** Owns static entity placements independently of the world's block sections. */
export class WorldEntities {
    private readonly columns = new Map<string, Set<EntityObject>>();

    constructor(private readonly scene: MineRenderScene) {}

    /** Captures column ownership before asynchronous block or asset loading starts. */
    prepare(entities: readonly MultiBlockEntity[] = [], column?: [number, number]): () => Promise<void> {
        const root = AssetLoader.ROOT, scope = AssetLoader.persistentScope;
        const checkSources = () => {
            if (root !== AssetLoader.ROOT || scope !== AssetLoader.persistentScope) throw new Error("Asset sources changed while loading saved entities; retry the request");
        };
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
                    checkSources();
                    const models = await Entities.getEntityList();
                    checkSources();
                    if (!models.includes(placement.key.path) || !current()) return;
                    const model = await Entities.getEntity(placement.key, placement.texture, { when: placement.when });
                    checkSources();
                    if (!model || !current()) return;
                    let tints = placement.tints;
                    if (placement.woolDye) {
                        const dye = (await BannerPatterns.getColors(placement.key.root))[placement.woolDye];
                        checkSources();
                        // Sheep darken each dye channel; white wool has its own fixed shade.
                        const tint = placement.woolDye === "white" ? 0xe6e6e6 : (Math.floor((dye >> 16 & 255) * 0.75) << 16)
                            | (Math.floor((dye >> 8 & 255) * 0.75) << 8) | Math.floor((dye & 255) * 0.75);
                        tints = { ...tints, wool_color: tint };
                    }
                    if (!current()) return;
                    object = new EntityObject(model, { instanceMeshes: false, tints });
                    object.scene = this.scene;
                    // Block geometry is centered on integer coordinates; saved positions use block corners.
                    object.position.fromArray(placement.position).multiplyScalar(16).addScalar(-8);
                    object.rotation.y = placement.yaw;
                    await object.init();
                    checkSources();
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
