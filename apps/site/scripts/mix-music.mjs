// Adds a music track to a finished cut without re-encoding the video.
//
//   node ./scripts/mix-music.mjs .video/hero.mp4 path/to/track.mp3            writes .video/hero-music.mp4
//   node ./scripts/mix-music.mjs .video/hero.mp4 track.mp3 --out final.mp4
//   node ./scripts/mix-music.mjs .video/hero.mp4 track.mp3 --fade 3 --loudness -16
//
// The track is looped if it is shorter than the video, trimmed to the video, faded in over one
// second and out over `fade` seconds (default 2.5) at the end, and normalised to `loudness` LUFS
// (default -18, quiet enough to sit under a feed's own audio). render-video.mjs calls this with --music.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Duration of a media file in seconds, via ffprobe. */
export function duration(file) {
    const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`ffprobe failed for ${file}: ${result.stderr}`);
    const seconds = Number(result.stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`No duration for ${file}`);
    return seconds;
}

/** Muxes `music` under `video` into `output`; the video stream is copied as-is. */
export async function mixMusic(video, music, output, { fade = 2.5, loudness = -18 } = {}) {
    const seconds = duration(video);
    const fadeOut = Math.min(fade, seconds / 2);
    const audio = [
        `atrim=0:${seconds.toFixed(3)}`,
        "afade=t=in:d=1",
        `afade=t=out:st=${(seconds - fadeOut).toFixed(3)}:d=${fadeOut}`,
        `loudnorm=I=${loudness}:TP=-1.5:LRA=11`
    ].join(",");
    const child = spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", video,
        "-stream_loop", "-1", "-i", music,
        "-map", "0:v", "-map", "1:a",
        "-filter:a", audio,
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", "-movflags", "+faststart",
        output
    ], { stdio: ["ignore", "inherit", "inherit"] });
    await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg mix exited with ${code}`)));
    });
    return output;
}

/** Default output name: `<video>-music.mp4` next to the video. */
export function musicOutput(video) {
    const { dir, name } = path.parse(video);
    return path.join(dir, `${name}-music.mp4`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const positional = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
    const option = name => {
        const index = process.argv.indexOf(`--${name}`);
        return index === -1 ? undefined : process.argv[index + 1];
    };
    const [video, music] = positional;
    if (!video || !music) {
        console.error("usage: mix-music.mjs <video.mp4> <music> [--out file] [--fade seconds] [--loudness lufs]");
        process.exit(2);
    }
    const output = option("out") ?? musicOutput(video);
    const options = {};
    if (option("fade") !== undefined) options.fade = Number(option("fade"));
    if (option("loudness") !== undefined) options.loudness = Number(option("loudness"));
    await mixMusic(video, music, output, options);
    console.log(output);
}
