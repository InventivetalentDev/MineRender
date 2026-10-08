// https://stackoverflow.com/a/60323233/6257838
/** Reports invalid Minecraft data or an unsupported rendering operation. */
export class MineRenderError extends Error {
    constructor(msg) {
        super(msg);
        Object.setPrototypeOf(this, MineRenderError.prototype);
    }

    get name(): string {
        return 'MineRenderError';
    }
}
