/** Settings passed to {@link Renderer.toVideo}. */
export interface VideoExportOptions {
    /** Recording duration in seconds, greater than zero and at most 2147483.647. */
    duration: number;
    /** Requested capture rate (default 30). Rendering and browser scheduling can lower the actual rate. */
    fps?: number;
    /** Supported video MIME type. Defaults to WebM when available, then MP4. */
    mimeType?: string;
    /** Target video bitrate in bits per second, as a positive unsigned 32-bit integer. */
    videoBitsPerSecond?: number;
    /** Cancels recording and discards its output. */
    signal?: AbortSignal;
}

/** Records fresh canvas frames in a browser, at a fixed size with an opaque black background. */
export class VideoExporter {
    /** Resolves after the recorder provides its final video data. */
    public readonly result: Promise<Blob>;

    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D;
    private readonly signal?: AbortSignal;
    private readonly duration: number;
    private stream?: MediaStream;
    private recorder?: MediaRecorder;
    private timer?: ReturnType<typeof setTimeout>;
    private readonly chunks: Blob[] = [];
    private settled = false;
    private stopping = false;
    private resolve!: (blob: Blob) => void;
    private reject!: (reason: unknown) => void;

    constructor(private readonly source: HTMLCanvasElement, options: VideoExportOptions) {
        const fps = options.fps ?? 30;
        if (!Number.isFinite(options.duration) || options.duration <= 0 || options.duration * 1000 > 2147483647) {
            throw new RangeError("Video duration must be greater than zero and at most 2147483.647 seconds");
        }
        if (!Number.isFinite(fps) || fps <= 0) throw new RangeError("Video fps must be a finite positive number");
        const bitrate = options.videoBitsPerSecond;
        if (bitrate !== undefined && (!Number.isInteger(bitrate) || bitrate <= 0 || bitrate > 0xffffffff)) {
            throw new RangeError("Video bitrate must be a positive unsigned 32-bit integer");
        }
        if (!source.width || !source.height) throw new Error("Cannot export video from an empty canvas");
        options.signal?.throwIfAborted();
        if (typeof document === "undefined" || typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
            throw new Error("Video export requires a browser with MediaRecorder support");
        }
        const mimeTypes = options.mimeType === undefined
            ? ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]
            : [options.mimeType];
        const mimeType = mimeTypes.find(type => type.startsWith("video/") && MediaRecorder.isTypeSupported(type));
        if (!mimeType) throw new Error("The browser does not support the requested video format");

        this.canvas = document.createElement("canvas");
        this.canvas.width = source.width;
        this.canvas.height = source.height;
        if (typeof this.canvas.captureStream !== "function") throw new Error("Video export requires canvas captureStream support");
        const context = this.canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Could not create a canvas for video export");
        this.context = context;
        this.signal = options.signal;
        this.duration = options.duration;
        this.result = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });

        try {
            this.stream = this.canvas.captureStream(fps);
            this.recorder = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: bitrate });
            this.recorder.addEventListener("start", this.onStart);
            this.recorder.addEventListener("dataavailable", this.onData);
            this.recorder.addEventListener("stop", this.onStop);
            this.recorder.addEventListener("error", this.onError);
            for (const track of this.stream.getTracks()) {
                track.addEventListener("ended", this.onTrackEnded);
                track.addEventListener("mute", this.onTrackEnded);
            }
            this.signal?.addEventListener("abort", this.onAbort, { once: true });
            this.recorder.start();
        } catch (error) {
            this.cancel(error);
        }
    }

    /** Copies a freshly drawn source frame before WebGL can clear its drawing buffer. */
    public capture(): void {
        if (this.settled || this.stopping) return;
        try {
            this.context.fillStyle = "#000000";
            this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.context.drawImage(this.source, 0, 0, this.canvas.width, this.canvas.height);
        } catch (error) {
            this.cancel(error);
        }
    }

    /** Cancels recording, releases its capture stream, and rejects {@link result}. */
    public cancel(reason: unknown = new DOMException("Video export cancelled", "AbortError")): void {
        if (this.settled) return;
        this.settled = true;
        this.cleanup();
        this.reject(reason);
    }

    private readonly onStart = () => {
        this.timer = setTimeout(() => {
            this.stopping = true;
            try {
                this.recorder!.stop();
            } catch (error) {
                this.cancel(error);
            }
        }, this.duration * 1000);
    };

    private readonly onData = (event: BlobEvent) => {
        if (event.data.size) this.chunks.push(event.data);
    };

    private readonly onStop = () => {
        if (!this.stopping) return this.cancel(new Error("Video recording stopped before its duration elapsed"));
        if (!this.chunks.length) return this.cancel(new Error("The browser produced no video data"));
        const mimeType = this.chunks.find(chunk => chunk.type)?.type || this.recorder!.mimeType;
        const blob = new Blob(this.chunks, { type: mimeType });
        this.settled = true;
        this.cleanup();
        this.resolve(blob);
    };

    private readonly onError = (event: Event) => {
        this.cancel((event as Event & { error?: Error }).error ?? new Error("Video recording failed"));
    };

    private readonly onAbort = () => { this.cancel(this.signal!.reason); };
    private readonly onTrackEnded = () => { this.cancel(new Error("The video capture stream stopped producing frames")); };

    private cleanup(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.signal?.removeEventListener("abort", this.onAbort);
        if (this.recorder) {
            this.recorder.removeEventListener("start", this.onStart);
            this.recorder.removeEventListener("dataavailable", this.onData);
            this.recorder.removeEventListener("stop", this.onStop);
            this.recorder.removeEventListener("error", this.onError);
            if (this.recorder.state !== "inactive") {
                try { this.recorder.stop(); } catch {}
            }
        }
        for (const track of this.stream?.getTracks() ?? []) {
            track.removeEventListener("ended", this.onTrackEnded);
            track.removeEventListener("mute", this.onTrackEnded);
            track.stop();
        }
        this.chunks.length = 0;
    }
}
