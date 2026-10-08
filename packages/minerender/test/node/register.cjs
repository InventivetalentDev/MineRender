const Module = require("node:module");
const extensions = { ...Module._extensions };
require("esbuild-runner").install({ esbuild: { external: ["canvas", "gl"] } });
const typescript = Module._extensions[".ts"];
Object.assign(Module._extensions, extensions);
for (const extension of Object.keys(Module._extensions)) {
    if (!(extension in extensions)) delete Module._extensions[extension];
}
Module._extensions[".ts"] = typescript;
