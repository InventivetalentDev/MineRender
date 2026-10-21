import { installMineRenderDataFixtures } from "./helpers/minerender-data";
import test from "ava";
import { Models } from "../src/assets/Models";
import { BlockStateVariant } from "../src/model/block/BlockState";
import { Model } from "../src/model/Model";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { UVMapper } from "../src/UVMapper";
import { SectionModels } from "../src/world/SectionModels";

let restoreData: () => void;
test.before(() => { restoreData = installMineRenderDataFixtures(); });
test.after.always(() => restoreData());

test.serial("preparation starts every variant load and keeps choices in group order", async t => {
    const getMerged = Models.getMerged, getAtlas = UVMapper.getAtlas;
    t.teardown(() => { Models.getMerged = getMerged; UVMapper.getAtlas = getAtlas; });
    const finishes: ((model: Model) => void)[] = [], started: string[] = [], atlases: Model[] = [];
    Models.getMerged = key => new Promise(resolve => { started.push(key.path); finishes.push(resolve); });
    UVMapper.getAtlas = async model => {
        atlases.push(model);
        return { model, image: { width: 2, height: 2 } } as TextureAtlas;
    };
    const variants: BlockStateVariant[] = [{ model: "test:block/first" }, { model: "test:block/second" }];
    const pending = new SectionModels()["prepare"]({ multipart: variants.map(apply => ({ apply })) }, {});
    await new Promise<void>(resolve => setImmediate(resolve));
    t.deepEqual(started, ["first", "second"]);
    const models: Model[] = variants.map(() => ({ elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }] }));
    finishes[1](models[1]);
    await new Promise<void>(resolve => setImmediate(resolve));
    t.deepEqual(atlases, [models[1]]);
    finishes[0](models[0]);
    const prepared = (await pending)!;
    t.deepEqual([...prepared.choices.keys()], variants);
    t.deepEqual([...prepared.choices.values()].map(choice => choice.model), models);
});

test.serial("preparation returns undefined for a missing model and throws the first variant's rejection", async t => {
    const getMerged = Models.getMerged, getAtlas = UVMapper.getAtlas;
    t.teardown(() => { Models.getMerged = getMerged; UVMapper.getAtlas = getAtlas; });
    const failure = new Error("first variant failed"), models = new SectionModels();
    const model: Model = { elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }] };
    const state = { variants: { "": [{ model: "test:block/first" }, { model: "test:block/missing" }] } };
    Models.getMerged = async key => key.path === "missing" ? undefined : model;
    UVMapper.getAtlas = async model => ({ model, image: { width: 2, height: 2 } } as TextureAtlas);
    t.is(await models["prepare"](state, {}), undefined);
    Models.getMerged = async key => {
        if (key.path === "first") throw failure;
        return undefined;
    };
    await t.throwsAsync(models["prepare"](state, {}), { is: failure });
});
