import { Euler, Vector3 } from "three";
import type { Object3D } from "three";
import { ENTITY_ANIMATION_CHANNELS, EntityAnimation, sampleEntityAnimation } from "../EntityAnimation";
import type { EntityAnimationPose } from "../EntityAnimation";
import type { EntityModelPart } from "../EntityModel";

/** Playback settings passed to {@link EntityObject.playAnimation}, {@link EntityObject.playAnimations}, or {@link EntityAnimationPlayer.play}. */
export interface EntityAnimationOptions {
    /** Overrides the animation's own `loop` flag. */
    loop?: boolean;
    /** Playback rate applied to advanced time; defaults to 1. */
    speed?: number;
    /** Start time in seconds; defaults to 0. */
    time?: number;
    /** Nonnegative finite weights in clip order; defaults to 1 per clip. Offsets add without normalizing weights. */
    weights?: readonly number[];
}

const ZERO: readonly number[] = [0, 0, 0];

interface AnimatedPart {
    bone: string;
    object: Object3D;
    position: Vector3;
    rotation: Euler;
    scale: Vector3;
    basePosition: Vector3;
    baseRotation: Euler;
    baseScale: Vector3;
}

/**
 * Poses part groups from keyframe animations: every update restores the default pose of each
 * animated part, then adds weighted sampled offsets to its position, Euler angles and scale.
 * It owns no timer; the owner advances it.
 */
export class EntityAnimationPlayer {

    private parts: AnimatedPart[] = [];
    private _animations: EntityAnimation[] = [];
    private _weights: number[] = [];
    private loops: boolean[] = [];
    private _time = 0;
    private speed = 1;

    get animation(): EntityAnimation | undefined {
        return this._animations[0];
    }

    get animations(): readonly EntityAnimation[] {
        return this._animations.slice();
    }

    get weights(): readonly number[] {
        return this._weights.slice();
    }

    get time(): number {
        return this._time;
    }

    /**
     * Starts an animation on matching named parts. Supplied baked poses are the baseline for offsets;
     * without them, the current pose is used. Stopping restores the pose from before playback.
     */
    play(layers: Object3D[], animation: EntityAnimation, options: EntityAnimationOptions = {},
         poses?: ReadonlyMap<Object3D, EntityModelPart["pose"]>): void {
        this.playAnimations(layers, [animation], options, poses);
    }

    /**
     * Starts clips on matching parts with a shared clock. Weighted offsets add to the supplied baked poses
     * or, without poses, to each animated part's pose when playback starts.
     */
    playAnimations(layers: Object3D[], animations: readonly EntityAnimation[], options: EntityAnimationOptions = {},
                   poses?: ReadonlyMap<Object3D, EntityModelPart["pose"]>): void {
        const weights = validateAnimationWeights(options.weights ?? animations.map(() => 1), animations.length);
        this.stop();
        this._animations = animations.slice();
        this._weights = weights;
        if (!animations.length) return;
        this._time = options.time ?? 0;
        this.loops = animations.map(animation => options.loop ?? animation.loop);
        this.speed = options.speed ?? 1;
        for (const layer of layers) {
            const objects: Object3D[] = [];
            if (poses) {
                layer.traverse(object => { if (poses.has(object)) objects.push(object); });
            } else {
                const bones = new Set(animations.flatMap(animation => Object.keys(animation.bones)));
                for (const bone of bones) {
                    const object = layer.getObjectByName(`group:${bone}`);
                    if (object) objects.push(object);
                }
            }
            for (const object of objects) {
                const bone = object.name.slice("group:".length);
                const pose = poses?.get(object);
                this.parts.push({
                    bone, object, position: object.position.clone(), rotation: object.rotation.clone(), scale: object.scale.clone(),
                    basePosition: pose ? new Vector3(...pose.offset) : object.position.clone(),
                    baseRotation: pose ? new Euler(...pose.rotation, "ZYX") : object.rotation.clone(),
                    baseScale: pose ? new Vector3(...(pose.scale ?? [1, 1, 1])) : object.scale.clone()
                });
            }
        }
        this.apply();
    }

    /** Restores the poses from before playback. Returns whether an animation was active. */
    stop(): boolean {
        if (!this._animations.length) return false;
        for (const part of this.parts) {
            part.object.position.copy(part.position);
            part.object.rotation.copy(part.rotation);
            part.object.scale.copy(part.scale);
        }
        this.clear();
        return true;
    }

    /** Forgets the animation without touching the parts, for parts that no longer exist. */
    clear(): void {
        this.parts = [];
        this._animations = [];
        this._weights = [];
        this.loops = [];
        this._time = 0;
    }

    /** Applies the pose at an absolute playback time. Returns `false` when no clip is active. */
    setTime(seconds: number): boolean {
        if (!this._animations.length) return false;
        this._time = seconds;
        this.apply();
        return true;
    }

    /** Advances playback by elapsed seconds multiplied by the speed passed to {@link play}. */
    advance(deltaSeconds: number): boolean {
        return this.setTime(this._time + deltaSeconds * this.speed);
    }

    /** Changes weights in clip order and reapplies the current time without restarting playback. */
    setWeights(weights: readonly number[]): boolean {
        if (!this._animations.length) return false;
        const validated = validateAnimationWeights(weights, this._animations.length);
        this._weights = validated;
        this.apply();
        return true;
    }

    private apply(): void {
        const pose: EntityAnimationPose = Object.create(null);
        for (let i = 0; i < this._animations.length; i++) {
            const weight = this._weights[i];
            if (weight === 0) continue;
            const sampled = sampleEntityAnimation(this._animations[i], this._time, this.loops[i]);
            for (const [bone, channels] of Object.entries(sampled)) {
                const blended = pose[bone] ??= {};
                for (const channel of ENTITY_ANIMATION_CHANNELS) {
                    const value = channels[channel];
                    if (!value) continue;
                    const target = blended[channel] ??= [0, 0, 0];
                    for (let axis = 0; axis < 3; axis++) target[axis] += value[axis] * weight;
                }
            }
        }
        for (const part of this.parts) {
            const { position = ZERO, rotation = ZERO, scale = ZERO } = pose[part.bone] ?? {};
            part.object.position.set(part.basePosition.x + position[0], part.basePosition.y + position[1], part.basePosition.z + position[2]);
            // Vanilla adds to the Euler angles themselves, so the part keeps its rotation order.
            part.object.rotation.set(part.baseRotation.x + rotation[0], part.baseRotation.y + rotation[1], part.baseRotation.z + rotation[2], part.baseRotation.order);
            part.object.scale.set(part.baseScale.x + scale[0], part.baseScale.y + scale[1], part.baseScale.z + scale[2]);
        }
    }

}

/** @internal */
export function validateAnimationWeights(weights: readonly number[], count: number): number[] {
    const values = Array.from(weights);
    if (values.length !== count || values.some(weight => !Number.isFinite(weight) || weight < 0)) {
        throw new Error("Animation weights must match the clip count and contain only finite nonnegative numbers");
    }
    return values;
}
