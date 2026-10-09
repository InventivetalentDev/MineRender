import type { Compound } from "prismarine-nbt";
import { AssetKey } from "../../assets/AssetKey";
import type { MultiBlockEntity } from "../../model/multiblock/MultiBlockStructure";

// These mob IDs have a matching adult/default model in the entity dataset.
const MODELS = new Set([
    "allay", "armadillo", "axolotl", "bat", "bee", "blaze", "bogged", "breeze", "camel", "cat",
    "cave_spider", "chicken", "cod", "copper_golem", "cow", "creaking", "creeper", "dolphin", "donkey",
    "drowned", "elder_guardian", "enderman", "endermite", "evoker", "fox", "frog", "ghast", "giant",
    "glow_squid", "goat", "guardian", "happy_ghast", "hoglin", "horse", "husk", "illusioner", "iron_golem",
    "llama", "magma_cube", "mooshroom", "mule", "nautilus", "ocelot", "panda", "parched", "parrot",
    "phantom", "pig", "piglin", "piglin_brute", "pillager", "polar_bear", "rabbit", "ravager", "salmon",
    "sheep", "silverfish", "skeleton", "skeleton_horse", "slime", "sniffer", "snow_golem", "spider", "squid",
    "stray", "strider", "tadpole", "trader_llama", "turtle", "vex", "villager", "vindicator",
    "wandering_trader", "warden", "witch", "wither", "wither_skeleton", "wolf", "zoglin", "zombie",
    "zombie_horse", "zombie_nautilus", "zombie_villager", "zombified_piglin"
]);

/** Selects a default mob model and saved yaw; unsupported or malformed records remain data only. */
export function resolveSavedEntity(entity: MultiBlockEntity): { key: AssetKey; yaw: number } | undefined {
    if (!entity || !Array.isArray(entity.position) || entity.position.length !== 3
        || ![0, 1, 2].every(index => Number.isFinite(entity.position[index])
            && Number.isFinite(entity.position[index] * 16))) return undefined;
    const nbt = entity.nbt as Compound | undefined;
    if (nbt?.type !== "compound" || !nbt.value || typeof nbt.value !== "object" || Array.isArray(nbt.value)) return undefined;
    const id = nbt.value.id;
    if (id?.type !== "string" || typeof id.value !== "string") return undefined;
    const model = id.value.startsWith("minecraft:") ? id.value.slice(10) : id.value;
    if (!MODELS.has(model)) return undefined;

    let yaw = 0;
    const rotation = nbt.value.Rotation;
    if (rotation !== undefined) {
        if (rotation?.type !== "list" || !Array.isArray(rotation.value?.value)) return undefined;
        const values = rotation.value.value;
        if (values.length) {
            if ((rotation.value.type !== "float" && rotation.value.type !== "double")
                || values.length !== 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) return undefined;
            // Minecraft yaw turns from +Z towards -X; three.js rotates in the opposite direction.
            yaw = values[0] === 0 ? 0 : -(values[0] as number) / 180 * Math.PI;
        }
    }
    return { key: new AssetKey("minecraft", model), yaw };
}
