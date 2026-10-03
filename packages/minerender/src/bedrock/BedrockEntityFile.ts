import { BedrockEntityDescription } from "./BedrockEntityDescription";

export interface BedrockEntityFile {
    format_version: string;
    "minecraft:client_entity": {
        "description": BedrockEntityDescription;
    }
}
