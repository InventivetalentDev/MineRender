/** Small shared DOM helpers for the page. */

export function copyButton(getText: () => string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.textContent = "Copy";
    button.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(getText());
            button.textContent = "Copied";
        } catch {
            button.textContent = "Press ⌘/Ctrl+C";
        }
        setTimeout(() => (button.textContent = "Copy"), 1500);
    });
    return button;
}

/** Adds copy buttons to every static <pre> block in the docs. */
export function decorateCodeBlocks(root: ParentNode = document): void {
    root.querySelectorAll<HTMLPreElement>("pre:not(.showcase-code pre):not([data-decorated])").forEach(pre => {
        pre.dataset.decorated = "true";
        const wrapper = document.createElement("div");
        wrapper.className = "code-static";
        pre.replaceWith(wrapper);
        wrapper.append(pre, copyButton(() => pre.textContent ?? ""));
    });
}

/** Highlights the nav link of the section currently in view. */
export function scrollSpy(nav: HTMLElement): void {
    const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
    const targets = links.map(link => document.querySelector<HTMLElement>(link.hash)).filter((el): el is HTMLElement => !!el);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const id = entry.target.id;
            for (const link of links) link.classList.toggle("is-active", link.hash === `#${id}`);
        }
    }, { rootMargin: "-40% 0px -55% 0px" });
    targets.forEach(target => observer.observe(target));
}

export function setupThemeToggle(button: HTMLButtonElement): void {
    const stored = safeStorage("minerender-theme");
    if (stored) document.documentElement.dataset.theme = stored;
    button.addEventListener("click", () => {
        const root = document.documentElement;
        const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
        const current = root.dataset.theme ?? (prefersDark ? "dark" : "light");
        const next = current === "dark" ? "light" : "dark";
        root.dataset.theme = next;
        try {
            localStorage.setItem("minerender-theme", next);
        } catch {
            // Storage may be unavailable; the toggle still works for this page view.
        }
    });
}

function safeStorage(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}
