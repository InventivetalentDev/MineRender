/** Caption, title, code, and stat layers over the canvas. Values are applied per frame; nothing animates on its own. */
export interface OverlayState {
    heading?: string;
    subheading?: string;
    /** Opacity of the title block (logo, heading, subheading). */
    title?: number;
    /** Title block placement: centred (default) or in the upper part of the frame. */
    titlePosition?: "center" | "upper";
    caption?: string;
    /** Opacity of the caption. */
    captionOpacity?: number;
    code?: string;
    codeOpacity?: number;
    stat?: string;
    statOpacity?: number;
    /** Opacity of the render surface, for fading shots in and out. */
    surface?: number;
}

export class Overlay {
    private readonly title: HTMLElement;
    private readonly heading: HTMLElement;
    private readonly subheading: HTMLElement;
    private readonly caption: HTMLElement;
    private readonly code: HTMLElement;
    private readonly stat: HTMLElement;
    private readonly surface: HTMLElement;

    constructor(stage: HTMLElement) {
        const pick = (selector: string) => stage.querySelector<HTMLElement>(selector)!;
        this.title = pick(".overlay-title");
        this.heading = pick(".overlay-heading");
        this.subheading = pick(".overlay-subheading");
        this.caption = pick(".overlay-caption");
        this.code = pick(".overlay-code");
        this.stat = pick(".overlay-stat");
        this.surface = pick(".stage-surface");
    }

    /** Applies a full frame state; omitted layers are hidden. */
    set(state: OverlayState): void {
        this.heading.textContent = state.heading ?? "";
        this.subheading.textContent = state.subheading ?? "";
        this.title.style.opacity = String(state.title ?? 0);
        this.title.classList.toggle("is-upper", state.titlePosition === "upper");
        // Captions may mark words with <accent>…</accent>.
        this.caption.innerHTML = (state.caption ?? "").replace(/</g, "&lt;")
            .replace(/&lt;accent>(.*?)&lt;\/accent>/g, '<span class="accent">$1</span>');
        this.caption.style.opacity = String(state.captionOpacity ?? (state.caption ? 1 : 0));
        this.code.textContent = state.code ?? "";
        this.code.style.opacity = String(state.codeOpacity ?? (state.code ? 1 : 0));
        this.stat.textContent = state.stat ?? "";
        this.stat.style.opacity = String(state.statOpacity ?? (state.stat ? 1 : 0));
        this.surface.style.opacity = String(state.surface ?? 1);
    }

    clear(): void {
        this.set({});
    }
}
