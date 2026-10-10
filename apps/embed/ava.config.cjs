module.exports = {
    files: ["test/*.test.ts"],
    extensions: { ts: "commonjs" },
    require: ["esbuild-runner/register"],
    workerThreads: false
};
