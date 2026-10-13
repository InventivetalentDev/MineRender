import type { Camera, Object3D } from "three";
import { Box3, PerspectiveCamera, Sphere, Vector3 } from "three";

export const clamp01 = (x: number): number => x < 0 ? 0 : x > 1 ? 1 : x;
export const lerp = (a: number, b: number, x: number): number => a + (b - a) * x;
/** Normalised position of t between a and b, clamped to 0–1. */
export const range = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
export const easeInOut = (x: number): number => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
export const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);
export const smooth = (t: number, a: number, b: number): number => easeInOut(range(t, a, b));

/** Opacity for something visible from `from` to `to`, fading over `fade` seconds at both ends. */
export function fade(t: number, from: number, to: number, fade = 0.4): number {
    return Math.min(range(t, from, from + fade), 1 - range(t, to - fade, to));
}

export interface OrbitPath {
    target: [number, number, number];
    radius: number;
    height: number;
    /** Start angle in radians around +Y; 0 looks from +Z. */
    angle: number;
    /** Radians per second. */
    speed: number;
}

const target = new Vector3();

/** Places the camera on a circle around the target and points it there. */
export function orbit(camera: Camera, path: OrbitPath, t: number, scale = 1): void {
    const a = path.angle + path.speed * t;
    target.set(path.target[0], path.target[1], path.target[2]);
    camera.position.set(
        target.x + Math.sin(a) * path.radius * scale,
        target.y + path.height * scale,
        target.z + Math.cos(a) * path.radius * scale
    );
    camera.lookAt(target);
}

/** One-shot actions at shot-local times, fired in order the first time t passes them. */
export class Cues {
    private readonly cues: Array<{ at: number; run: () => void; done: boolean }> = [];

    at(seconds: number, run: () => void): this {
        this.cues.push({ at: seconds, run, done: false });
        return this;
    }

    run(t: number): void {
        for (const cue of this.cues) {
            if (!cue.done && t >= cue.at) {
                cue.done = true;
                cue.run();
            }
        }
    }
}

/** Bounding sphere of an object in world space, for framing. */
export function boundingSphere(object: Object3D): Sphere {
    return new Box3().setFromObject(object).getBoundingSphere(new Sphere());
}

/**
 * Places the camera so the sphere fills the view (padding > 1 leaves room), seen from the given
 * angle around +Y and elevation above the sphere's centre.
 */
export function frameSphere(camera: PerspectiveCamera, sphere: Sphere, angle: number, elevation: number, padding = 1.2): void {
    const distance = sphere.radius * padding / Math.sin((camera.fov / 2) * Math.PI / 180);
    camera.position.set(
        sphere.center.x + Math.sin(angle) * Math.cos(elevation) * distance,
        sphere.center.y + Math.sin(elevation) * distance,
        sphere.center.z + Math.cos(angle) * Math.cos(elevation) * distance
    );
    camera.lookAt(sphere.center);
}
