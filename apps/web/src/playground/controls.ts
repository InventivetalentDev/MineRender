export function section(parent: HTMLElement, title: string, open = false): HTMLDivElement {
    const details = document.createElement("details");
    details.open = open;
    const summary = document.createElement("summary");
    summary.textContent = title;
    const body = document.createElement("div");
    body.className = "control-section";
    details.append(summary, body);
    parent.append(details);
    return body;
}

export function group(parent: HTMLElement, title: string): HTMLFieldSetElement {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = title;
    fieldset.append(legend);
    parent.append(fieldset);
    return fieldset;
}

export function field<T extends HTMLElement>(parent: HTMLElement, title: string, input: T): T {
    const label = document.createElement("label");
    label.className = "control-field";
    const text = document.createElement("span");
    text.textContent = title;
    label.append(text, input);
    parent.append(label);
    return input;
}

export function input(parent: HTMLElement, title: string, value: string | number, type = "text"): HTMLInputElement {
    const control = document.createElement("input");
    control.type = type;
    control.value = String(value);
    return field(parent, title, control);
}

export function select(parent: HTMLElement, title: string, values: Array<string | [string, string]>, value: string): HTMLSelectElement {
    const control = document.createElement("select");
    for (const entry of values) {
        const [key, label] = Array.isArray(entry) ? entry : [entry, entry];
        control.append(new Option(label, key));
    }
    control.value = value;
    return field(parent, title, control);
}

export function checkbox(parent: HTMLElement, title: string, checked: boolean): HTMLInputElement {
    const control = input(parent, title, "", "checkbox");
    control.checked = checked;
    control.parentElement!.classList.add("control-checkbox");
    return control;
}

export function button(parent: HTMLElement, title: string, action: () => void | Promise<void>): HTMLButtonElement {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = title;
    control.addEventListener("click", () => { void action(); });
    parent.append(control);
    return control;
}

export function note(parent: HTMLElement, text: string): HTMLParagraphElement {
    const element = document.createElement("p");
    element.className = "control-note";
    element.textContent = text;
    parent.append(element);
    return element;
}

/** Attach a datalist of asset IDs (without `.json`) to a text input. */
export function suggestions(control: HTMLInputElement, values: string[]): void {
    const id = `${control.id || "asset"}-suggestions`;
    document.getElementById(id)?.remove();
    const list = document.createElement("datalist");
    list.id = id;
    for (const value of values) {
        if (!value.endsWith(".json") || value === "_list.json") continue;
        list.append(new Option(value.slice(0, -5)));
    }
    control.setAttribute("list", id);
    control.after(list);
}

export function download(data: string | ArrayBuffer | Blob | object, name: string, type = "application/json"): void {
    const inline = typeof data === "string" && data.startsWith("data:");
    const url = inline ? data as string : URL.createObjectURL(data instanceof Blob ? data : new Blob([
        typeof data === "string" || data instanceof ArrayBuffer ? data : JSON.stringify(data, null, 2)
    ], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    if (!inline) setTimeout(() => URL.revokeObjectURL(url), 1000);
}
