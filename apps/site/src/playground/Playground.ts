import type { Example } from "../examples/types";
import { Viewport, type ViewportState } from "../viewport/Viewport";

/**
 * The hero stage: one viewport, a row of tabs, a status line, and a reset button.
 * It shares the renderer pool with the example sections, so it never adds a second
 * live context on top of the one the person is looking at further down.
 */
export class Playground {
    private readonly viewport: Viewport;
    private readonly tabs: HTMLElement;
    private readonly status: HTMLElement;
    private readonly caption: HTMLElement;
    private readonly link: HTMLAnchorElement;
    private current!: Example;

    constructor(root: HTMLElement, private readonly examples: Array<Example & { sectionId: string }>) {
        this.tabs = root.querySelector(".stage-tabs")!;
        this.status = root.querySelector(".stage-status")!;
        this.caption = root.querySelector(".stage-caption")!;
        this.link = root.querySelector(".stage-link")!;
        const reset = root.querySelector<HTMLButtonElement>(".stage-reset")!;

        this.viewport = new Viewport(root.querySelector(".stage-viewport")!, {
            overlay: false,
            onStatus: (state, message) => this.showStatus(state, message)
        });
        reset.addEventListener("click", () => {
            if (this.viewport.currentState === "active") this.viewport.resetView();
            else this.viewport.activate();
        });

        for (const example of examples) {
            const button = document.createElement("button");
            button.type = "button";
            button.role = "tab";
            button.className = "stage-tab";
            button.textContent = example.title;
            button.dataset.example = example.id;
            button.addEventListener("click", () => this.select(example));
            this.tabs.appendChild(button);
        }
        this.select(examples[0]);
    }

    select(example: Example & { sectionId: string }): void {
        this.current = example;
        for (const tab of this.tabs.querySelectorAll<HTMLButtonElement>(".stage-tab")) {
            const selected = tab.dataset.example === example.id;
            tab.classList.toggle("is-selected", selected);
            tab.setAttribute("aria-selected", String(selected));
        }
        this.caption.textContent = example.description;
        this.link.href = `#${example.sectionId}`;
        this.viewport.setExample(example);
    }

    private showStatus(state: ViewportState, message: string): void {
        const text: Record<ViewportState, string> = {
            idle: "Scroll here to load the preview",
            loading: message,
            active: "Live. Drag to orbit, scroll to zoom.",
            suspended: "Paused. Click reset to resume.",
            error: message
        };
        this.status.textContent = text[state];
        this.status.dataset.state = state;
    }

    reload(): void {
        this.viewport.reload();
    }

    dispose(): void {
        this.viewport.dispose();
    }
}
