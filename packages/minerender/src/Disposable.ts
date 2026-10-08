/** An object that can release the resources it owns. */
export interface Disposable {
    dispose(): void;
}

export function isDisposable(obj: any): obj is Disposable {
    return 'dispose' in obj;
}
