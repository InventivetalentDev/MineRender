export interface ArchiveEntry {
    filename: string;
    directory: boolean;
    getData(): Promise<Blob>;
}