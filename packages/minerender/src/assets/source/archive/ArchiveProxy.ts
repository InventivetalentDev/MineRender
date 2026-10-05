import { ArchiveEntry } from "./ArchiveEntry";

export interface ArchiveProxy {

    /** Identifies the archive's content across sessions; undefined when it cannot be identified. */
    readonly id?: string;

    getEntries(): Promise<ArchiveEntry[]>;

}