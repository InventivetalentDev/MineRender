import Timeout = NodeJS.Timeout;

export class BatchedExecutor {

    public readonly interval: number;
    public readonly batch: number;

    private readonly queue: Task[];
    private readonly task: Timeout;

    constructor(interval: number = 1, batch: number = 30) {
        this.interval = interval;
        this.batch = batch;

        this.queue = [];
        this.task = setInterval(() => this.run());
    }

    public submit(task: Task): void {
        this.queue.push(task);
    }

    private run() {
        for (let i = 0; i < this.batch; i++) {
            this.runNext();
        }
    }

    private runNext() {
        let next = this.queue.shift();
        if (next) next();
    }


}

type Task = () => any | Promise<any>
