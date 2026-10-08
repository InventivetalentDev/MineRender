import { BedrockEntityDescription } from "./BedrockEntityDescription";

/** Bedrock client-entity JSON schema, provided for typing only. */
export interface BedrockEntityFile {
    format_version: string;
    "minecraft:client_entity": {
        "description": BedrockEntityDescription;
    }
}
