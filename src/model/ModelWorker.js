import { parseModel, loadAndMergeModel,  modelCacheKey, loadTextures } from "./modelFunctions";

export default function worker(self) {
    console.debug("New Worker!")
    self.addEventListener("message", event => {
        let msg = event.data;

        if (msg.func === "parseModel") {
            parseModel(msg.model, msg.modelOptions, [], msg.assetRoot).then((parsedModelList) => {
                self.postMessage({msg: "done",parsedModelList:parsedModelList})
                close();
            })
        } else if (msg.func === "loadAndMergeModel") {
            loadAndMergeModel(msg.model, msg.assetRoot).then((mergedModel) => {
                self.postMessage({msg: "done",mergedModel:mergedModel});
                close();
            })
        } else if (msg.func === "loadTextures") {
            loadTextures(msg.textures, msg.assetRoot).then((textures) => {
                self.postMessage({msg: "done",textures:textures});
                close();
            })
        } else {
            console.warn("Unknown function '" + msg.func + "' for ModelWorker");
            console.warn(msg);
            close();
        }
    })
};
