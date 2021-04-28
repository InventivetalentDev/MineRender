import { MultiBlockParser } from "./MultiBlockParser";
import { MultiBlockStructure } from "./MultiBlockStructure";
import { TripleArray } from "../Model";

export class StructureParser implements MultiBlockParser {

    parse(): Promise<MultiBlockStructure> {
        // @ts-ignore
        return Promise.resolve({  });
    }

}

export interface Structure {
    DataVersion: number;
    size: TripleArray;
}
