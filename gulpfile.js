const fs = require("fs");
const path = require("path");

const gulp = require('gulp');
const source = require('vinyl-source-stream');
const buffer = require('vinyl-buffer');
const sourcemaps = require('gulp-sourcemaps');

const browserify = require('browserify');
const watchify = require('watchify');
const tsify = require('tsify');
const babelify = require('babelify');

function bundle(watch) {
    let bundler = browserify({
        debug: true,
        standalone: "MineRender"
    });

    function rebundle() {
        console.log("bundling...")
        return bundler
            .add('src/index.ts')

            .plugin(tsify, {target: 'es6'})
            .transform(babelify, {
                extensions: ['.tsc', '.ts', '.js'],
                sourceMaps: true
            })

            .bundle()
            .on('error', function (error) {
                console.error(error.toString());
            })

            .pipe(source('bundle.js'))
            .pipe(buffer())
            .pipe(sourcemaps.init({loadMaps: true}))
            .pipe(sourcemaps.write('./'))
            .pipe(gulp.dest('dist'))
    }

    if (watch) {
        bundler = watchify(bundler);
        bundler.on('update', rebundle);
    }
    return rebundle();
}

gulp.task('bundle',function () {
    return bundle(false);
});
gulp.task('bundle:w', function () {
    return bundle(true);
});
