import { MineRenderScene } from "../renderers/MineRenderScene";
import { Renderer } from "../renderers/Renderer";
import { Euler, Intersection, Object3D, Raycaster, Vector2, Vector3 } from "three";
import { isSceneObject, SceneObject } from "../renderers/SceneObject";
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
        if (!object.parent) return;

        const container = document.createElement("div");

        container.append(this.toggleControl("Visibility", "V", object.visible, v => object.visible = v));

        const posRange = 16 * 8;
        const rotRange = 360;

        if (intersection.instanceId && (<SceneObject>object.parent).isInstanced) {
            const parent: SceneObject = object.parent as SceneObject;

            let pos = parent.getPositionAt(intersection.instanceId);
            container.append(this.rangeControl("X Rotation", "X", -posRange, posRange, pos.x, v => {
                pos = parent.getPositionAt(intersection.instanceId!);
                pos.x = v;
                parent.setPositionAt(intersection.instanceId!, pos);
            }));
            container.append(this.rangeControl("Y Rotation", "Y", -posRange, posRange, pos.y, v => {
                pos = parent.getPositionAt(intersection.instanceId!);
                pos.y = v;
                parent.setPositionAt(intersection.instanceId!, pos);
            }));
            container.append(this.rangeControl("Z Position", "Z", -posRange, posRange, pos.z, v => {
                pos = parent.getPositionAt(intersection.instanceId!);
                pos.z = v;
                parent.setPositionAt(intersection.instanceId!, pos);
            }));

            let rot = parent.getRotationAt(intersection.instanceId);
            container.append(this.rangeControl("X Rotation", "X", 0, rotRange, Math.round(toDegrees(rot.x)), v => {
                rot = parent.getRotationAt(intersection.instanceId!);
                rot.x = toRadians(v);
                parent.setRotationAt(intersection.instanceId!, rot);
            }));
            container.append(this.rangeControl("Y Rotation", "Y", 0, rotRange, Math.round(toDegrees(rot.y)), v => {
                rot = parent.getRotationAt(intersection.instanceId!);
                rot.y = toRadians(v);
                parent.setRotationAt(intersection.instanceId!, rot);
            }));
            container.append(this.rangeControl("Z Rotation", "Z", 0, rotRange, Math.round(toDegrees(rot.z)), v => {
                rot = parent.getRotationAt(intersection.instanceId!);
                rot.z = toRadians(v);
                parent.setRotationAt(intersection.instanceId!, rot);
            }));
        } else if (isTransformable(object.parent)) {
            const parent: Transformable = object.parent;

            let pos = parent.getPosition();
            container.append(this.rangeControl("X Position", "X", -posRange, posRange, pos.x, v => {
                pos = parent.getPosition();
                pos.x = v;
                parent.setPosition(pos)
            }));
            container.append(this.rangeControl("Y Position", "Y", -posRange, posRange, pos.y, v => {
                pos = parent.getPosition();
                pos.y = v;
                parent.setPosition(pos)
            }));
            container.append(this.rangeControl("Z Position", "Z", -posRange, posRange, pos.z, v => {
                pos = parent.getPosition();
                pos.z = v;
                parent.setPosition(pos)
            }));

            let rot = parent.getRotation();
            container.append(this.rangeControl("X Rotation", "X", 0, rotRange, Math.round(toDegrees(rot.x)), v => {
                rot = parent.getRotation();
                rot.x = toRadians(v);
                parent.setRotation(rot);
            }));
            container.append(this.rangeControl("Y Rotation", "Y", 0, rotRange, Math.round(toDegrees(rot.y)), v => {
                rot = parent.getRotation();
                rot.y = toRadians(v);
                parent.setRotation(rot);
            }));
            container.append(this.rangeControl("Z Rotation", "Z", 0, rotRange, Math.round(toDegrees(rot.z)), v => {
                rot = parent.getRotation();
                rot.z = toRadians(v);
                parent.setRotation(rot);
            }));
        } else {
            container.append(this.rangeControl("X Position", "X", -posRange, posRange, object.parent.position.x, v => object.parent!.position.setX(v)));
            container.append(this.rangeControl("Y Position", "Y", -posRange, posRange, object.parent.position.y, v => object.parent!.position.setY(v)));
            container.append(this.rangeControl("Z Position", "Z", -posRange, posRange, object.parent.position.z, v => object.parent!.position.setZ(v)));

            container.append(this.rangeControl("X Rotation", "X", 0, rotRange, toDegrees(object.parent.rotation.x), v => object.parent!.rotation.x = toRadians(v)));
            container.append(this.rangeControl("Y Rotation", "Y", 0, rotRange, toDegrees(object.parent.rotation.y), v => object.parent!.rotation.y = toRadians(v)));
            container.append(this.rangeControl("Z Rotation", "Z", 0, rotRange, toDegrees(object.parent.rotation.z), v => object.parent!.rotation.z = toRadians(v)));
        }

        this.objectControlsContainer.append(container);
    }


    protected toggleControl(name: string, id: string, val: boolean, change: (v: boolean) => void): HTMLElement {
        const label = document.createElement("label");
        label.innerText = id;
        label.setAttribute("title", name);

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

    protected rangeControl(name: string, id: string, min: number, max: number, val: number, change: (v: number) => void): HTMLElement {
        const label = document.createElement("label");
        const labelText = document.createElement("span");
        label.append(labelText);
        label.setAttribute("title", name);
        labelText.style.width = "15%";
        labelText.style.display = "inline-block";
        labelText.innerText = `${ id } (${ val })`;

        const range = document.createElement("input");
        range.setAttribute("type", "range");
        range.style.width = "80%";
        range.max = `${ max }`;
        range.min = `${ min }`;
        range.value = `${ val }`;
        range.addEventListener("change", e => {
            change(parseInt(range.value));
            labelText.innerText = `${ id } (${ range.value })`
        })
        range.addEventListener("input", e => {
            change(parseInt(range.value));
            labelText.innerText = `${ id } (${ range.value })`
        })
        label.append(range);
        label.append(document.createElement("br"));
        return label;
    }

}
