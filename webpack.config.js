const path = require('path');

let skinConfig = {
    context: path.resolve(__dirname),
    entry: './src/skin/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'skin.min.js'
    },
    externals: {
        jquery: 'jQuery',
        three: "THREE"
    }
};
let skinConfigFull = {
    context: path.resolve(__dirname),
    entry: './src/skin/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'skin.js'
    },
    externals: {
        jquery: 'jQuery',
        three: "THREE"
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
    },
    externals: {
        jquery: 'jQuery',
        three: "THREE"
    }
};
let modelConfigFull = {
    context: path.resolve(__dirname),
    entry: './src/model/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'model.js'
    },
    externals: {
        jquery: 'jQuery',
        three: "THREE"
    },
    optimization: {
        minimize: false
    }
};

let guiConfig = {
    context: path.resolve(__dirname),
    entry: './src/gui/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'gui.min.js'
    },
    externals: {
        jquery: 'jQuery',
        three: "THREE"
    }
};
let guiConfigFull = {
    context: path.resolve(__dirname),
    entry: './src/gui/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'gui.js'
    },
    externals: {
        jquery: 'jQuery',
        three: "THREE"
    },
    optimization: {
        minimize: false
    }
};


let combinedConfig = {
    context: path.resolve(__dirname),
    entry: './src/combined/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'all.min.js'
    },
    externals: {
        jquery: 'jQuery',
        three: "THREE"
    }
};
let combinedConfigFull = {
    context: path.resolve(__dirname),
    entry: './src/combined/index.js',
    output: {
        path: path.resolve(__dirname, './dist'),
        filename: 'all.js'
    },
    externals: {
        jquery: 'jQuery',
        three: "THREE"
    },
    optimization: {
        minimize: false
    }
};

module.exports = [
    skinConfig, skinConfigFull,
    modelConfig, modelConfigFull,
    guiConfig, guiConfigFull,

    combinedConfig, combinedConfigFull
];