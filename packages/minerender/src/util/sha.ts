import SHA1 from "crypto-js/sha1.js";
import SHA256 from "crypto-js/sha256.js";
import SHA512 from "crypto-js/sha512.js";

// Keep SHA hashes separate because only MD5 is on the render path.
export function sha1(str: string): string {
    return SHA1(str).toString();
}

export function sha256(str: string): string {
    return SHA256(str).toString();
}

export function sha512(str: string): string {
    return SHA512(str).toString();
}
