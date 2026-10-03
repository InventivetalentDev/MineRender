export interface Disposable {
    dispose(): void;
}

export function isDisposable(obj: any): obj is Disposable {
    return 'dispose' in obj;
}
