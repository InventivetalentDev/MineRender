/** Produces a string representation, such as an asset cache key. */
export interface Serializable {
    serialize(): string;
}
