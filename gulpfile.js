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
    let bundler = browserify('src/index.ts', Object.assign({}, watchify.args,
        {
            cache: {},
            packageCache: {},
            debug: true,
            standalone: "MineRender",
            insertGlobals: true,
        }
    ))
        .plugin(tsify, {
            project: 'tsconfig.json'
        })
        .transform(babelify, {
            extensions: ['.tsc', '.ts', '.js'],
            sourceMaps: true,
            global: true,
            compact: false,
            plugins: ['@babel/plugin-transform-modules-commonjs']
        })
    bundler.on('log', l => console.log(l));

    bundler.on('error', function (error) {
        console.error("bundler error (1)");
        console.error(error);
    });

    function rebundle() {
        console.log("bundling...")
        console.time("bundle")
        return bundler

            .bundle()
            .on('error', function (error) {
                console.error("bundler error (2)");
                console.error(error);
            })

            .pipe(source('bundle.js'))
            .pipe(buffer())
            .pipe(sourcemaps.init({loadMaps: true}))
            .pipe(sourcemaps.write('./'))
            .pipe(gulp.dest('dist'))

            .on('end', function () {
                console.timeEnd("bundle");
                console.log("bundle done!")
            });
    }

    if (watch) {
        // bundler = watchify(bundler);
        bundler.plugin(watchify)
        bundler.on('update', rebundle);
    }
    return rebundle();
}

gulp.task('bundle', function () {
    return bundle(false);
});
gulp.task('bundle:w', function () {
    return bundle(true);
});
