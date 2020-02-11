import GuiRender from "../gui/index";
import ModelRender from "../model/index";
import SkinRender from "../skin/index";
import Render from "../renderBase";
import EntityRender from "../entity";

/**
 * A renderer-wrapper to combine the individual aspects of renderers into a single scene, e.g. render a player and a block at once
 */
class CombinedRender extends Render {

    /**
     * @param {Object} [options] The options for this renderer, see {@link defaultOptions}
     * @param {HTMLElement} [element=document.body] DOM Element to attach the renderer to - defaults to document.body
     */
    constructor(options, element) {
        super(options, {}, element);

        this.renderType = "CombinedRender";
    }

    /**
     * Initializes the renderer - This has to be called before {@link render}
     * @param {Render[]} renders Array of render objects
     */
    init(renders) {
        let combinedRender = this;

        super.initScene(function () {
            combinedRender.element.dispatchEvent(new CustomEvent("combinedRender", {detail: {renders: renders}}));
        }, true);


        for (let i = 0; i < renders.length; i++) {
            attachTo(renders[i], combinedRender);
        }
    };

    /**
     * Starts rendering - This has to be called after {@link init}
     */
    render() {
        this._animate();
    };
}

/**
 * @ignore
 */
function attachTo(self, target) {
    console.log("Attaching " + self.constructor.name + " to " + target.constructor.name);

    self._scene = target._scene;
    self._camera = target._camera;
    // self._renderer = target._renderer;
    // self._composer = target._composer;
    // self._canvas = target._canvas;
    self.attached = true;
}

CombinedRender.prototype.constructor = CombinedRender;

CombinedRender.GuiRender = GuiRender;
CombinedRender.ModelRender = ModelRender;
CombinedRender.SkinRender = SkinRender;

if(typeof window !== "undefined") {
    window.CombinedRender = CombinedRender;

// Add the other render classes here, because adding them as separate scripts bugs out THREE.js
    window.GuiRender = GuiRender;
    window.ModelRender = ModelRender;
    window.SkinRender = SkinRender;
}
if (typeof global !== "undefined") {
    global.CombinedRender = CombinedRender;

    global.GuiRender = GuiRender;
    global.ModelRender = ModelRender;
    global.SkinRender = SkinRender;
}

export default CombinedRender;
