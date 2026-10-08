import { ArchiveProxy } from "./ArchiveProxy";
import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js";
import { ArchiveEntry } from "./ArchiveEntry";

/** Reads a resource-pack ZIP from a browser Blob or File for {@link ArchiveAssetSource}. */
export class BrowserArchiveProxy implements ArchiveProxy {

    readonly _blob: Blob;
    readonly _reader: ZipReader<Blob>;
    readonly id?: string;

    /**
     * Opens a ZIP for asset lookup.
     * @param id - Cache identity for this content. Change it when the pack changes.
     * A File supplies an identity from its name, size, and modification time when omitted.
     */
    constructor(blob: Blob, id?: string) {
        this._blob = blob;
        this._reader = new ZipReader(new BlobReader(this._blob));
        // A File's name, size, and modification time identify a pack well enough across reloads.
        this.id = id ?? (typeof File !== "undefined" && blob instanceof File
            ? `${blob.name}:${blob.size}:${blob.lastModified}` : undefined);
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