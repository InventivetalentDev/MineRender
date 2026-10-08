/** A resource-pack ZIP entry, with its archive-relative path and lazily extracted bytes. */
export interface ArchiveEntry {
    filename: string;
    directory: boolean;
    getData(): Promise<Blob>;
}