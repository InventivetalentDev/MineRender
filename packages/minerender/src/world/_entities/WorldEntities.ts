import { Renames } from "../../assets/Renames";
import { Entities } from "../../assets/Entities";
import { EntityObject } from "../../entity/scene/EntityObject";
import type { MultiBlockEntity } from "../../model/multiblock/MultiBlockStructure";
import type { MineRenderScene } from "../../renderer/MineRenderScene";
import { resolveSavedEntity } from "./SavedEntities";
import { BannerPatterns } from "../../assets/BannerPatterns";
import { Mesh, Raycaster, Vector3 } from "three";
import type { WorldEntityIntersection } from "../WorldEntityIntersection";
import { hitNormal, pickableMeshes, visibleHits } from "../_picking/Picking";
import { logger } from "../../util/log";

const log = logger("WorldEntities");

/** Owns static entity placements independently of the world's block sections. */
export class WorldEntities {
    private readonly columns = new Map<string, Map<EntityObject, { type: string; position: MultiBlockEntity["position"] }>>();

    constructor(private readonly scene: MineRenderScene) {}

    /** Finds the nearest visible triangle belonging to an entity owned by this world. */
    raycast(raycaster: Raycaster): WorldEntityIntersection | undefined {
        const owners = new Map<Mesh, { object: EntityObject; type: string; position: MultiBlockEntity["position"] }>();
        for (const column of this.columns.values()) {
            for (const [object, placement] of column) {
                for (const mesh of pickableMeshes(object, this.scene, raycaster)) {
                    owners.set(mesh, { object, ...placement });
                }
            }
        }
        for (const hit of visibleHits(raycaster, [...owners.keys()])) {
            const mesh = hit.object as Mesh;
            const owner = owners.get(mesh)!;
            return {
                type: owner.type,
                position: new Vector3(...owner.position),
                object: owner.object,
                point: hit.point.clone(),
                normal: hitNormal(hit),
                distance: hit.distance
            };
        }
        return undefined;
    }

    /** Captures column ownership before asynchronous block or asset loading starts. */
    prepare(entities: readonly MultiBlockEntity[] = [], column?: [number, number]): () => Promise<void> {
        const placements = entities.flatMap(entity => {
            const resolved = resolveSavedEntity(entity);
            if (!resolved) return [];
            const position = [...entity.position] as MultiBlockEntity["position"];
            const key = column?.join(",") ?? `${Math.floor(position[0] / 16)},${Math.floor(position[2] / 16)}`;
            let owner = this.columns.get(key);
            if (!owner) this.columns.set(key, owner = new Map());
            return [{ ...resolved, position, column: key, owner }];
        });
        return async () => {
            await Promise.all(placements.map(async placement => {
                const current = () => this.columns.get(placement.column) === placement.owner;
                let object: EntityObject | undefined;
                try {
                    if (!current()) return;
                    const models = await Entities.getEntityList();
                    // An ID the entity dataset does not list may be an older name for one it lists.
                    const renamed = models.includes(placement.key.path) ? undefined : await Renames.key("entities", placement.key);
                    const key = renamed && models.includes(renamed.path) ? renamed : placement.key;
                    if (!models.includes(key.path) || !current()) return;
                    const model = await Entities.getEntity(key, placement.texture, { when: placement.when });
                    if (!model || !current()) return;
                    let tints = placement.tints;
                    if (placement.woolDye) {
                        const dye = (await BannerPatterns.getColors(placement.key.root))[placement.woolDye];
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
                    if (!current()) return;
                    placement.owner.set(object, { type: key.toNamespacedString(), position: placement.position });
                    this.scene.add(object);
                } catch (error) {
                    log.warn(`Could not draw saved entity ${placement.key.toNamespacedString()}, skipping it`, error);
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
        for (const object of objects.keys()) {
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
