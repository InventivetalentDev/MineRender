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

module.exports = [
    skinConfig, skinConfigFull
];