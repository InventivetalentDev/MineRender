import type { Compound } from "prismarine-nbt";
import { AssetKey } from "../../assets/AssetKey";
import type { MultiBlockEntity } from "../../model/multiblock/MultiBlockStructure";

/** Resolves a saved model key and yaw; malformed records remain data only. */
export function resolveSavedEntity(entity: MultiBlockEntity): { key: AssetKey; yaw: number } | undefined {
    if (!entity || !Array.isArray(entity.position) || entity.position.length !== 3
        || ![0, 1, 2].every(index => Number.isFinite(entity.position[index]))) return undefined;
    const nbt = entity.nbt as Compound | undefined;
    if (nbt?.type !== "compound" || !nbt.value || typeof nbt.value !== "object" || Array.isArray(nbt.value)) return undefined;
    const id = nbt.value.id;
    if (id?.type !== "string" || typeof id.value !== "string") return undefined;
    const model = id.value.startsWith("minecraft:") ? id.value.slice(10) : id.value;

    let yaw = 0;
    const rotation = nbt.value.Rotation;
    if (rotation !== undefined) {
        if (rotation?.type !== "list" || !Array.isArray(rotation.value?.value)) return undefined;
        const values = rotation.value.value;
        if (values.length) {
            if ((rotation.value.type !== "float" && rotation.value.type !== "double")
                || values.length !== 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) return undefined;
            // Minecraft yaw turns from +Z towards -X; three.js rotates in the opposite direction.
            yaw = -(values[0] as number) / 180 * Math.PI;
        }
    }
    return { key: new AssetKey("minecraft", model), yaw };
}
