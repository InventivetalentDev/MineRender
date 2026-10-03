import { BedrockGeometry } from "./BedrockGeometry";

export interface BedrockGeometryFile {
    format_version: string;

    [key: string]: BedrockGeometry|any;
}
