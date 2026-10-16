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

type Runtime = {
    process?: { versions?: { node?: string }; stdout?: { isTTY?: boolean }; env?: Record<string, string | undefined> };
    localStorage?: { getItem(key: string): string | null };
};

const runtime = globalThis as Runtime;
const levels: Record<LogThreshold, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
const colors: Record<LogLevel, number> = { debug: 90, info: 36, warn: 33, error: 31 };

let threshold: LogThreshold = "warn";
let namespaces: Map<string, LogThreshold> | undefined;
let logHandler: LogHandler | undefined;
let tagStyle: "plain" | "ansi" | "browser" | undefined;
let switchRead = false;
let switchThreshold: LogThreshold | undefined;
let switchNamespaces: Map<string, LogThreshold> | undefined;

function readSwitch(): void {
    switchRead = true;
    let value: string | null | undefined;
    if (typeof runtime.process?.versions?.node === "string") {
        value = runtime.process.env?.MINERENDER_LOG;
    } else {
        try {
            value = runtime.localStorage?.getItem("minerender:log");
        } catch {
            // Sandboxed pages can deny access to storage.
        }
    }
    if (value) {
        for (const entry of value.split(",")) {
            const separator = entry.indexOf("=");
            const name = separator < 0 ? undefined : entry.slice(0, separator).trim();
            const setting = (separator < 0 ? entry : entry.slice(separator + 1)).trim();
            if (!Object.prototype.hasOwnProperty.call(levels, setting) || name === "") continue;
            if (name === undefined) {
                switchThreshold = setting as LogThreshold;
            } else {
                switchNamespaces ??= new Map();
                switchNamespaces.set(name, setting as LogThreshold);
            }
        }
    }
}

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
        if (!switchRead) readSwitch();
        if (levels[level] < levels[switchNamespaces?.get(namespace) ?? switchThreshold ?? namespaces?.get(namespace) ?? threshold]) return;
        if (logHandler) {
            logHandler(level, namespace, args);
            return;
        }
        if (tagStyle === undefined) {
            tagStyle = typeof runtime.process?.versions?.node === "string"
                ? runtime.process.stdout?.isTTY === true ? "ansi" : "plain"
                : "browser";
        }
        if (tagStyle === "browser") {
            console[level](`%cMineRender%c ${namespace}`, "background:#3c8527;color:#fff;border-radius:3px;padding:0 4px", "font-weight:bold", ...args);
        } else {
            const color = colors[level];
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
