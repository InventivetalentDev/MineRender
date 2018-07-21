import GuiRender from "../gui/index";
import ModelRender from "../model/index";
import SkinRender from "../skin/index";
import Render from "../renderBase";

class CombinedRender extends Render {

    constructor(options, element) {
        super(options, {}, element);

        this.renderType = "CombinedRender";
    }

    init (renders, cb) {
        let combinedRender = this;

        super.initScene(function () {
            combinedRender.element.dispatchEvent(new CustomEvent("combinedRender", {detail: {renders: renders}}));
        }, true);


        for (let i = 0; i < renders.length; i++) {
            attachTo(renders[i], combinedRender);
        }

        if (typeof cb === "function") cb();
    };

    render (cb) {
        this._animate();

        if (typeof cb === "function") cb();
    };
}


function attachTo(self, target) {
    console.log("Attaching " + self.constructor.name + " to " + target.constructor.name);

    self._scene = target._scene;
    // self._camera = target._camera;
    // self._renderer = target._renderer;
    // self._composer = target._composer;
    // self._canvas = target._canvas;
    self.attached = true;
}

CombinedRender.prototype.constructor = CombinedRender;

window.CombinedRender = CombinedRender;

// Add the other render classes here, because adding them as separate scripts bugs out THREE.js
window.GuiRender = GuiRender;
window.ModelRender = ModelRender;
window.SkinRender = SkinRender;

export default CombinedRender;