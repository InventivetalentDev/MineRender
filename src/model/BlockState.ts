export interface BlockState {
    variants?: BlockStateVariants;
    multipart?: BlockStateMultipart[];
}

export type BlockStateVariants = { [key: string]: BlockStateVariant };

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
