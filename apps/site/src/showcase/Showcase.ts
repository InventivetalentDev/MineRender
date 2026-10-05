import type { Example, ExampleGroup } from "../examples/types";
import { Viewport } from "../viewport/Viewport";
import { highlight } from "../highlight";
import { copyButton } from "../ui";

/**
 * One section of the examples area: a list of examples, a single lazily-rendered viewport,
 * and a code panel. Only the selected example is rendered, so a section costs one renderer at most.
 */
export class Showcase {
    readonly element: HTMLElement;
    private readonly viewport: Viewport;
    private readonly tabs: HTMLElement;
    private readonly title: HTMLElement;
    private readonly description: HTMLElement;
    private readonly code: HTMLElement;
    private readonly codeTabs: HTMLElement;
    private current!: Example;
    private language: "esm" | "script" = "esm";

    constructor(readonly group: ExampleGroup) {
        const section = document.createElement("section");
        section.className = "showcase";
        section.id = group.id;
        section.innerHTML = `
            <div class="section-heading">
                <h2>${group.title}</h2>
                <p class="lead">${group.lead}</p>
            </div>
            <div class="showcase-tabs" role="tablist" aria-label="${group.title} examples"></div>
            <div class="showcase-body">
                <div class="showcase-stage">
                    <div class="showcase-viewport"></div>
                    <div class="showcase-caption">
                        <h3 class="showcase-title"></h3>
                        <p class="showcase-description"></p>
                    </div>
                </div>
                <div class="showcase-code">
                    <div class="code-header">
                        <div class="code-tabs" role="tablist" aria-label="Code style"></div>
                    </div>
                    <pre><code class="code-block"></code></pre>
                </div>
            </div>
            ${group.notes?.length ? `<ul class="showcase-notes">${group.notes.map(note => `<li>${note}</li>`).join("")}</ul>` : ""}
        `;
        this.element = section;
        this.tabs = section.querySelector(".showcase-tabs")!;
        this.title = section.querySelector(".showcase-title")!;
        this.description = section.querySelector(".showcase-description")!;
        this.code = section.querySelector(".code-block")!;
        this.codeTabs = section.querySelector(".code-tabs")!;
        this.viewport = new Viewport(section.querySelector(".showcase-viewport")!);

        const header = section.querySelector(".code-header")!;
        header.appendChild(copyButton(() => this.currentCode()));

        for (const example of group.examples) {
            const button = document.createElement("button");
            button.type = "button";
            button.role = "tab";
            button.className = "chip";
            button.textContent = example.title;
            button.dataset.example = example.id;
            button.addEventListener("click", () => this.select(example));
            this.tabs.appendChild(button);
        }

        const initial = group.examples.find(example => example.id === location.hash.slice(1)) ?? group.examples[0];
        this.select(initial);
    }

    select(example: Example): void {
        this.current = example;
        for (const chip of this.tabs.querySelectorAll<HTMLButtonElement>(".chip")) {
            const selected = chip.dataset.example === example.id;
            chip.classList.toggle("is-selected", selected);
            chip.setAttribute("aria-selected", String(selected));
        }
        this.title.textContent = example.title;
        this.description.textContent = example.description;
        this.viewport.setExample(example);
        this.renderCodeTabs();
        this.renderCode();
    }

    private renderCodeTabs(): void {
        this.codeTabs.innerHTML = "";
        const languages: Array<["esm" | "script", string]> = [["esm", "ES module"]];
        if (this.current.code.script) languages.push(["script", "Script tag"]);
        if (!languages.some(([key]) => key === this.language)) this.language = "esm";
        for (const [key, label] of languages) {
            const button = document.createElement("button");
            button.type = "button";
            button.role = "tab";
            button.className = "code-tab" + (key === this.language ? " is-selected" : "");
            button.textContent = label;
            button.addEventListener("click", () => {
                this.language = key;
                this.renderCodeTabs();
                this.renderCode();
            });
            this.codeTabs.appendChild(button);
        }
    }

    private currentCode(): string {
        return (this.language === "script" ? this.current.code.script : this.current.code.esm) ?? this.current.code.esm;
    }

    private renderCode(): void {
        const language = this.language === "script" ? "html" : "ts";
        this.code.innerHTML = highlight(this.currentCode(), language);
        this.code.dataset.lang = language;
    }

    dispose(): void {
        this.viewport.dispose();
    }
}
