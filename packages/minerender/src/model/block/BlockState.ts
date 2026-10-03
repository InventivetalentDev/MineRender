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
}


export interface BlockStateMultipart {
    when?: MultipartCondition | { OR: MultipartCondition[] };
    apply?: BlockStateVariant;
}

export interface MultipartCondition {
    [key: string]: string;
}
