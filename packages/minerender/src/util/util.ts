// Node ESM exposes the CommonJS crypto-js API through its default export.
import CryptoJS from "crypto-js";
import { Vector3 } from "three";

export const changeEvent = { type: 'change' as const };

export type Maybe<T> = T | undefined;

// crypto-js runs identically in both environments, so these deliberately do not go through Env -
// using it here would pull Node's `crypto` into the browser graph for no benefit.

export function md5(str: string): string {
    return CryptoJS.MD5(str).toString(CryptoJS.enc.Hex);
}

export function sha1(str: string): string {
    return CryptoJS.SHA1(str).toString(CryptoJS.enc.Hex);
}

export function sha256(str: string): string {
    return CryptoJS.SHA256(str).toString(CryptoJS.enc.Hex);
}

export function sha512(str: string): string {
    return CryptoJS.SHA512(str).toString(CryptoJS.enc.Hex);
}

export function base64encode(str: string): string {
    if (typeof btoa !== "undefined") {
        return btoa(str);
    }
    return Buffer.from(str).toString("base64");
}

export function base64decode(str: string): string {
    if (typeof atob !== "undefined") {
        return atob(str);
    }
    return Buffer.from(str, "base64").toString("ascii");
}

export function toRadians(degrees: number): number {
    return degrees * Math.PI / 180;
}

export function toDegrees(radians: number): number {
    return radians * 180 / Math.PI;
}

/** Resolves after a delay in milliseconds. */
export async function sleep(timeout: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), timeout);
    });
}

/** Yields to the next macrotask without timer clamping when the platform supports it. */
export function yieldToEventLoop(): Promise<void> {
    const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (scheduler?.yield) return scheduler.yield();
    return new Promise(resolve => {
        if (typeof MessageChannel !== "undefined") {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                channel.port1.close();
                channel.port2.close();
                resolve();
            };
            channel.port2.postMessage(undefined);
        } else {
            setTimeout(resolve, 0);
        }
    });
}

/** Reduces an angle modulo 360, retaining a negative sign for negative inputs. */
export function clampRotationDegrees(deg: number): number {
    return deg % 360;
}

export function isVector3(obj: any): obj is Vector3 {
    return (<Vector3>obj).isVector3;
}

export type DeepPartial<T> = {
    [P in keyof T]?: DeepPartial<T[P]>;
};
