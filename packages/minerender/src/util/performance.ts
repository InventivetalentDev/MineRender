export function captureException(e: any, ...extra: any[]) {
    console.error(e, extra);
    //TODO
}

export function timingStart(marker: string) {
    console.time(marker);
    //TODO
}

export function timingEnd(marker: string) {
    console.timeEnd(marker);
    //TODO
}
