// Tests run straight off the TypeScript sources - esbuild-runner transpiles on require, so there
// is no build step to keep in sync. (The previous config declared rewritePaths src/ -> dist/cjs/,
// a leftover from the dual-tsc pipeline that tsup replaced; that directory no longer exists.)
module.exports = {
    files: ["test/**/*.test.ts"],
    extensions: {
        ts: "commonjs"
    },
    require: ["esbuild-runner/register"]
}
