import { Euler, Vector3 } from "three";
import type { Object3D } from "three";
import { EntityAnimation, sampleEntityAnimation } from "../EntityAnimation";

export interface EntityAnimationOptions {
    /** Overrides the animation's own `loop` flag. */
    loop?: boolean;
    /** Playback rate applied to advanced time; defaults to 1. */
    speed?: number;
    /** Start time in seconds; defaults to 0. */
    time?: number;
}

const ZERO: readonly number[] = [0, 0, 0];

interface AnimatedPart {
    bone: string;
    object: Object3D;
    position: Vector3;
    rotation: Euler;
    scale: Vector3;
}

/**
 * Poses part groups from a keyframe animation the way vanilla does: every update restores the
 * default pose of each animated part, then adds the sampled offsets to its position, Euler angles and scale.
 * It owns no timer; the owner advances it.
 */
export class EntityAnimationPlayer {

    private parts: AnimatedPart[] = [];
    private _animation?: EntityAnimation;
    private _time = 0;
    private loop = false;
    private speed = 1;

    get animation(): EntityAnimation | undefined {
        return this._animation;
    }

    get time(): number {
        return this._time;
    }

    /**
     * Starts an animation on the named parts below each layer root. The current pose of a part becomes its default;
     * bones without a matching part are skipped.
     */
    play(layers: Object3D[], animation: EntityAnimation, options: EntityAnimationOptions = {}): void {
        this.stop();
        this._animation = animation;
        this._time = options.time ?? 0;
        this.loop = options.loop ?? animation.loop;
        this.speed = options.speed ?? 1;
        for (const layer of layers) {
            for (const bone of Object.keys(animation.bones)) {
                const object = layer.getObjectByName(`group:${ bone }`);
                if (!object) continue;
                this.parts.push({ bone, object, position: object.position.clone(), rotation: object.rotation.clone(), scale: object.scale.clone() });
            }
        }
        this.apply();
    }

    /** Restores the default poses. Returns whether an animation was active. */
    stop(): boolean {
        if (!this._animation) return false;
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
        this._animation = undefined;
        this._time = 0;
    }

    setTime(seconds: number): boolean {
        if (!this._animation) return false;
        this._time = seconds;
        this.apply();
        return true;
    }

    advance(deltaSeconds: number): boolean {
        return this.setTime(this._time + deltaSeconds * this.speed);
    }

    private apply(): void {
        const pose = sampleEntityAnimation(this._animation!, this._time, this.loop);
        for (const part of this.parts) {
            const { position = ZERO, rotation = ZERO, scale = ZERO } = pose[part.bone];
            part.object.position.set(part.position.x + position[0], part.position.y + position[1], part.position.z + position[2]);
            // Vanilla adds to the Euler angles themselves, so the part keeps its rotation order.
            part.object.rotation.set(part.rotation.x + rotation[0], part.rotation.y + rotation[1], part.rotation.z + rotation[2], part.rotation.order);
            part.object.scale.set(part.scale.x + scale[0], part.scale.y + scale[1], part.scale.z + scale[2]);
        }
    }

}
