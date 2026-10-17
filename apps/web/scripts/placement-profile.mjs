import { readFile } from "node:fs/promises";
import ts from "typescript";
import path from "node:path";

const modules = ["Chunk", "SectionMesh", "SectionModels", "UVMapper"];
const hooks = "globalThis.__minerenderPlacementProfile";

/** Instruments the benchmark bundle; the library's source and package output stay unchanged. */
export function instrumentPlacementModule(contents, name) {
    const source = ts.createSourceFile(`${name}.mjs`, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const edits = [];
    const fail = detail => { throw new Error(`Placement profiling: ${name}: ${detail}; rebuild the library or update the instrumentation`); };
    function find(root, predicate, description) {
        const matches = [];
        function visit(node) {
            if (predicate(node)) matches.push(node);
            ts.forEachChild(node, visit);
        }
        visit(root);
        if (matches.length !== 1) fail(`expected one ${description}, found ${matches.length}`);
        return matches[0];
    }
    const method = name => find(source, node => ts.isMethodDeclaration(node) && node.name.getText(source) === name, `${name} method`);
    function bindings(target, names) {
        const declared = new Set();
        function binding(name) {
            if (ts.isIdentifier(name)) declared.add(name.text);
            else for (const element of name.elements) if (ts.isBindingElement(element)) binding(element.name);
        }
        function visit(node) {
            if (ts.isParameter(node) || ts.isVariableDeclaration(node)) binding(node.name);
            ts.forEachChild(node, visit);
        }
        visit(target);
        for (const name of names) if (!declared.has(name)) fail(`missing ${name} binding in ${target.name.getText(source)}`);
    }
    const call = (root, name) => find(root, node => ts.isCallExpression(node) && node.expression.getText(source) === name, `${name} call`);
    const text = node => node.getText(source);
    const measure = (kind, metadata, parent, action, asynchronous = false) =>
        `${hooks}.${asynchronous ? "measureAsync" : "measure"}(${JSON.stringify(kind)}, ${metadata}, ${parent}, ${action})`;
    const wrap = (kind, metadata, body, parent = "undefined") =>
        `return ${measure(kind, metadata, parent, `async (__placementSpan) => {${body}}`, true)};`;
    function body(target, changes = [], wrapper) {
        const start = target.body.getStart(source) + 1, end = target.body.end - 1;
        let value = contents.slice(start, end);
        for (const { node, value: replacement } of changes.sort((a, b) => b.node.getStart(source) - a.node.getStart(source))) {
            const from = node.getStart(source) - start, to = node.end - start;
            value = value.slice(0, from) + replacement + value.slice(to);
        }
        edits.push({ start, end, value: wrapper ? wrapper(value) : value });
    }
    function parameter(target, expected, value) {
        if (target.parameters.length !== expected) fail(`expected ${expected} parameters in ${text(target.name)}`);
        const end = target.parameters.at(-1).end;
        edits.push({ start: end, end, value: `, ${value}` });
    }
    if (name === "Chunk") {
        const target = method("rebuildSectionMesh"), build = call(target, "SectionMesh.buildAsync");
        if (build.arguments.length !== 4) fail("expected four section build arguments");
        body(target, [{ node: build, value: `${text(build).slice(0, -1)}, __placementSpan)` }], value =>
            wrap("section-rebuild", "{x: this.x, y: this.y, z: this.z}", value));
    } else if (name === "SectionMesh") {
        const target = method("buildAsync");
        bindings(target, ["entries", "fluids"]);
        parameter(target, 4, "__placementParent");
        const input = call(target, "toInput"), worker = call(target, "worker.build"), assembly = call(target, "this.fromPages");
        const fallback = [];
        function visit(node) {
            if (ts.isCallExpression(node) && node.expression.getText(source) === "buildSectionGeometry") fallback.push(node);
            ts.forEachChild(node, visit);
        }
        visit(target);
        if (fallback.length !== 2) fail(`expected two geometry fallback calls, found ${fallback.length}`);
        body(target, [
            { node: input, value: measure("section-input", "{}", "__placementSpan", `() => ${text(input)}`) },
            { node: worker, value: measure("worker-roundtrip", "{}", "__placementSpan", `() => ${text(worker)}`, true) },
            { node: assembly, value: `${text(assembly).slice(0, -1)}, __placementSpan)` },
            ...fallback.map(node => ({ node, value: measure("synchronous-geometry", "{}", "__placementSpan", `() => ${text(node)}`) }))
        ], value => wrap("section-build", "{entries: entries.length, fluids: !!fluids}", value, "__placementParent"));
        const assemble = method("fromPages");
        bindings(assemble, ["pages", "page", "canvas", "context"]);
        parameter(assemble, 2, "__placementParent");
        const loop = find(assemble, node => ts.isForOfStatement(node) && node.expression.getText(source) === "pages", "page loop");
        const statements = loop.statement.statements;
        if (!statements || statements.length < 4 || !text(statements[0]).includes("createCanvas(page.width, page.height)")
            || !text(statements[1]).includes('canvas.getContext("2d")') || !ts.isForOfStatement(statements[2])
            || !text(statements[3]).includes("new BufferGeometry()")) fail("atlas painting boundary changed");
        const paintStart = statements[0].getStart(source), paintEnd = statements[2].end;
        const originalPaint = contents.slice(paintStart, paintEnd);
        const paintNode = { getStart: () => paintStart, end: paintEnd };
        body(assemble, [{ node: paintNode, value:
            `const {canvas, context} = ${measure("atlas-paint", "{pixels: page.width * page.height}", "__placementSpan",
                `() => {${originalPaint}\nreturn {canvas, context};}`)};` }], value =>
            `return ${measure("mesh-assembly", "{pages: pages.length, triangles: pages.reduce((sum, page) => sum + page.indices.length / 3, 0)}",
                "__placementParent", `(__placementSpan) => {${value}}`)};`);
    } else if (name === "SectionModels") {
        for (const [name, kind] of [["prepareState", "state-preparation"], ["prepare", "state-resolution"], ["template", "template-preparation"]]) {
            const target = method(name);
            bindings(target, [name === "template" ? "model" : "blockState"]);
            const changes = [];
            if (name === "template") {
                const load = call(target, "cached").arguments.at(-1);
                if (!ts.isArrowFunction(load) || !ts.isBlock(load.body)) fail("expected a template cache loader");
                changes.push({ node: load.body, value: `{${wrap("template-build", "{model: model.key?.toNamespacedString()}",
                    contents.slice(load.body.getStart(source) + 1, load.body.end - 1), "__placementSpan")}}` });
            }
            body(target, changes, value => wrap(kind, name === "template" ? "{model: model.key?.toNamespacedString()}"
                : "{block: blockState.key?.toNamespacedString()}", value));
        }
    } else if (name === "UVMapper") {
        const target = method("createAtlas");
        bindings(target, ["originalModel"]);
        body(target, [], value => wrap("model-atlas", "{model: originalModel.key?.toNamespacedString()}", value));
    } else fail("unexpected module");
    for (const edit of edits.sort((a, b) => b.start - a.start)) contents = contents.slice(0, edit.start) + edit.value + contents.slice(edit.end);
    return contents;
}

export function placementProfilePlugin() {
    const instrumented = new Set();
    return {
        name: "placement-profile",
        setup(build) {
            build.onLoad({ filter: /\/dist\/browser\/esm\/(?:world\/(?:Chunk|SectionMesh|SectionModels)|UVMapper)\.mjs$/ }, async ({ path: file }) => {
                const name = path.basename(file, ".mjs");
                const contents = instrumentPlacementModule(await readFile(file, "utf8"), name);
                instrumented.add(name);
                return { contents, loader: "js" };
            });
            build.onEnd(result => {
                if (result.errors.length) return;
                const missing = modules.filter(name => !instrumented.has(name));
                if (missing.length) return { errors: [{ text: `Placement profiling: missing ESM modules: ${missing.join(", ")}` }] };
            });
        }
    };
}
