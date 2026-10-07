import type { Renderer } from "minerender";
import { Box3, Object3D, PerspectiveCamera, Vector3 } from "three";
import type { ExampleContext } from "./types";

/**
 * Points the camera at an object's bounding box from its current direction, far enough
 * away to fit it. Entities differ a lot in size and origin, so this keeps them centred.
 */
export function frameObject(renderer: Renderer, object: Object3D, padding = 1.3): void {
    const box = new Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3());
    // Bounding-sphere radius, so long bodies seen end-on still fit
    const radius = box.getSize(new Vector3()).length() / 2;
    const camera = renderer.camera;
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 50;
    const distance = radius * padding / Math.tan((fov / 2) * Math.PI / 180);
    const direction = camera.position.clone().sub(renderer.controls?.target ?? new Vector3()).normalize();
    camera.position.copy(center).add(direction.multiplyScalar(distance));
    camera.lookAt(center);
    if (renderer.controls) {
        renderer.controls.target.copy(center);
        renderer.controls.update();
        renderer.controls.saveState();
    }
    renderer.dirty = true;
}

/** Moves an object up so its bounding box starts at the given floor height. Entities extend downwards from their origin. */
export function standOn(object: Object3D, floor = 0): void {
    const box = new Box3().setFromObject(object);
    if (!box.isEmpty()) object.position.y += floor - box.min.y;
}

/** Default player textures from the vanilla assets; no third-party host involved. */
export const STEVE_TEXTURE = "https://assets.mcasset.cloud/1.21.11/assets/minecraft/textures/entity/player/wide/steve.png";
export const ALEX_TEXTURE = "https://assets.mcasset.cloud/1.21.11/assets/minecraft/textures/entity/player/slim/alex.png";

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
<script src="https://unpkg.com/minerender@beta/dist/bundle.js"></script>
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

/** Builds a labelled <select> in the viewport's control strip. */
export function selectControl(context: ExampleContext, label: string, options: Array<[string, string]>, value: string, onChange: (value: string) => void): HTMLSelectElement {
    const wrapper = document.createElement("label");
    wrapper.className = "viewport-control";
    const span = document.createElement("span");
    span.textContent = label;
    const select = document.createElement("select");
    for (const [key, text] of options) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = text;
        select.appendChild(option);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    wrapper.append(span, select);
    context.controls.appendChild(wrapper);
    return select;
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

/**
 * Fills a datalist once the input is first focused. Listing assets takes many requests that
 * would otherwise queue ahead of the example's own loads.
 */
export function fillList(input: HTMLInputElement, loader: () => Promise<string[]>, map: (entry: string) => string = e => e): void {
    const id = input.getAttribute("list");
    if (!id) return;
    input.addEventListener("focus", () => loader().then(entries => {
        const datalist = document.getElementById(id);
        if (!datalist) return;
        for (const entry of entries) {
            const option = document.createElement("option");
            option.value = map(entry);
            datalist.appendChild(option);
        }
    }).catch(error => console.warn("Could not load suggestions", error)), { once: true });
}

/** Builds a button in the viewport's control strip. */
export function buttonControl(context: ExampleContext, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "viewport-control viewport-control-button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    context.controls.appendChild(button);
    return button;
}

/** Builds a labelled file input in the viewport's control strip. */
export function fileControl(context: ExampleContext, label: string, accept: string, onChange: (file: File) => void): HTMLInputElement {
    const wrapper = document.createElement("label");
    wrapper.className = "viewport-control";
    const span = document.createElement("span");
    span.textContent = label;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) onChange(file);
    });
    wrapper.append(span, input);
    context.controls.appendChild(wrapper);
    return input;
}

/** Shows a short status line in the viewport's control strip. */
export function statusControl(context: ExampleContext): HTMLElement {
    const status = document.createElement("span");
    status.className = "viewport-control viewport-status";
    context.controls.appendChild(status);
    return status;
}

/** Offers a string or binary result as a file download. */
export function download(name: string, data: string | ArrayBuffer | Blob, type = "application/octet-stream"): void {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
