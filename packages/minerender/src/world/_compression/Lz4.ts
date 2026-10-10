import { MineRenderError } from "../../error/MineRenderError";

// Anvil uses lz4-java's LZ4Block stream, not the standard LZ4 frame format.
// https://github.com/lz4/lz4-java/blob/1.8.0/src/java/net/jpountz/lz4/LZ4BlockOutputStream.java
export function decodeAnvilLz4(data: Uint8Array): Uint8Array {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const blocks: { start: number; size: number; decodedSize: number; raw: boolean; checksum: number }[] = [];
    let cursor = 0, totalSize = 0;
    while (true) {
        if (cursor + 21 > data.length) throw invalid("truncated block header or missing terminator");
        if (view.getUint32(cursor) !== 0x4c5a3442 || view.getUint32(cursor + 4) !== 0x6c6f636b) {
            throw invalid("invalid block signature");
        }
        const token = data[cursor + 8];
        const method = token & 0xf0;
        const size = view.getInt32(cursor + 9, true);
        const decodedSize = view.getInt32(cursor + 13, true);
        const checksum = view.getUint32(cursor + 17, true);
        cursor += 21;
        if (method !== 0x10 && method !== 0x20) throw invalid("unsupported block method");
        if (size < 0 || decodedSize < 0 || decodedSize > 2 ** (10 + (token & 15))
            || (size === 0) !== (decodedSize === 0) || (method === 0x10 && size !== decodedSize)) {
            throw invalid("invalid block lengths");
        }
        if (size === 0) {
            if (checksum !== 0 || cursor !== data.length) throw invalid("invalid terminator or trailing bytes");
            break;
        }
        // A length-extension byte adds at most 255 output bytes; reject impossible sizes before allocation.
        if (cursor + size > data.length || decodedSize > size * 255) throw invalid("invalid block lengths");
        blocks.push({ start: cursor, size, decodedSize, raw: method === 0x10, checksum });
        totalSize += decodedSize;
        cursor += size;
    }

    const output = new Uint8Array(totalSize);
    let offset = 0;
    for (const block of blocks) {
        const source = data.subarray(block.start, block.start + block.size);
        const target = output.subarray(offset, offset + block.decodedSize);
        if (block.raw) target.set(source);
        else decodeBlock(source, target);
        if (checksum32(target) !== block.checksum) throw invalid("block checksum mismatch");
        offset += block.decodedSize;
    }
    return output;
}

// https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md
function decodeBlock(source: Uint8Array, target: Uint8Array): void {
    let input = 0, output = 0, matched = false;
    const length = (nibble: number): number => {
        let value = nibble;
        if (value === 15) {
            let extension: number;
            do {
                if (input === source.length) throw invalid("truncated sequence length");
                extension = source[input++];
                value += extension;
            } while (extension === 255);
        }
        return value;
    };
    while (input < source.length) {
        const token = source[input++];
        const literals = length(token >>> 4);
        if (input + literals > source.length || output + literals > target.length) {
            throw invalid("literal sequence exceeds block bounds");
        }
        target.set(source.subarray(input, input + literals), output);
        input += literals;
        output += literals;
        if (input === source.length) {
            if (output !== target.length || (matched && literals < 5)) throw invalid("invalid final literal sequence");
            return;
        }
        if (input + 2 > source.length) throw invalid("truncated match offset");
        const distance = source[input] | (source[input + 1] << 8);
        input += 2;
        if (distance === 0 || distance > output) throw invalid("match offset exceeds block history");
        const count = length(token & 15) + 4;
        if (output > target.length - 12 || output + count > target.length - 5) {
            throw invalid("match exceeds block bounds");
        }
        // Forward copying lets overlapping matches repeat bytes written by the same match.
        for (let end = output + count; output < end; output++) target[output] = target[output - distance];
        matched = true;
    }
    throw invalid("missing final literal sequence");
}

// XXH32 with lz4-java's seed and its StreamingXXHash32.asChecksum() 28-bit mask.
// https://github.com/Cyan4973/xxHash/blob/dev/doc/xxhash_spec.md#xxh32-algorithm-description
function checksum32(data: Uint8Array): number {
    const prime1 = 0x9e3779b1, prime2 = 0x85ebca77, prime3 = 0xc2b2ae3d, prime4 = 0x27d4eb2f, prime5 = 0x165667b1;
    const seed = 0x9747b28c;
    const rotate = (value: number, bits: number) => (value << bits) | (value >>> (32 - bits));
    const round = (value: number, word: number) => Math.imul(rotate(value + Math.imul(word, prime2), 13), prime1);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let cursor = 0, hash: number;
    if (data.length >= 16) {
        let a = seed + prime1 + prime2, b = seed + prime2, c = seed, d = seed - prime1;
        while (cursor + 16 <= data.length) {
            a = round(a, view.getUint32(cursor, true));
            b = round(b, view.getUint32(cursor + 4, true));
            c = round(c, view.getUint32(cursor + 8, true));
            d = round(d, view.getUint32(cursor + 12, true));
            cursor += 16;
        }
        hash = rotate(a, 1) + rotate(b, 7) + rotate(c, 12) + rotate(d, 18);
    } else {
        hash = seed + prime5;
    }
    hash += data.length;
    while (cursor + 4 <= data.length) {
        hash = Math.imul(rotate(hash + Math.imul(view.getUint32(cursor, true), prime3), 17), prime4);
        cursor += 4;
    }
    while (cursor < data.length) {
        hash = Math.imul(rotate(hash + Math.imul(data[cursor++], prime5), 11), prime1);
    }
    hash = Math.imul(hash ^ (hash >>> 15), prime2);
    hash = Math.imul(hash ^ (hash >>> 13), prime3);
    return (hash ^ (hash >>> 16)) & 0x0fffffff;
}

function invalid(detail: string): MineRenderError {
    return new MineRenderError(`Invalid Anvil LZ4 stream: ${detail}`);
}
