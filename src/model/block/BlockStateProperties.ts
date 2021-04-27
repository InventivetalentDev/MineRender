export type BlockStatePropertyValue = string | boolean | number;

export interface BlockStateProperty {
    default: BlockStatePropertyValue;
    type: "boolean" | "int" | "enum";
    valueType: "boolean" | "int" | string;
    values: BlockStatePropertyValue[];
}

export type BlockStatePropertyDefaults = { [key: string]: BlockStateProperty; };

export type BlockStateProperties = { [key: string]: string; };
