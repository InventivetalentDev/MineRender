import test from "ava";
import { base64ToBytes, bytesToBase64 } from "../src/util/_internal/base64";

for (const length of [0, 1, 2, 3, 0x8000 - 1, 0x8000, 0x8000 + 1, 2 * 0x8000 + 1]) {
    test(`base64 round-trips ${length} bytes and offset views`, t => {
        const backing = Uint8Array.from({ length: length + 7 }, (_, index) => index % 256);
        for (const bytes of [backing.slice(3, 3 + length), backing.subarray(3, 3 + length)]) {
            const encoded = bytesToBase64(bytes);
            t.is(encoded, Buffer.from(bytes).toString("base64"));
            t.deepEqual(base64ToBytes(encoded), bytes);
        }
    });
}
