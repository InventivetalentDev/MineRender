const path = require('path');
const webpack = require('webpack');
const ProgressBarPlugin = require('progress-bar-webpack-plugin');

module.exports = {
    mode: "development",
    target: "es8",
    entry: "./src/index.ts",
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "bundle.js",
        libraryTarget: "umd",
        library: "MineRender"
    },
    externals: {
        three: "THREE",
        canvas: "canvas"
    },
    resolve: {
        extensions: [".tsx", ".ts", ".js"]
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/, use: ["ts-loader"], exclude: /node_modules|dist|lib/
            }
        ]
    },
    plugins: [
        new ProgressBarPlugin()
    ]
}
