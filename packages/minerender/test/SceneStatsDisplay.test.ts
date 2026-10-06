import test from "ava";
import { SceneStatsDisplay } from "../src/inspector/SceneStatsDisplay";
import type { Renderer } from "../src/renderer/Renderer";

test.serial("disposing scene stats stops updates and releases its lines and DOM", t => {
    const globals = { document: globalThis.document, setInterval, clearInterval };
    t.teardown(() => { Object.assign(globalThis, globals); });
    const timers = new Map<object, () => void>();
    let attached: unknown;
    const container = {
        classList: { add() {} },
        children: [] as unknown[],
        append(child: unknown) { this.children.push(child); },
        replaceChildren() { this.children.length = 0; },
        remove() { attached = undefined; }
    };
    globalThis.document = { createElement: tag => tag === "div" ? container : {} } as unknown as Document;
    globalThis.setInterval = ((callback: () => void, delay: number) => {
        t.is(delay, 1000);
        const timer = {};
        timers.set(timer, callback);
        return timer;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = (timer => { timers.delete(timer as object); }) as typeof clearInterval;

    const display = new SceneStatsDisplay({} as Renderer);
    let updates = 0;
    display.add({ wrapper: {}, update: () => { updates++; } } as Parameters<SceneStatsDisplay["add"]>[0]);
    display.appendTo({ append: child => { attached = child; } } as unknown as HTMLElement);
    for (const update of timers.values()) update();
    t.is(updates, 1);
    t.is(attached, container);
    t.is(container.children.length, 2);

    display.dispose();
    display.dispose();
    for (const update of timers.values()) update();
    t.is(updates, 1);
    t.is(timers.size, 0);
    t.is(attached, undefined);
    t.is(container.children.length, 0);
    t.is(display["lines"].length, 0);
});
