const path = require('path');
const webpack = require('webpack');
const ProgressBarPlugin = require('progress-bar-webpack-plugin');
const packg = require("./package.json");

const banner = "MineRender " + packg.version + "\n" +
    "(c) 2018, Haylee Schäfer (inventivetalent) / MIT License\n" +
    "https://minerender.org\n" +
    "Build #" + (process.env.TRAVIS_BUILD_NUMBER || Date.now()) + " / " + new Date().toString()

let baseConfigFull = {
    mode: "development",
    context: path.resolve(__dirname),
    entry: './src/SOME_DIR/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'OUT_NAME.js'
    },
    externals: {
        jquery: 'jQuery',
        three: "THREE"
    },
    plugins: [
        new webpack.DefinePlugin({
            PRODUCTION: JSON.stringify(false),
            BUILD_DATE: JSON.stringify(new Date()),
            VERSION: JSON.stringify(packg.version),
            BUILD_TIMESTAMP: JSON.stringify(Date.now()),
            BUILD_NUMBER: JSON.stringify(process.env.TRAVIS_BUILD_NUMBER)
        }),
        new webpack.BannerPlugin(banner),
        new ProgressBarPlugin()
    ]
};

let baseConfigMin = {
    mode: "production",
    context: path.resolve(__dirname),
    entry: './src/SOME_DIR/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'OUT_NAME.min.js'
    },
    externals: {
        jquery: 'jQuery',
        three: "THREE"
    },
    plugins: [
        new webpack.DefinePlugin({
            PRODUCTION: JSON.stringify(true),
            BUILD_DATE: JSON.stringify(new Date()),
            VERSION: JSON.stringify(packg.version),
            BUILD_TIMESTAMP: JSON.stringify(Date.now()),
            BUILD_NUMBER: JSON.stringify(process.env.TRAVIS_BUILD_NUMBER)
        }),
        new webpack.BannerPlugin(banner)
    ]
};


////// Actual Configs below

let skinConfig = Object.assign({}, baseConfigMin, {
    entry: './src/skin/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'skin.min.js'
    },
});
let skinConfigFull = Object.assign({}, baseConfigFull, {
    entry: './src/skin/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'skin.js'
    },
});

let modelConfig = Object.assign({}, baseConfigMin, {
    entry: './src/model/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'model.min.js'
    },
});
let modelConfigFull = Object.assign({}, baseConfigFull, {
    entry: './src/model/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'model.js'
    },
});

let guiConfig = Object.assign({}, baseConfigMin, {
    entry: './src/gui/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'gui.min.js'
    },
});
let guiConfigFull = Object.assign({}, baseConfigFull, {
    entry: './src/gui/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'gui.js'
    },
});

let entityConfig = Object.assign({}, baseConfigMin, {
    entry: './src/entity/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'entity.min.js'
    },
});
let entityConfigFull = Object.assign({}, baseConfigFull, {
    entry: './src/entity/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'entity.js'
    },
});


let combinedConfig = Object.assign({}, baseConfigMin, {
    entry: './src/combined/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'all.min.js'
    },
});
let combinedConfigFull = Object.assign({}, baseConfigFull, {
    entry: './src/combined/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'all.js'
    },
});


// Index scripts
let dataConfig = Object.assign({}, baseConfigMin, {
    entry: './js/data.js',
    output: {
        path: path.resolve(__dirname, './js'),
        filename: 'data.min.js'
    },
});
let mainConfig = Object.assign({}, baseConfigMin, {
    entry: './js/main.js',
    output: {
        path: path.resolve(__dirname, './js'),
        filename: 'main.min.js'
    },
});

module.exports = [
    skinConfig, skinConfigFull,
    modelConfig, modelConfigFull,
    guiConfig, guiConfigFull,
    entityConfig, entityConfigFull,

    combinedConfig, combinedConfigFull,

    dataConfig,
    mainConfig
];