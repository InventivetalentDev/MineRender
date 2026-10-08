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
