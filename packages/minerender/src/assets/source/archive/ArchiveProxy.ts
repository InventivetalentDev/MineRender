import { ArchiveEntry } from "./ArchiveEntry";

/** Supplies resource-pack entries to {@link ArchiveAssetSource}. */
export interface ArchiveProxy {

    /** Identifies the archive's content across sessions; undefined when it cannot be identified. */
    readonly id?: string;

    getEntries(): Promise<ArchiveEntry[]>;

}