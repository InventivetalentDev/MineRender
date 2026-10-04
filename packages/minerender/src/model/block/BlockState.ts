import { MinecraftAsset } from "../../MinecraftAsset";

export interface BlockState extends MinecraftAsset {
    variants?: BlockStateVariants;
    multipart?: BlockStateMultipart[];
}

export type BlockStateVariants = { [key: string]: BlockStateVariant | BlockStateVariant[] };

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

export type MultipartCondition = Record<string, string> | { OR: MultipartCondition[] } | { AND: MultipartCondition[] };
