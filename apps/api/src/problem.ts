import { STATUS_CODES } from "node:http";

export class ApiError extends Error {
    constructor(public readonly status: number, detail: string) {
        super(detail);
    }

    public toJSON() {
        return { type: "about:blank", title: STATUS_CODES[this.status] ?? "Request failed",
            status: this.status, detail: this.message };
    }
}
