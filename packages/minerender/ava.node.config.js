module.exports = {
    ...require("./ava.config.js"),
    files: ["test/node/**/*.test.ts", "test/node/**/*.test.mjs"],
    extensions: { ts: "commonjs", mjs: true },
    // The native gl addon cannot initialize in concurrent worker threads.
    workerThreads: false,
    require: ["./test/node/register.cjs"]
};
