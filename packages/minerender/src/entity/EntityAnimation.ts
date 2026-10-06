import type { MinecraftAsset } from "../MinecraftAsset";
import type { TripleArray } from "../model/Model";

/** `entity-models/animations/<namespace>/<model id>.json`: native and sampled vanilla animation clips. */
export interface EntityAnimationFile extends MinecraftAsset {
    id: string;
    animations: Record<string, EntityAnimation>;
}

export interface EntityAnimation {
    /** Seconds. */
    length: number;
    loop: boolean;
    /** Geometry layer targeted by this clip; defaults to `main`. */
    layer?: string;
    /** Part name anywhere in a layer; `root` is the layer's root part. */
    bones: Record<string, EntityAnimationBone>;
}

export type EntityAnimationChannel = "position" | "rotation" | "scale";

/** Keyframes in time order per channel. */
export type EntityAnimationBone = Partial<Record<EntityAnimationChannel, EntityAnimationKeyframe[]>>;

export interface EntityAnimationKeyframe {
    /** Seconds. */
    time: number;
    /** Offset from the default pose: model units, radians, or scale minus one. */
    value: TripleArray;
    /** Value to arrive at when it differs from `value`; linear interpolation only. */
    pre?: TripleArray;
    /** Applies between the previous keyframe and this one. */
    interpolation: "linear" | "catmullrom";
}

/** Sampled offsets from the default pose, per bone and channel. */
export type EntityAnimationPose = Record<string, Partial<Record<EntityAnimationChannel, TripleArray>>>;

export const ENTITY_ANIMATION_CHANNELS: readonly EntityAnimationChannel[] = ["position", "rotation", "scale"];

function catmullRom(delta: number, p0: number, p1: number, p2: number, p3: number): number {
    return 0.5 * (2 * p1 + (p2 - p0) * delta
        + (2 * p0 - 5 * p1 + 4 * p2 - p3) * delta * delta
        + (3 * p1 - p0 - 3 * p2 + p3) * delta * delta * delta);
}

/**
 * Samples one channel like vanilla's `KeyframeAnimation.Entry`: the first value holds before the
 * first keyframe and the last value after the last one; in between, the later keyframe selects the interpolation.
 */
export function sampleEntityKeyframes(keyframes: readonly EntityAnimationKeyframe[], time: number): TripleArray {
    if (keyframes.length === 0) return [0, 0, 0];
    // Index of the first keyframe after `time`; a jump takes effect at its exact timestamp.
    let low = 0, high = keyframes.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (time < keyframes[middle].time) high = middle;
        else low = middle + 1;
    }
    const a = Math.max(0, low - 1);
    const b = Math.min(keyframes.length - 1, a + 1);
    const from = keyframes[a];
    const to = keyframes[b];
    const delta = a === b ? 0 : Math.min(1, Math.max(0, (time - from.time) / (to.time - from.time)));
    if (to.interpolation === "catmullrom") {
        const before = keyframes[Math.max(0, a - 1)].value;
        const after = keyframes[Math.min(keyframes.length - 1, b + 1)].value;
        return [0, 1, 2].map(i => catmullRom(delta, before[i], from.value[i], to.value[i], after[i])) as TripleArray;
    }
    const target = to.pre ?? to.value;
    return [0, 1, 2].map(i => from.value[i] + (target[i] - from.value[i]) * delta) as TripleArray;
}

/** Elapsed seconds within the animation: modulo `length` when looping, as vanilla does. */
export function entityAnimationTime(animation: EntityAnimation, time: number, loop: boolean = animation.loop): number {
    return loop && animation.length > 0 ? time % animation.length : time;
}

/** Samples every bone and channel of an animation at `time` seconds. */
export function sampleEntityAnimation(animation: EntityAnimation, time: number, loop: boolean = animation.loop): EntityAnimationPose {
    const elapsed = entityAnimationTime(animation, time, loop);
    const pose: EntityAnimationPose = {};
    for (const [name, bone] of Object.entries(animation.bones)) {
        const sampled: EntityAnimationPose[string] = pose[name] = {};
        for (const channel of ENTITY_ANIMATION_CHANNELS) {
            const keyframes = bone[channel];
            if (keyframes?.length) sampled[channel] = sampleEntityKeyframes(keyframes, elapsed);
        }
    }
    return pose;
}
