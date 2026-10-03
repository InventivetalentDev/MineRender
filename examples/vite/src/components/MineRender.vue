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
    OrbitControls,
    Renderer,
    ArchiveAssetSource,
    BrowserArchiveProxy,
    Caching
} from "minerender";
import {Vector3} from "three";
import { onMounted, ref } from "vue";

const assetRoot = "https://assets.mcasset.cloud/1.17.1";
AssetLoader.ROOT = assetRoot;
AssetLoader.addSource("mcassets-fallback", new HostedAssetSource(
    "https://raw.githubusercontent.com/InventivetalentDev/minerender-fallback-assets/master",
    {retryDefaults: false}
));
AssetLoader.addSource("mcassets", new HostedAssetSource(assetRoot, {retryDefaults: false}));

const renderContainer = ref<HTMLDivElement>();

const zip = ref<File>();

const onFileChange = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    zip.value = file;
    recreate();
}

const recreate = () => {
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
        debug: {
            grid: true,
            axes: true
        }
    });

// @ts-ignore
    window['renderer'] = renderer as any;


    if (zip.value) {
        console.log(zip.value)
        const proxy = new BrowserArchiveProxy(zip.value);
        console.log(proxy)
        proxy.getEntries().then(x => console.log(x));
        const source = new ArchiveAssetSource(proxy);
        AssetLoader.addSource("ziptest", source);
        Caching.clear();
    }


    async function createModel(type: string, name: string, instances = 1) {
        Caching.clear()
        await Models.clearCache();

        return Models.getMerged(new AssetKey("minecraft", name, "models", type, "assets")).then(model => {
            console.log(model)
            return renderer.scene.addModel(model!, {
                mergeMeshes: true,
                instanceMeshes: true,
                wireframe: true,
                maxInstanceCount: instances
            })


        });
    }


    const controls = new OrbitControls(renderer.camera, renderer.renderer.domElement);
    renderer.registerEventDispatcher(controls);
    controls.update();

    renderContainer.value?.children[0]?.remove();
    console.log(renderContainer.value)
    renderer.appendTo(renderContainer.value!);

    renderer.start();

    createModel("item", "diamond_sword").then(model=>{
        model.setPosition(new Vector3(-16 * 3, 0, 0));
    })

    renderer.scene.addSkin("https://textures.minecraft.net/texture/fb5f93b1ccebf7b385fa488c6d4cfec87cf1b855f8dbe0308da44167cae170b")

    createModel("block", "stone").then(model=>{
        model.setPosition(new Vector3(16 * 3, 0, 0));
    })
}

onMounted(() => {
    recreate()
})
</script>
