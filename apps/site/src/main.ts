import "./style.css";
import { Showcase } from "./showcase/Showcase";
import { highlightAll } from "./highlight";
import { decorateCodeBlocks, scrollSpy, setupThemeToggle } from "./ui";
import { skins } from "./examples/skins";
import { blocks } from "./examples/blocks";
import { items } from "./examples/items";
import { entities } from "./examples/entities";
import { structures } from "./examples/structures";
import { resourcepacks } from "./examples/resourcepacks";
import { rendererPool } from "./viewport/RendererPool";
import { shutdown } from "minerender";

const groups = [skins, blocks, items, entities, structures, resourcepacks];

const host = document.getElementById("examples")!;
const showcases = groups.map(group => {
    const showcase = new Showcase(group);
    host.appendChild(showcase.element);
    return showcase;
});

// Example navigation in the hero and nav
const exampleNav = document.getElementById("example-nav");
if (exampleNav) {
    for (const group of groups) {
        const link = document.createElement("a");
        link.href = `#${group.id}`;
        link.textContent = group.title;
        exampleNav.appendChild(link);
    }
}

highlightAll();
decorateCodeBlocks();
scrollSpy(document.querySelector("nav.site-nav")!);

const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
if (themeToggle) setupThemeToggle(themeToggle);

// Let people with strong machines opt into more simultaneous viewports.
const poolSelect = document.querySelector<HTMLSelectElement>("#pool-size");
if (poolSelect) {
    poolSelect.value = String(rendererPool.maxActive);
    poolSelect.addEventListener("change", () => {
        rendererPool.maxActive = Number(poolSelect.value) || 1;
    });
}

// Mobile nav toggle
const navToggle = document.querySelector<HTMLButtonElement>("#nav-toggle");
const navLinks = document.querySelector<HTMLElement>("#nav-links");
navToggle?.addEventListener("click", () => {
    const open = navLinks?.classList.toggle("is-open") ?? false;
    navToggle.setAttribute("aria-expanded", String(open));
});
navLinks?.addEventListener("click", event => {
    if ((event.target as HTMLElement).tagName === "A") navLinks.classList.remove("is-open");
});

window.addEventListener("pagehide", () => {
    showcases.forEach(showcase => showcase.dispose());
    shutdown();
});

// Expose for debugging in the console
Object.assign(window, { minerenderSite: { showcases, rendererPool } });
