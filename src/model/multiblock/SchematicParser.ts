import { MultiBlockParser } from "./MultiBlockParser";
import { MultiBlockStructure } from "./MultiBlockStructure";

export class SchematicParser implements MultiBlockParser {

    parse(): Promise<MultiBlockStructure> {
        // @ts-ignore
        return Promise.resolve({  });
    }

}
