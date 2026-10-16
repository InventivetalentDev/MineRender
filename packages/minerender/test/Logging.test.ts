import test from "ava";
import { Logging, logger, LogHandler } from "../src/util/log";

test.serial("logging defaults to warnings and errors", t => {
    t.teardown(() => { Logging.configure({ level: "warn", namespaces: {} }); Logging.setHandler(); });
    const messages: Parameters<LogHandler>[] = [];
    Logging.setHandler((...message) => { messages.push(message); });
    const log = logger("Test");
    log.debug("debug");
    log.info("info");
    log.warn("warn");
    log.error("error");
    t.deepEqual(messages, [["warn", "Test", ["warn"]], ["error", "Test", ["error"]]]);
});

test.serial("namespace thresholds apply to existing loggers and match exact names", t => {
    t.teardown(() => { Logging.configure({ level: "warn", namespaces: {} }); Logging.setHandler(); });
    const messages: Parameters<LogHandler>[] = [], a = logger("A");
    Logging.setHandler((...message) => { messages.push(message); });
    Logging.configure({ level: "error", namespaces: { A: "debug", C: "silent" } });
    a.debug("debug");
    logger("B").warn("warn");
    logger("B").error("error");
    logger("C").error("silent");
    logger("constructor").warn("warn");
    logger("AA").warn("warn");
    t.deepEqual(messages, [["debug", "A", ["debug"]], ["error", "B", ["error"]]]);
});

test.serial("configuration preserves omitted settings and replaces namespace overrides", t => {
    t.teardown(() => { Logging.configure({ level: "warn", namespaces: {} }); Logging.setHandler(); });
    const messages: Parameters<LogHandler>[] = [];
    Logging.setHandler((...message) => { messages.push(message); });
    Logging.configure({ level: "error", namespaces: { A: "debug", C: "silent" } });
    Logging.configure({ level: "debug" });
    logger("A").debug("override");
    logger("B").debug("default");
    logger("C").error("silent");
    Logging.configure({ namespaces: {} });
    logger("C").debug("cleared");
    t.deepEqual(messages, [["debug", "A", ["override"]], ["debug", "B", ["default"]], ["debug", "C", ["cleared"]]]);
});

test.serial("handlers receive the original argument values", t => {
    t.teardown(() => { Logging.configure({ level: "warn", namespaces: {} }); Logging.setHandler(); });
    const value = { key: "value" };
    let received: unknown[] = [];
    Logging.setHandler((level, namespace, args) => { received = args; });
    logger("Test").warn("message", value, undefined);
    t.deepEqual(received, ["message", value, undefined]);
    t.is(received[1], value);
});

test.serial("clearing the handler restores tagged console output", t => {
    t.teardown(() => { Logging.configure({ level: "warn", namespaces: {} }); Logging.setHandler(); });
    const warn = console.warn, messages: unknown[][] = [], value = { key: "value" };
    console.warn = (...args) => { messages.push(args); };
    t.teardown(() => { console.warn = warn; });
    Logging.setHandler(() => { t.fail("handler should be cleared"); });
    Logging.setHandler();
    logger("Test").warn("message", value);
    t.is(messages.length, 1);
    t.true(String(messages[0][0]).includes("minerender:Test"));
    t.deepEqual(messages[0].slice(1), ["message", value]);
});
