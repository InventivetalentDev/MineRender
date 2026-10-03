import { MineRenderScene } from "../renderer/MineRenderScene";
import { Renderer } from "../renderer/Renderer";

export class SceneStatsDisplay {

    readonly statsContainer: HTMLDivElement;

    private readonly lines: StatLine[] = [];

    constructor(readonly renderer: Renderer) {
        this.statsContainer = document.createElement("div");

        this.init();
    }

    protected init() {
        this.statsContainer.classList.add("minerender-stats");

        setInterval(() => {
            for (let line of this.lines) {
                line.update();
            }
        }, 1000);
    }

    appendTo(el: HTMLElement) {
        el.append(this.statsContainer);
    }

    add(line?: StatLine) {
        if (typeof line !== "undefined") {
            this.lines.push(line);
            this.statsContainer.append(line.wrapper);
        }
        this.statsContainer.append(document.createElement("br"));
    }



}

class StatLine {

    readonly wrapper: HTMLSpanElement;
    readonly element: HTMLSpanElement;

    value: number = 0;

    constructor(readonly key: string, readonly shortName: string, readonly longName: string, readonly valueProvider: () => number) {
        this.wrapper = document.createElement("span");
        this.wrapper.classList.add("minerender-stat-wrapper");
        this.wrapper.title = longName;

        this.element = document.createElement("span");
        this.element.classList.add("minerender-stat");
        this.element.id = "minerender-stat-" + key;
        this.element.dataset["stat"] = key;

        this.wrapper.append(shortName);
        this.wrapper.append(this.element);
    }

    update() {
        this.value = this.valueProvider();
        this.element.innerText = `${ this.value }`;
    }

}
