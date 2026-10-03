import { ArchiveProxy } from "./ArchiveProxy";
import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js";
import { ArchiveEntry } from "./ArchiveEntry";

export class BrowserArchiveProxy implements ArchiveProxy {

    readonly _blob: Blob;
    readonly _reader: ZipReader<Blob>;

    constructor(blob: Blob) {
        this._blob = blob;
        this._reader = new ZipReader(new BlobReader(this._blob));
    }

    public async getEntries(): Promise<ArchiveEntry[]> {
        return (await this._reader.getEntries()).map(e => {
            return {
                filename: e.filename,
                directory: e.directory,
                getData(): Promise<Blob> {
                    return e.getData!(new BlobWriter())
                }
            }
        })
    }

}