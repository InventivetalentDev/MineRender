import { MultiBlockStructure } from "./MultiBlockStructure";

export interface MultiBlockParser {
    parse(): Promise<MultiBlockStructure>;
}
