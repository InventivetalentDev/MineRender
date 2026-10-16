import test from "ava";
import { Logging, logger, LogHandler } from "../src/util/log";

process.env.MINERENDER_LOG = " info , A=debug, B=bogus, =error, C=silent, D=warn, D=debug";

test.serial("saved logging settings override configuration", t => {
    t.teardown(() => { Logging.configure({ level: "warn", namespaces: {} }); Logging.setHandler(); });
    const messages: Parameters<LogHandler>[] = [];
    Logging.setHandler((...message) => { messages.push(message); });
    logger("A").debug("namespace");
    logger("B").debug("filtered");
    logger("B").info("invalid override ignored");
    logger("C").error("filtered");
    logger("D").debug("later override");
    logger("E").debug("filtered");
    logger("E").info("default");
    Logging.configure({ level: "error", namespaces: { A: "error", F: "debug" } });
    logger("A").debug("switch namespace");
    logger("F").debug("filtered");
    logger("F").info("switch default");
    logger("E").info("switch default after configure");
    t.deepEqual(messages, [
        ["debug", "A", ["namespace"]],
        ["info", "B", ["invalid override ignored"]],
        ["debug", "D", ["later override"]],
        ["info", "E", ["default"]],
        ["debug", "A", ["switch namespace"]],
        ["info", "F", ["switch default"]],
        ["info", "E", ["switch default after configure"]],
    ]);
});
