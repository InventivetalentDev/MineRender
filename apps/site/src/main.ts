import "./style.css";
import { Showcase } from "./showcase/Showcase";
import { Playground } from "./playground/Playground";
import { highlightAll } from "./highlight";
import { decorateCodeBlocks, scrollSpy, setupThemeToggle, copyButton } from "./ui";
import { renderPixelIcons } from "./icons";
import { skins, textureUrl } from "./examples/skins";
import { blocks, single } from "./examples/blocks";
import { items, generated } from "./examples/items";
import { entities, mob } from "./examples/entities";
import { structures } from "./examples/structures";
import { resourcepacks } from "./examples/resourcepacks";
import { composed } from "./examples/scene";
import { rendererPool } from "./viewport/RendererPool";
import { shutdown } from "minerender";

const groups = [skins, blocks, items, entities, structures, resourcepacks];

// Hero stage: one representative example per content type, plus the composed scene.
const playground = new Playground(document.getElementById("playground")!, [
    { ...composed, sectionId: "examples" },
    { ...textureUrl, sectionId: "skins" },
    { ...single, sectionId: "blocks" },
    { ...generated, sectionId: "items" },
    { ...mob, sectionId: "entities" }
]);

const host = document.getElementById("examples")!;
const showcases = groups.map(group => {
    const showcase = new Showcase(group);
    host.appendChild(showcase.element);
    return showcase;
});

const exampleNav = document.getElementById("example-nav");
if (exampleNav) {
    for (const group of groups) {
        const link = document.createElement("a");
        link.href = `#${group.id}`;
        link.textContent = group.title;
        exampleNav.appendChild(link);
    }
}

renderPixelIcons();
highlightAll();
decorateCodeBlocks();
scrollSpy(document.querySelector("nav.site-nav")!);

// Static copy buttons (the install line)
document.querySelectorAll<HTMLButtonElement>("button[data-copy]").forEach(button => {
    button.replaceWith(copyButton(() => button.dataset.copy ?? ""));
});

const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
if (themeToggle) setupThemeToggle(themeToggle);

const poolSelect = document.querySelector<HTMLSelectElement>("#pool-size");
if (poolSelect) {
    poolSelect.value = String(rendererPool.maxActive);
    poolSelect.addEventListener("change", () => {
        rendererPool.maxActive = Number(poolSelect.value) || 1;
    });
}

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
    playground.dispose();
    showcases.forEach(showcase => showcase.dispose());
    shutdown();
});

Object.assign(window, { minerenderSite: { playground, showcases, rendererPool } });
