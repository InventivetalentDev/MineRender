import { ArchiveEntry } from "./ArchiveEntry";

export interface ArchiveProxy {

    getEntries(): Promise<ArchiveEntry[]>;

}