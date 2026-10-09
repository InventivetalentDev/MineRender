import { buildSectionGeometry, sectionGeometryTransferables, SectionGeometryInput } from "../../world/SectionGeometry";

addEventListener("message", (event: MessageEvent<{ id: number; type: "build"; input: SectionGeometryInput }>) => {
    const { id, input } = event.data;
    try {
        const pages = buildSectionGeometry(input);
        postMessage({ id, type: "pages", pages }, { transfer: sectionGeometryTransferables(pages) });
    } catch (error) {
        postMessage({ id, type: "error", message: error instanceof Error ? error.message : String(error) });
    }
});
