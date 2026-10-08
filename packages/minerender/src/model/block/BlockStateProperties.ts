export type BlockStatePropertyValue = string | boolean | number;

/** A vanilla block property's default and allowed values, loaded through {@link BlockStates.getDefaultState}. */
export interface BlockStateProperty {
    default: BlockStatePropertyValue;
    type: "boolean" | "int" | "enum";
    valueType: "boolean" | "int" | string;
    values: BlockStatePropertyValue[];
}

export type BlockStatePropertyDefaults = { [key: string]: BlockStateProperty; };

/** Block property values, such as `{ facing: "north", waterlogged: "false" }`. */
export type BlockStateProperties = { [key: string]: string; };
