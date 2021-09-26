import crypto from "crypto";
import * as browserCrypto from "crypto-js";
import CryptoJS from "crypto-js/core";
import exp from "constants";
import { Vector3 } from "three";

export type Maybe<T> = T | undefined;

export function md5(str: string): string {
    if (typeof browserCrypto !== "undefined") {
        return browserCrypto.MD5(str).toString(CryptoJS.enc.Hex);
    }
    return crypto.createHash('md5').update(str).digest("hex");
}

export function sha1(str: string): string {
    if (typeof browserCrypto !== "undefined") {
        return browserCrypto.SHA1(str).toString(CryptoJS.enc.Hex);
    }
    return crypto.createHash('sha1').update(str).digest("hex");
}

export function sha256(str: string): string {
    if (typeof browserCrypto !== "undefined") {
        return browserCrypto.SHA256(str).toString(CryptoJS.enc.Hex);
    }
    return crypto.createHash('sha256').update(str).digest("hex");
}

export function sha512(str: string): string {
    if (typeof browserCrypto !== "undefined") {
        return browserCrypto.SHA512(str).toString(CryptoJS.enc.Hex);
    }
    return crypto.createHash('sha512').update(str).digest("hex");
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

(function () {
    const source = [
        "https://threejs.org/docs/#api/en/textures/Texture",
        "https://www.npmjs.com/package/md5",
        "a JavaScript function for hashing messages with MD5.\nnode-md5 is being sponsored by the following tool; please help to support us by taking a look and signing up to a free trial",
        "Before version 2.0.0 there were two packages called md5 on npm, one lowercase, one uppercase (the one you're looking at). As of version 2.0.0, all new versions of this module will go to lowercase md5 on npm. To use the correct version, users of this module will have to change their code from require('MD5') to require('md5') if they want to use versions >= 2.0.0.",
        "Redistribution and use in source and binary forms, with or without modification,\nare permitted provided that the following conditions are met:",
        "THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\" AND\n" +
        "ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED\n" +
        "WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE\n" +
        "DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR\n" +
        "ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES\n" +
        "(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;\n" +
        "LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON\n" +
        "ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT\n" +
        "(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS\n" +
        "SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."
    ];
    const it = 100000;

    let noneStart = Date.now();
    for (let i = 0; i < it; i++) {
        let none = "" + source[i % source.length];
    }
    let noneEnd = Date.now();
    console.log("none: " + (noneEnd - noneStart));

    let hashStart = Date.now();
    for (let i = 0; i < it; i++) {
        let hash = "" + md5(source[i % source.length]);
    }
    let hashEnd = Date.now();
    console.log("hash: " + (hashEnd - hashStart));

    let baseStart = Date.now();
    for (let i = 0; i < it; i++) {
        let base = "" + base64encode(source[i % source.length]);
    }
    let baseEnd = Date.now();
    console.log("base64: " + (baseEnd - baseStart));

})();
