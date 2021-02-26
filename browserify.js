const fs = require("fs");
const path = require("path");
const browserify = require('browserify');
const tsify = require('tsify');
const babelify = require('babelify');

browserify({
    "standalone": "MineRender"
})
    .add('src/index.ts')
    .plugin(tsify, {target: 'es6'})
    .transform(babelify, {extensions: ['.tsc', '.ts', '.js'], sourceMaps:true})
    .bundle()
    .on('error', function (error) {
        console.error(error.toString());
    })
    .pipe(fs.createWriteStream(path.resolve(__dirname, 'dist/bundle.js')));
