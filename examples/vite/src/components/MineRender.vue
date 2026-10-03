<style scoped>
.render-container {
    width: 100vw;
    height: 100vh;
    position: absolute;
    top: 0;
    left: 0;
}
.file-picker {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 100;
}
</style>
<template>
    <div>
        <div class="file-picker">
            <input type="file" accept=".zip" aria-label="Resource pack ZIP" @change="onFileChange">
        </div>
        <div ref="renderContainer" class="render-container"></div>

    </div>

</template>
<script setup lang="ts">
import {
    AssetKey,
    AssetLoader,
    HostedAssetSource,
    Models,
    Renderer,
    ArchiveAssetSource,
    BrowserArchiveProxy,
    Caching
} from "minerender";
import {Vector3} from "three";
import { onBeforeUnmount, onMounted, ref } from "vue";

const assetRoot = "https://assets.mcasset.cloud/1.17.1";
AssetLoader.ROOT = assetRoot;
AssetLoader.addSource("mcassets-fallback", new HostedAssetSource(
    "https://raw.githubusercontent.com/InventivetalentDev/minerender-fallback-assets/master",
    {retryDefaults: false}
));
AssetLoader.addSource("mcassets", new HostedAssetSource(assetRoot, {retryDefaults: false}));

const renderContainer = ref<HTMLDivElement>();

const zip = ref<File>();
let activeRenderer: Renderer | undefined;
let pendingLoads = Promise.resolve();

const onFileChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    zip.value = file;
    recreate();
}

const recreate = () => {
    const previous = activeRenderer;
    activeRenderer = undefined;
    previous?.dispose();

    const renderer = new Renderer({
        camera: {
            near: 1,
            far: 2000
        },
        render: {
            stats: true,
            fpsLimit: 0,
            antialias: false
        },
        composer: {
            enabled: false
        },
        controls: {
            enabled: true
        },
        debug: {
            grid: true,
            axes: true
        }
    });
    activeRenderer = renderer;
    const isCurrent = () => activeRenderer === renderer;
    const file = zip.value;

// @ts-ignore
    window['renderer'] = renderer as any;

    async function createModel(type: string, name: string, position: Vector3, instances = 1) {
        if (!isCurrent()) return;
        const model = await Models.getMerged(new AssetKey("minecraft", name, "models", type, "assets"));
        if (!isCurrent()) return;
        if (!model) throw new Error(`Could not load ${type}/${name}`);
        const object = await renderer.scene.addModel(model, {
            mergeMeshes: true,
            instanceMeshes: true,
            wireframe: true,
            maxInstanceCount: instances
        });
        if (!isCurrent()) {
            renderer.scene.clear();
            return;
        }
        object.setPosition(position);
    }

    async function createSkin() {
        if (!isCurrent()) return;
        await renderer.scene.addSkin("https://textures.minecraft.net/texture/fb5f93b1ccebf7b385fa488c6d4cfec87cf1b855f8dbe0308da44167cae170b");
        if (!isCurrent()) renderer.scene.clear();
    }

    renderer.appendTo(renderContainer.value!);
    renderer.start();

    // Finish earlier requests before replacing the global asset source and clearing its caches.
    pendingLoads = pendingLoads.then(async () => {
        if (!isCurrent()) return;
        const proxy = file ? new BrowserArchiveProxy(file) : undefined;
        if (proxy) await proxy.getEntries();
        if (!isCurrent()) return;

        AssetLoader.removeSource("ziptest");
        if (proxy) AssetLoader.addSource("ziptest", new ArchiveAssetSource(proxy));
        Caching.clear();
        await Models.clearCache();
        if (!isCurrent()) return;

        const results = await Promise.allSettled([
            createModel("item", "diamond_sword", new Vector3(-16 * 3, 0, 0)),
            createSkin(),
            createModel("block", "stone", new Vector3(16 * 3, 0, 0))
        ]);
        if (!isCurrent()) {
            renderer.scene.clear();
            return;
        }
        for (const result of results) {
            if (result.status === "rejected") console.error(result.reason);
        }
    }).catch(error => {
        if (isCurrent()) console.error(error);
        else renderer.scene.clear();
    });
}

onMounted(() => {
    recreate()
})

onBeforeUnmount(() => {
    const renderer = activeRenderer;
    activeRenderer = undefined;
    renderer?.dispose();
});
</script>
