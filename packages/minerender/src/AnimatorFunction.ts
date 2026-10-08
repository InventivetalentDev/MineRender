/** Advances a texture animation by one tick. Return `false` when its pixels have not changed. */
export interface AnimatorFunction {
    (): boolean | void;
}
