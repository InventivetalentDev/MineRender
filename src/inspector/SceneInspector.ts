import { MineRenderScene } from "../renderers/MineRenderScene";
import { Renderer } from "../renderers/Renderer";
import { Euler, Intersection, Object3D, Raycaster, Vector2, Vector3 } from "three";
import { isSceneObject } from "../renderers/SceneObject";
import { toDegrees, toRadians } from "../util/util";
import { isTransformable, Transformable } from "../Transformable";

export class SceneInspector {

    readonly objectInfoContainer: HTMLDivElement;
    readonly objectControlsContainer: HTMLDivElement;

    protected readonly raycaster: Raycaster;

    public selectedObject?: Object3D;

    constructor(readonly renderer: Renderer) {
        this.objectInfoContainer = document.createElement("div");
        this.objectControlsContainer = document.createElement("div");

        this.raycaster = new Raycaster();

        this.init();
    }

    protected init() {
        this.objectInfoContainer.classList.add("minerender-inspector", "minerender-object-info");
        this.objectControlsContainer.classList.add("minerender-inspector", "minerender-object-controls");

        document.addEventListener("click", event => {
            if ((<HTMLElement>event.target)?.nodeName !== "CANVAS") return;

            const mouse = new Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
            this.raycaster.setFromCamera(mouse, this.renderer.camera);
            const intersects = this.raycaster.intersectObjects(this.renderer.scene.children, true);
            if (intersects.length > 0) {
                console.log(intersects);
                this.handleRaycasterObjects(intersects)
            }
        })
    }

    protected handleRaycasterObjects(intersections: Intersection[]) {
        const firstIntersection = intersections[0];
        if (firstIntersection && firstIntersection.object) {
            const firstObject = firstIntersection.object;
            console.log(firstObject);

            let targetIntersection: Intersection;
            let targetObject: Object3D;
            const firstSceneObjectIntersection = intersections.find(i => i.object && i.object.parent && isSceneObject(i.object.parent));
            if (firstSceneObjectIntersection && firstSceneObjectIntersection.object) {
                targetIntersection = firstSceneObjectIntersection;
                targetObject = firstSceneObjectIntersection.object;
            } else {
                // fallback to first intersect
                targetIntersection = firstIntersection;
                targetObject = firstObject;
            }

            this.selectedObject = targetObject;

            this.objectInfoContainer.innerHTML = '';
            this.addInfoLine("Distance", "D", targetIntersection.distance);
            this.addInfoLine("Instance #", "I", targetIntersection.instanceId);
            this.addInfoLine("Type", "T", targetObject.type);
            this.addInfoLine("Name", "N", targetObject.name);
            if (targetObject.parent) {
                this.addInfoLine("Parent", "P", targetObject.parent.constructor.name);
                if (isSceneObject(targetObject.parent)) {

                }
            }

            this.objectControlsContainer.innerHTML = '';
            this.addControls(targetObject, targetIntersection);
        }
    }

    protected addInfoLine(name: string, id: string, value: any): HTMLElement {
        const el = document.createElement("span");
        el.innerText = `${ id }: ${ value }`;
        el.setAttribute("title", name);

        this.objectInfoContainer.append(el);
        this.objectInfoContainer.append(document.createElement("br"));

        return el;
    }

    protected addControls(object: Object3D, intersection: Intersection) {
        const container = document.createElement("div");

        container.append(this.toggleControl("V", object.visible, v => object.visible = v));

        if (intersection.instanceId) {
            //TODO
        } else {

        }

        const posRange = 16 * 8;
        if(isTransformable(object.parent)){
            const parent: Transformable = object.parent;
            container.append(this.rangeControl("X", -posRange, posRange, object.parent.getPosition().x, v => {
                parent.setPosition(new Vector3(v, parent.getPosition().y, parent.getPosition().z))
            }));
            container.append(this.rangeControl("Y", -posRange, posRange, object.parent.getPosition().y, v => {
                parent.setPosition(new Vector3(parent.getPosition().x, v, parent.getPosition().z))
            }));
            container.append(this.rangeControl("Z", -posRange, posRange, object.parent.getPosition().z, v => {
                parent.setPosition(new Vector3(parent.getPosition().x, parent.getPosition().y, v))
            }));
        }else {
            container.append(this.rangeControl("X", -posRange, posRange, object.position.x, v => object.position.setX(v)));
            container.append(this.rangeControl("Y", -posRange, posRange, object.position.y, v => object.position.setY(v)));
            container.append(this.rangeControl("Z", -posRange, posRange, object.position.z, v => object.position.setZ(v)));
        }

        const rotRange = 360;
        if(isTransformable(object.parent)){
            const parent: Transformable = object.parent;
            container.append(this.rangeControl("X", 0, rotRange, toDegrees(object.parent.getRotation().x), v => {
                parent.setRotation(new Euler(toRadians(v), parent.getRotation().y, parent.getRotation().z))
            }));
            container.append(this.rangeControl("Y", 0, rotRange, toDegrees(object.parent.getRotation().y), v => {
                parent.setRotation(new Euler(parent.getRotation().x, toRadians(v), parent.getRotation().z))
            }));
            container.append(this.rangeControl("Z", 0, rotRange, toDegrees(object.parent.getRotation().z), v => {
                parent.setRotation(new Euler(parent.getRotation().x, parent.getRotation().y, toRadians(v)));
            }));
        }else {
            container.append(this.rangeControl("X", 0, rotRange, toDegrees(object.rotation.x), v => object.rotation.x = toRadians(v)));
            container.append(this.rangeControl("Y", 0, rotRange, toDegrees(object.rotation.y), v => object.rotation.y = toRadians(v)));
            container.append(this.rangeControl("Z", 0, rotRange, toDegrees(object.rotation.z), v => object.rotation.z = toRadians(v)));
        }

        this.objectControlsContainer.append(container);
    }


    protected toggleControl(name: string, val: boolean, change: (v: boolean) => void): HTMLElement {
        const label = document.createElement("label");
        label.innerText = name;

        const toggle = document.createElement("input");
        toggle.setAttribute("type", "checkbox");
        toggle.checked = val; //TODO: instance
        toggle.addEventListener("change", e => {
            change(toggle.checked);
        });
        label.append(toggle);
        label.append(document.createElement("br"));
        return label;
    }

    protected rangeControl(name: string, min: number, max: number, val: number, change: (v: number) => void): HTMLElement {
        const label = document.createElement("label");
        const labelText = document.createElement("span");
        label.append(labelText);
        labelText.style.width = "15%";
        labelText.style.display = "inline-block";
        labelText.innerText = `${ name } (${ val })`;

        const range = document.createElement("input");
        range.setAttribute("type", "range");
        range.style.width = "80%";
        range.max = `${ max }`;
        range.min = `${ min }`;
        range.value = `${ val }`;
        range.addEventListener("change", e => {
            change(parseInt(range.value));
            labelText.innerText = `${ name } (${ range.value })`
        })
        range.addEventListener("input", e => {
            change(parseInt(range.value));
            labelText.innerText = `${ name } (${ range.value })`
        })
        label.append(range);
        label.append(document.createElement("br"));
        return label;
    }

}
