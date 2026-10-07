import { defineConfig } from "vitepress";
import { version } from "../../package.json";
import apiSidebar from "../api/sidebar.json";

export default defineConfig({
    title: "MineRender V2",
    description: "API reference for Minecraft skins, models, entities, GUIs, and worlds.",
    base: process.env.DOCS_BASE || "/",
    outDir: "../docs",
    themeConfig: {
        nav: [
            { text: "API reference", link: "/" },
            { text: "Behavior", link: "/concepts" },
            { text: "Browser & Node", link: "/platforms" },
            { text: version, link: "https://github.com/InventivetalentDev/MineRender/releases" }
        ],
        sidebar: [
            {
                text: "Reference",
                items: [
                    { text: "Overview", link: "/" },
                    { text: "Rendering & ownership", link: "/concepts" },
                    { text: "Browser & Node", link: "/platforms" }
                ]
            },
            ...apiSidebar
        ],
        search: { provider: "local" },
        outline: [2, 3],
        socialLinks: [{ icon: "github", link: "https://github.com/InventivetalentDev/MineRender" }],
        docFooter: { prev: false, next: false }
    }
});
