const path = require('path');

let skinConfig = {
    context: path.resolve(__dirname),
    entry: './src/skin/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'skin.min.js'
    }
};
let skinConfigFull = {
    context: path.resolve(__dirname),
    entry: './src/skin/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'skin.js'
    },
    optimization: {
        minimize: false
    }
};

let modelConfig = {
    context: path.resolve(__dirname),
    entry: './src/model/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'model.min.js'
    }
};
let modelConfigFull = {
    context: path.resolve(__dirname),
    entry: './src/model/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'model.js'
    },
    optimization: {
        minimize: false
    }
};

module.exports = [
    /*skinConfig,*/ skinConfigFull,
    /*modelConfig,*/modelConfigFull
];