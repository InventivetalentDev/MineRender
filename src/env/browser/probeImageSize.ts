import type { ImageSizeInfo } from "../../Env";

/**
 * Minimal replacement for `image-size` that works in a browser.
 *
 * `image-size` pulls in `fs`/`path` at module scope, so it can only live in the Node build.
 * Everything MineRender loads is a PNG in practice; GIF and JPEG are handled as a courtesy and
 * anything else falls through to an empty result (callers treat that as 0x0).
 */
export function probeImageSize(data: Uint8Array): ImageSizeInfo {
    if (data.length < 10) {
        return {};
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // PNG - 8 byte signature, then an IHDR chunk whose width/height are big-endian uint32.
    // The IHDR name is checked as well so this agrees with image-size (the Node implementation)
    // about what counts as a PNG rather than trusting the signature alone.
    if (data.length >= 24 &&
        data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
        data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a &&
        data[12] === 0x49 && data[13] === 0x48 && data[14] === 0x44 && data[15] === 0x52) {
        return {
            width: view.getUint32(16, false),
            height: view.getUint32(20, false),
            type: "png"
        };
    }

    // GIF - "GIF87a"/"GIF89a", then little-endian uint16 width/height
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
        return {
            width: view.getUint16(6, true),
            height: view.getUint16(8, true),
            type: "gif"
        };
    }

    // JPEG - walk the segment markers until a start-of-frame carries the dimensions
    if (data[0] === 0xff && data[1] === 0xd8) {
        let offset = 2;
        while (offset + 9 < data.length) {
            if (data[offset] !== 0xff) {
                offset++;
                continue;
            }
            const marker = data[offset + 1];
            // SOFn, excluding DHT (0xc4), JPG (0xc8) and DAC (0xcc)
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return {
                    height: view.getUint16(offset + 5, false),
                    width: view.getUint16(offset + 7, false),
                    type: "jpg"
                };
            }
            const segmentLength = view.getUint16(offset + 2, false);
            if (segmentLength < 2) {
                break;
            }
            offset += 2 + segmentLength;
        }
    }

    return {};
}
