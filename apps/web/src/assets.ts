import { AssetKey, AssetLoader, DEFAULT_ROOT, HostedAssetSource } from "minerender";

const root = "https://assets.mcasset.cloud/1.17.1";

class DemoAssetSource extends HostedAssetSource {
    public assetBasePath(key: AssetKey) {
        const base = super.assetBasePath(key);
        // List APIs set the library's default root explicitly, bypassing the source root.
        return base.startsWith(DEFAULT_ROOT + "/")
            ? root + base.slice(DEFAULT_ROOT.length)
            : base;
    }
}

AssetLoader.ROOT = root;
AssetLoader.addSource("mcassets-fallback", new DemoAssetSource(
    "https://raw.githubusercontent.com/InventivetalentDev/minerender-fallback-assets/master",
    { retryDefaults: false }
));
AssetLoader.addSource("mcassets", new DemoAssetSource(root, { retryDefaults: false }));
