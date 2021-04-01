export interface Disposable {
    dispose(): void;
}

export function isDisposable(object: any): object is Disposable {
    return 'dispose' in object;
}
