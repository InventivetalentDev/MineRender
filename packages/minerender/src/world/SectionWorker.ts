import { Env } from "../Env";
import type { SectionGeometryInput, SectionGeometryPage } from "./SectionGeometry";

/** Runs section geometry builds in the environment's shared worker. */
export class SectionWorker {
    private static initialized = false;
    private static instance: SectionWorker | undefined;
    private nextId = 0;
    private readonly pending = new Map<number, {
        resolve: (pages: SectionGeometryPage[]) => void;
        reject: (error: Error) => void;
    }>();

    private constructor(private worker: Worker | undefined) {
        worker!.addEventListener("message", (event: MessageEvent<
            { id: number; type: "pages"; pages: SectionGeometryPage[] } |
            { id: number; type: "error"; message: string }
        >) => {
            const reply = event.data;
            const pending = this.pending.get(reply.id);
            if (!pending) return;
            this.pending.delete(reply.id);
            if (reply.type === "pages") pending.resolve(reply.pages);
            else pending.reject(new Error(reply.message));
        });
        // A failed worker or an undeliverable message leaves the pending builds unanswerable, so stop using it.
        worker!.addEventListener("error", event => this.fail(event.message || "Section worker failed"));
        worker!.addEventListener("messageerror", () => this.fail("Section worker message could not be deserialized"));
    }

    /** The shared worker, or undefined when the environment has none or a previous worker failed. */
    public static shared(): SectionWorker | undefined {
        if (!this.initialized) {
            this.initialized = true;
            const worker = Env.provider.createWorker?.("section");
            if (worker) this.instance = new SectionWorker(worker);
        }
        return this.instance;
    }

    /** Builds geometry without transferring the input buffers away from the caller. */
    public build(input: SectionGeometryInput): Promise<SectionGeometryPage[]> {
        if (!this.worker) return Promise.reject(new Error("Section worker terminated"));
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            this.pending.set(id, { resolve, reject });
            this.worker!.postMessage({ id, type: "build", input });
        });
    }

    /** Rejects pending builds, terminates the worker, and makes shared() return undefined. */
    public terminate(): void {
        this.fail("Section worker terminated");
    }

    private fail(message: string): void {
        const error = new Error(message);
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        this.worker?.terminate();
        this.worker = undefined;
        SectionWorker.instance = undefined;
    }
}
