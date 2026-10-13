// Chunking keeps large inputs within the function argument limit.
const BASE64_CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
    }
    return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
    return Uint8Array.from(atob(text), character => character.charCodeAt(0));
}
