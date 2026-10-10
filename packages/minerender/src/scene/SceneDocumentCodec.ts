import { parseSceneDocument, type SceneDocument } from "./SceneDocument";

/** Maximum UTF-8 JSON size and compressed size for a scene link. */
export const SCENE_DOCUMENT_MAX_BYTES = 1024 * 1024;

async function readBounded(stream: ReadableStream<Uint8Array>, label: string): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > SCENE_DOCUMENT_MAX_BYTES) throw new RangeError(`${label} exceeds ${SCENE_DOCUMENT_MAX_BYTES} bytes`);
            chunks.push(value);
        }
    } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Validates a scene and encodes its UTF-8 JSON as `v1.<unpadded base64url>`, using zlib-wrapped deflate. */
export async function encodeSceneDocument(value: unknown): Promise<string> {
    const scene = parseSceneDocument(value);
    const bytes = new TextEncoder().encode(JSON.stringify(scene));
    if (bytes.byteLength > SCENE_DOCUMENT_MAX_BYTES) {
        throw new RangeError(`Scene document exceeds ${SCENE_DOCUMENT_MAX_BYTES} bytes`);
    }
    const compressed = await readBounded(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate")), "Encoded scene");
    return `v1.${encodeBase64(compressed)}`;
}

/** Decodes and validates a scene link, limiting compressed input and decompressed JSON to SCENE_DOCUMENT_MAX_BYTES. */
export async function decodeSceneDocument(value: string): Promise<SceneDocument> {
    if (!value.startsWith("v1.")) throw new Error("Unsupported scene encoding version; expected v1");
    const encoded = value.slice(3);
    if (encoded.length > Math.ceil(SCENE_DOCUMENT_MAX_BYTES * 4 / 3)) {
        throw new RangeError(`Encoded scene exceeds ${SCENE_DOCUMENT_MAX_BYTES} bytes`);
    }
    if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) {
        throw new Error("Invalid scene base64url encoding");
    }
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const compressed = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (encodeBase64(compressed) !== encoded) throw new Error("Invalid scene base64url encoding");
    let bytes: Uint8Array;
    try {
        bytes = await readBounded(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate")), "Scene document");
    } catch (error) {
        if (error instanceof RangeError) throw error;
        throw new Error("Invalid compressed scene document");
    }
    let json: string;
    try { json = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("Invalid UTF-8 scene document"); }
    return parseSceneDocument(json);
}
