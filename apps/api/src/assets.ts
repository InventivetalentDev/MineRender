/** Validates additional trusted origins configured by the service operator. */
export function normalizeAssetOrigins(values: readonly string[] = []): string[] {
    return [...new Set(values.map(value => {
        let url: URL;
        try { url = new URL(value); }
        catch { throw new Error("assetOrigins must contain HTTPS origins"); }
        if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
            throw new Error("assetOrigins must contain HTTPS origins without paths, credentials, queries, or fragments");
        }
        return url.origin;
    }))];
}

function allowedUrl(url: URL, origins: readonly string[]): boolean {
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return false;
    if (origins.includes(url.origin)) return true;
    if (url.port || url.search) return false;
    switch (url.hostname) {
        case "assets.mcasset.cloud": return true;
        case "raw.githubusercontent.com":
            return url.pathname.startsWith("/InventivetalentDev/minerender-fallback-assets/master/");
        case "mcproxy.dev":
            return /^\/(?:uuid|skin|cape)\/[a-zA-Z0-9_-]{1,36}$/.test(url.pathname);
        case "textures.minecraft.net":
            return /^\/texture\/[a-fA-F0-9]{1,64}$/.test(url.pathname);
        default: return false;
    }
}

export function guardFetch(origins: readonly string[] = []): () => void {
    const fetch = globalThis.fetch;
    let totalBytes = 0;
    globalThis.fetch = async (input, init) => {
        let request = new Request(input, init);
        if (request.method !== "GET" && request.method !== "HEAD") throw new Error("Unsupported asset request method");
        for (let redirects = 0; redirects <= 5; redirects++) {
            if (!allowedUrl(new URL(request.url), origins)) throw new Error("Unsupported asset source");
            const response = await fetch(request, { redirect: "manual" });
            if (![301, 302, 303, 307, 308].includes(response.status)) {
                if (!response.ok || !response.body) return response;
                const reader = response.body.getReader();
                const chunks: Uint8Array[] = [];
                let size = 0;
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        size += value.length;
                        totalBytes += value.length;
                        if (size > 8 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) {
                            throw new Error("Asset download exceeds the size limit");
                        }
                        chunks.push(value);
                    }
                } catch (error) {
                    await reader.cancel().catch(() => {});
                    throw error;
                } finally {
                    reader.releaseLock();
                }
                const bounded = new Response(Buffer.concat(chunks, size), response);
                Object.defineProperty(bounded, "url", { value: response.url });
                return bounded;
            }
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location || redirects === 5) throw new Error("Invalid asset redirect");
            request = new Request(new URL(location, request.url), request);
        }
        throw new Error("Too many asset redirects");
    };
    return () => { globalThis.fetch = fetch; };
}
