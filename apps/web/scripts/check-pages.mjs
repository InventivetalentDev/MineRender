// Opens every playground page (and each of its presets) in headless Chrome, waits for the load to finish,
// and reports the status line, page errors, and console errors. Screenshots land in apps/web/.screenshots/.
//
//   yarn workspace @minerender/web check                 all pages and presets
//   yarn workspace @minerender/web check demo/block/     only these pages (presets included)
//   CHROME_PATH=/path/to/chrome yarn workspace @minerender/web check
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 3177);
const base = `http://127.0.0.1:${port}/`;
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const shots = path.join(root, ".screenshots");
const requested = process.argv.slice(2);
const pages = requested.length ? requested : fs.readdirSync(path.join(root, "src"), { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && entry.name === "script.ts")
    .map(entry => path.relative(path.join(root, "src"), entry.parentPath ?? entry.path).replace(/\\/g, "/") + "/")
    .sort();

if (!fs.existsSync(chrome)) {
    console.error(`Chrome not found at ${chrome}; set CHROME_PATH.`);
    process.exit(2);
}
fs.rmSync(shots, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });

const server = spawn(process.execPath, ["build.mjs", "--serve", "--host", "127.0.0.1", "--port", String(port)], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
let serverLog = "";
server.stderr.on("data", chunk => { serverLog += chunk; });
for (let attempt = 0; ; attempt++) {
    try {
        if ((await fetch(base)).ok) break;
    } catch { /* not up yet */ }
    if (server.exitCode !== null || attempt > 120) {
        console.error(`Dev server did not start on port ${port}.\n${serverLog}`);
        process.exit(2);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
}

const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]
});
let failures = 0;

async function visit(url, name) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const problems = new Set();
    page.on("pageerror", error => problems.add(`pageerror: ${error.message}`));
    page.on("console", message => {
        const text = message.text();
        if (message.type() === "error" && !/404|JSHandle@error/.test(text)) problems.add(`console: ${text}`);
    });
    let status = "";
    let presets = [];
    try {
        await page.goto(base + url, { waitUntil: "load", timeout: 30000 });
        const isPlayground = await page.evaluate(() => !!document.querySelector(".playground-status"));
        if (isPlayground) {
            await page.waitForFunction(() => {
                const element = document.querySelector(".playground-status");
                return element && !/^Loading/.test(element.textContent ?? "") && element.textContent !== "";
            }, { timeout: 120000 });
            await new Promise(resolve => setTimeout(resolve, 800));
            ({ status, presets } = await page.evaluate(() => ({
                status: document.querySelector(".playground-status")?.textContent ?? "",
                presets: Array.from(document.querySelectorAll("select option"))
                    .filter(option => option.parentElement.previousElementSibling?.textContent === "Preset" && option.value)
                    .map(option => option.value)
            })));
            if (!/^Ready/.test(status)) problems.add(status);
        } else if (await page.$("#add-form")) {
            await page.waitForFunction(() => {
                const element = document.querySelector("#status");
                return element?.classList.contains("error")
                    || /^(Add objects to build a scene|Local save restored\.)/.test(element?.textContent ?? "");
            }, { timeout: 120000 });
            status = await page.$eval("#status", element => element.textContent ?? "");
            if (await page.$("#status.error")) {
                problems.add(status);
            }
            if (!await page.$("#viewport canvas")) {
                problems.add("Editor canvas missing");
            }
        } else {
            await new Promise(resolve => setTimeout(resolve, 3000));
            status = (await page.evaluate(() => document.body.innerText)).split("\n").find(line => /PASS|FAIL/.test(line)) ?? "(no status)";
            if (/FAIL/.test(status) || status === "(no status)") problems.add(status);
        }
        await page.screenshot({ path: path.join(shots, `${name}.png`) });
        const tintPresets = {
            dyed_leather: { 0: 0x3f76e4 }, potion_color: { 0: 0xd557ef }, map_color: { 0: 0xffffff, 1: 0xe0a63a },
            firework_color: { 0: 0xffffff, 1: 0x7f007f }, custom_model_color: { 0: 0x55ff55 }
        };
        const expectedTints = url.startsWith("demo/item/") && tintPresets[new URL(url, base).searchParams.get("preset")];
        if (expectedTints && /^Ready/.test(status)) {
            const result = await page.evaluate(() => ({
                tints: window.item.options.tints, components: window.playground.state.components, code: window.playground.code()
            }));
            if (JSON.stringify(result.tints) !== JSON.stringify(expectedTints)) problems.add(`Component tint differs: ${JSON.stringify(result.tints)}`);
            if (!result.code.includes(`components: ${JSON.stringify(result.components)}`)) problems.add("Generated code omits the color components.");
        }
        if (/^demo\/item\/\?preset=(enchanted(?:_shield|_trident)?|nether_star|enchanted_golden_apple|enchanted_book)$/.test(url) && /^Ready/.test(status)) {
            const initialZoom = await page.evaluate(() => window.renderer.camera.zoom);
            for (const zoom of [initialZoom / 2, initialZoom]) {
                const frames = await page.evaluate(async zoom => {
                    const images = [];
                    for (const enabled of [false, true, undefined]) {
                        const components = { ...window.playground.state.components };
                        if (enabled === undefined) delete components["minecraft:enchantment_glint_override"];
                        else components["minecraft:enchantment_glint_override"] = enabled;
                        await window.playground.update({ components });
                        const renderer = window.renderer;
                        renderer.camera.zoom = zoom;
                        renderer.camera.updateProjectionMatrix();
                        images.push(renderer.toImage(false));
                    }
                    return images;
                }, zoom);
                if (frames[0] === frames[1]) problems.add(`Glint is invisible at camera zoom ${zoom}.`);
                if (frames[0] === frames[2]) problems.add(`Automatic glint is invisible at camera zoom ${zoom}.`);
            }
        }
        if (/^demo\/item\/\?preset=(bundle|bow|crossbow|custom_model_data)$/.test(url) && /^Ready/.test(status)) {
            const inspect = () => {
                const parts = [];
                window.item.traverse(object => {
                    if (!object.isModelObject || object.originalModel.parts) return;
                    let vertices = 0;
                    object.traverse(mesh => {
                        if (!mesh.isMesh) return;
                        vertices += mesh.geometry.getAttribute("position").count;
                    });
                    parts.push({ model: object.originalModel.key?.toNamespacedString(), instanced: object.isInstanced, vertices });
                });
                return parts;
            };
            const waitReady = async () => {
                await page.waitForFunction(() => !/^Loading/.test(document.querySelector(".playground-status")?.textContent ?? ""), { timeout: 120000 });
                const result = await page.$eval(".playground-status", element => element.textContent ?? "");
                if (!/^Ready/.test(result)) throw new Error(result);
            };
            const expectModels = async (...expected) => {
                const parts = await page.evaluate(inspect);
                if (JSON.stringify(parts.map(part => part.model)) !== JSON.stringify(expected.map(path => `minecraft:${path}`))
                    || parts.some(part => !part.vertices || part.instanced)) {
                    problems.add(`Item preview differs from the selected state: ${JSON.stringify(parts)}`);
                }
            };
            const setControl = async (selector, value) => {
                await page.$eval(selector, (control, value) => {
                    control.value = String(value);
                    control.dispatchEvent(new Event("change", { bubbles: true }));
                }, value);
                await waitReady();
            };
            const property = id => `[data-item-property="minecraft:${id}"]`;
            if (url.endsWith("=bundle")) {
                const reference = '[data-item-reference="minecraft:bundle/selected_item"]';
                const expectParts = selected => selected ? expectModels("item/bundle_open_back", selected, "item/bundle_open_front") : expectModels("item/bundle");
                const expectBundleCamera = async () => {
                    const camera = await page.evaluate(() => ({ orthographic: window.renderer.camera.isOrthographicCamera,
                        position: window.renderer.camera.position.toArray(), zoom: window.renderer.camera.zoom }));
                    if (!camera.orthographic || camera.zoom !== 24 || camera.position.some((n, i) => Math.abs(n - [0, 0, 100][i]) > 0.0001)) {
                        problems.add(`Bundle camera changed its scale or direction: ${JSON.stringify(camera)}`);
                    }
                };
                await expectParts("item/apple");
                await expectBundleCamera();
                await setControl(property("bundle/has_selected_item"), false);
                await expectParts();
                if (await page.$eval(reference, input => input.value) !== "minecraft:apple") problems.add("Changing a property removed the independent item reference.");
                await page.screenshot({ path: path.join(shots, `${name}_closed.png`) });
                await setControl(property("bundle/has_selected_item"), true);
                await expectParts("item/apple");
                await setControl(reference, "minecraft:diamond_block");
                await expectParts("block/diamond_block");
                await expectBundleCamera();
                await page.screenshot({ path: path.join(shots, `${name}_diamond_block.png`) });
                await setControl(reference, "minecraft:apple");
                await expectParts("item/apple");
                await setControl(reference, "minecraft:diamond_block");
                await expectParts("block/diamond_block");
                for (const pose of ["ground", ""]) {
                    await setControl("#item-display", pose);
                    await expectParts();
                }
                await setControl("#item-display", "gui");
                await expectParts("block/diamond_block");
                await page.select(".playground-panel > label select", "sword");
                await waitReady();
                if (await page.$$eval("[data-item-property], [data-item-reference]", controls => controls.length)) problems.add("Preset switch retained item state.");
                await page.select(".playground-panel > label select", "bundle");
                await waitReady();
                await expectParts("item/apple");
                await expectBundleCamera();
                await page.$eval(reference, control => control.parentElement.parentElement.querySelector("button").click());
                await waitReady();
                await expectModels("item/bundle_open_back", "item/bundle_open_front");
                await page.evaluate(() => {
                    const section = [...document.querySelectorAll("summary")].find(summary => summary.textContent === "Add reference").parentElement;
                    section.open = true;
                    const inputs = section.querySelectorAll("input");
                    inputs[0].value = "minecraft:bundle/selected_item";
                    inputs[1].value = "minecraft:apple";
                    section.querySelector("button").click();
                });
                await waitReady();
                await expectParts("item/apple");
                await page.$eval(property("bundle/has_selected_item"), control => control.parentElement.parentElement.querySelector("button").click());
                await waitReady();
                await expectParts();
                await page.evaluate(() => {
                    const section = [...document.querySelectorAll("summary")].find(summary => summary.textContent === "Add property").parentElement;
                    section.open = true;
                    section.querySelector("input").value = "minecraft:bundle/has_selected_item";
                    section.querySelector("select").value = "boolean";
                    section.querySelector("button").click();
                });
                await waitReady();
                await expectParts();
                await setControl(property("bundle/has_selected_item"), true);
                await expectParts("item/apple");
                const code = await page.evaluate(() => window.playground.code());
                if (!code.includes('properties: {"minecraft:bundle/has_selected_item":true}')
                    || !code.includes('itemReferences: { "minecraft:bundle/selected_item": new MineRender.AssetKey("minecraft", "apple", "models", "item") }')) {
                    problems.add("Generated code does not reproduce the configured item properties and references.");
                }
            } else if (url.endsWith("=bow")) {
                await expectModels("item/bow_pulling_0");
                for (const [ticks, model] of [[12, 0], [13, 1], [17, 1], [18, 2], [20, 2], [0, 0]]) {
                    await setControl(property("use_duration"), ticks);
                    await expectModels(`item/bow_pulling_${model}`);
                }
                await setControl(property("using_item"), false);
                await expectModels("item/bow");
                await setControl(property("using_item"), true);
                await expectModels("item/bow_pulling_0");
            } else if (url.endsWith("=crossbow")) {
                await expectModels("item/crossbow_arrow");
                for (const [charge, model] of [["rocket", "crossbow_firework"], ["none", "crossbow"], ["arrow", "crossbow_arrow"]]) {
                    await setControl(property("charge_type"), charge);
                    await expectModels(`item/${model}`);
                }
            } else {
                await expectModels("item/wooden_sword");
                const initial = await page.$eval("#item-components", textarea => JSON.parse(textarea.value));
                if (JSON.stringify(initial) !== JSON.stringify({ "minecraft:custom_model_data": { floats: [0, 0] } })) {
                    problems.add("Custom-model-data components are not shown on initial load.");
                }
                for (const [floats, sword] of [[[1, 0], "golden"], [[0, 1], "iron"], [[1, 1], "diamond"], [[1], "golden"], [[0, 0], "wooden"], [[1, 1], "diamond"]]) {
                    await page.$eval("#item-components", (textarea, floats) => {
                        textarea.value = JSON.stringify({ "minecraft:custom_model_data": { floats } });
                        textarea.closest("fieldset").querySelector("button").click();
                    }, floats);
                    await waitReady();
                    await expectModels(`item/${sword}_sword`);
                }
                await setControl("#item-count", 3);
                await expectModels("item/diamond_sword");
                await page.screenshot({ path: path.join(shots, `${name}_diamond.png`) });
                const code = await page.evaluate(() => window.playground.code());
                if (!code.includes('count: 3, components: {"minecraft:custom_model_data":{"floats":[1,1]}}')
                    || !code.includes("class DemoItemSource extends MineRender.AssetSource") || !code.includes("finally {")) {
                    problems.add("Generated custom-model-data code omits the item inputs or scoped fixture source.");
                }
                const standalone = await browser.newPage();
                try {
                    await standalone.goto(base);
                    await standalone.addScriptTag({ path: path.resolve(root, "../../packages/minerender/dist/bundle.js") });
                    const result = await standalone.evaluate(async source => {
                        const run = new Function("MineRender", `return (async () => {${source.replace(/^import \* as MineRender from "minerender";\s*/, "")}\nreturn { model, renderer };})()`);
                        const { model, renderer } = await run(window.MineRender);
                        const result = { model: model.key.toNamespacedString(), sources: window.MineRender.AssetLoader._SOURCES.map(entry => entry.key) };
                        renderer.dispose();
                        return result;
                    }, code);
                    if (result.model !== "minecraft:item/diamond_sword" || result.sources.includes("playground-custom-model-data")) {
                        problems.add(`Generated CMD code produced the wrong model or retained its source: ${JSON.stringify(result)}`);
                    }
                } finally { await standalone.close(); }
                await page.select(".playground-panel > label select", "sword");
                await waitReady();
                await expectModels("item/iron_sword");
                const state = await page.evaluate(() => window.playground.state);
                if (state.count !== 1 || Object.keys(state.components).length) problems.add("Preset switch retained stack inputs.");
                await page.select(".playground-panel > label select", "custom_model_data");
                await waitReady();
                await expectModels("item/wooden_sword");
            }
        }
    } catch (error) {
        problems.add(`load failed: ${error.message}`);
    }
    await page.close();
    if (problems.size) failures++;
    console.log(`${problems.size ? "FAIL" : " ok "} ${url.padEnd(44)} ${status.split("\n")[0].slice(0, 80)}`);
    for (const problem of problems) console.log(`       ${problem.slice(0, 300)}`);
    return presets;
}

for (const url of pages) {
    const name = url.replace(/[^a-z0-9]+/gi, "_").replace(/_$/, "");
    const presets = await visit(url, name);
    for (const preset of presets) await visit(`${url}?preset=${preset}`, `${name}_${preset}`);
}

await browser.close();
server.kill();
console.log(failures ? `\n${failures} page(s) reported problems. Screenshots: ${shots}` : `\nAll pages loaded. Screenshots: ${shots}`);
process.exit(failures ? 1 : 0);
