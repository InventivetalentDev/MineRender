/** Severity of a log message, from most to least verbose. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** The lowest level that is printed, or `"silent"` to print nothing. */
export type LogThreshold = LogLevel | "silent";

/** Receives each message that passes the threshold. `args` are the logger call's arguments, without a tag. */
export type LogHandler = (level: LogLevel, namespace: string, args: unknown[]) => void;

export interface LoggingOptions {
    /** Threshold for namespaces without an override. Starts at `"warn"`. */
    level?: LogThreshold;
    /** Thresholds by logger name, such as `{ UVMapper: "debug" }`. Replaces earlier overrides. */
    namespaces?: Record<string, LogThreshold>;
}

export interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

let threshold: LogThreshold = "warn";
let namespaces: Map<string, LogThreshold> | undefined;
let logHandler: LogHandler | undefined;
let tagStyle: "plain" | "ansi" | "browser" | undefined;

/** Global log settings for every MineRender logger. */
export class Logging {
    /** Updates the given settings and keeps the others. */
    static configure(options: LoggingOptions): void {
        if (options.level !== undefined) threshold = options.level;
        if (options.namespaces !== undefined) namespaces = new Map(Object.entries(options.namespaces));
    }

    /** Sends messages to `handler` instead of the console. Call without an argument to restore console output. */
    static setHandler(handler?: LogHandler): void {
        logHandler = handler;
    }
}

/** Creates a logger whose messages are tagged and filtered as `namespace`. */
export function logger(namespace: string): Logger {
    const write = (level: LogLevel, args: unknown[]): void => {
        const levels: LogThreshold[] = ["debug", "info", "warn", "error", "silent"];
        if (levels.indexOf(level) < levels.indexOf(namespaces?.get(namespace) ?? threshold)) return;
        if (logHandler) {
            logHandler(level, namespace, args);
            return;
        }
        if (tagStyle === undefined) {
            const runtime = globalThis as { process?: { versions?: { node?: string }; stdout?: { isTTY?: boolean } } };
            tagStyle = typeof runtime.process?.versions?.node === "string"
                ? runtime.process.stdout?.isTTY === true ? "ansi" : "plain"
                : "browser";
        }
        if (tagStyle === "browser") {
            console[level](`%cMineRender%c ${namespace}`, "background:#3c8527;color:#fff;border-radius:3px;padding:0 4px", "font-weight:bold", ...args);
        } else {
            const color = { debug: 90, info: 36, warn: 33, error: 31 }[level];
            const tag = `[minerender:${namespace}]`;
            console[level](tagStyle === "ansi" ? `\x1b[${color}m${tag}\x1b[0m` : tag, ...args);
        }
    };
    return {
        debug: (...args) => write("debug", args),
        info: (...args) => write("info", args),
        warn: (...args) => write("warn", args),
        error: (...args) => write("error", args),
    };
}

const Reset = "\x1b[0m"
const FgGreen = "\x1b[32m"
const BgBlack = "\x1b[40m"

/** @deprecated Use {@link logger}. */
export function prefix(prefix?: string): string {
    return `${ FgGreen }MR${ BgBlack }${ prefix ?? '' }${ Reset }`
}
