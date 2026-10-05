import type { ExampleContext } from "./types";

export const STEVE_TEXTURE = "https://textures.minecraft.net/texture/fb5f93b1ccebf7b385fa488c6d4cfec87cf1b855f8dbe0308da44167cae170b";

/** Common preamble shared by the ESM snippets. */
export function esmRenderer(...imports: string[]): string {
    const names = ["Renderer", ...imports].sort().join(", ");
    return `import { ${names} } from "minerender";\n${ESM_RENDERER_BODY}`;
}

const ESM_RENDERER_BODY = `
const renderer = new Renderer({
    camera: { position: [40, 30, 50], lookingAt: [0, 0, 0] },
    controls: { enabled: true }
});
renderer.appendTo(document.getElementById("render")!);
renderer.start();`;

export const ESM_RENDERER = esmRenderer();

export const SCRIPT_RENDERER = `<div id="render" style="width: 400px; height: 400px"></div>
<script src="https://unpkg.com/minerender@alpha/dist/bundle.js"></script>
<script>
    const renderer = new MineRender.Renderer({
        camera: { position: [40, 30, 50], lookingAt: [0, 0, 0] },
        controls: { enabled: true }
    });
    renderer.appendTo(document.getElementById("render"));
    renderer.start();`;

export const SCRIPT_END = `</script>`;

/** Wraps a body (indented one level) into a full script-tag snippet. */
export function scriptSnippet(body: string): string {
    const indented = body.split("\n").map(line => line ? "    " + line : line).join("\n");
    return `${SCRIPT_RENDERER}\n\n${indented}\n${SCRIPT_END}`;
}

/** Builds a labelled text input in the viewport's control strip. */
export function textControl(context: ExampleContext, label: string, value: string, onChange: (value: string) => void, list?: string[]): HTMLInputElement {
    const wrapper = document.createElement("label");
    wrapper.className = "viewport-control";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.spellcheck = false;
    input.autocomplete = "off";
    if (list) {
        const datalist = document.createElement("datalist");
        datalist.id = `list-${Math.random().toString(36).slice(2)}`;
        for (const option of list) {
            const element = document.createElement("option");
            element.value = option;
            datalist.appendChild(element);
        }
        wrapper.appendChild(datalist);
        input.setAttribute("list", datalist.id);
    }
    input.addEventListener("change", () => onChange(input.value.trim()));
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") onChange(input.value.trim());
    });
    wrapper.append(span, input);
    context.controls.appendChild(wrapper);
    return input;
}

/** Builds a checkbox toggle in the viewport's control strip. */
export function toggleControl(context: ExampleContext, label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLInputElement {
    const wrapper = document.createElement("label");
    wrapper.className = "viewport-control viewport-control-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    const span = document.createElement("span");
    span.textContent = label;
    wrapper.append(input, span);
    context.controls.appendChild(wrapper);
    return input;
}

/** Fills a datalist asynchronously without blocking the example. */
export function fillList(input: HTMLInputElement, loader: () => Promise<string[]>, map: (entry: string) => string = e => e): void {
    const id = input.getAttribute("list");
    if (!id) return;
    loader().then(entries => {
        const datalist = document.getElementById(id);
        if (!datalist) return;
        for (const entry of entries) {
            const option = document.createElement("option");
            option.value = map(entry);
            datalist.appendChild(option);
        }
    }).catch(error => console.warn("Could not load suggestions", error));
}
