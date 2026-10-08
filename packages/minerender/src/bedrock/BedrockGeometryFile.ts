import { BedrockGeometry } from "./BedrockGeometry";

/** A versioned Bedrock JSON container for named geometry definitions. */
export interface BedrockGeometryFile {
    format_version: string;

    [key: string]: BedrockGeometry|any;
}
