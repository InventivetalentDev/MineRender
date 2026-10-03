// `crypto-js/core` was imported separately here, but that deep path is unresolvable under Node's
// ESM loader (crypto-js has no exports map and the specifier carries no extension). The main
// entry exposes `enc` just the same.
import * as CryptoJS from "crypto-js";
import { Vector3 } from "three";

export const changeEvent = { type: 'change'};

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

export async function sleep(timeout: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => resolve(), timeout);
    });
}

export function clampRotationDegrees(deg: number): number {
    return deg % 360;
}

export function isVector3(obj: any): obj is Vector3 {
    return (<Vector3>obj).isVector3;
}

export type DeepPartial<T> = {
    [P in keyof T]?: DeepPartial<T[P]>;
};
