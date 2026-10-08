import { MinecraftAsset } from "../../MinecraftAsset";

/** A Java blockstate file that selects models through variants or multipart conditions. */
export interface BlockState extends MinecraftAsset {
    variants?: BlockStateVariants;
    multipart?: BlockStateMultipart[];
}

export type BlockStateVariants = { [key: string]: BlockStateVariant | BlockStateVariant[] };

/** A model selection with optional x/y rotations in degrees, UV locking, and random-selection weight. */
export interface BlockStateVariant {
    model?: string;
    y?: number;
    x?: number;
    uvlock?: boolean;
    weight?: number;
}


export interface BlockStateMultipart {
    when?: MultipartCondition;
    apply?: BlockStateVariant | BlockStateVariant[];
}

/** Property tests combined with AND or OR. A property value such as `north|south` accepts either value. */
export type MultipartCondition = Record<string, string> | { OR: MultipartCondition[] } | { AND: MultipartCondition[] };
