import * as THREE from "three";
import * as $ from 'jquery';
import mergeDeep from "../lib/merge";
import { loadTextureAsBase64, initScene, attachTo } from "../renderBase";

import GuiRender from "../gui/index";
import ModelRender from "../model/index";
import SkinRender from "../skin/index";

let defaultOptions = {
    showOutlines: false,
    showAxes: false,
    showGrid: false,
    controls: {
        enabled: true,
        zoom: true,
        rotate: true,
        pan: true
    },
    camera: {
        x: 20,
        y: 20,
        z: 20,
        target: [0, 0, 0]
    },
    canvas: {
        width: undefined,
        height: undefined
    },
};

function CombinedRender(options, element) {
    this.options = Object.assign({}, defaultOptions, options);
    this.element = element || document.body;
}

CombinedRender.prototype.init = function (renders, cb) {
    let combinedRender = this;

    initScene(this, function () {
        combinedRender.element.dispatchEvent(new CustomEvent("combinedRender", {detail: {renders: renders}}));
    }, true);


    for (let i = 0; i < renders.length; i++) {
        attachTo(renders[i], combinedRender);
    }

    if (typeof cb === "function") cb();
};

CombinedRender.prototype.render = function (cb) {
    this._animate();

    if (typeof cb === "function") cb();
};


CombinedRender.prototype.constructor = CombinedRender;

window.CombinedRender = CombinedRender;
window.CombinedRender.GuiRender = GuiRender;
window.CombinedRender.ModelRender = ModelRender;
window.CombinedRender.SkinRender = SkinRender;

export default CombinedRender;