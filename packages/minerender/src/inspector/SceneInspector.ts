import { Renderer } from "../renderer/Renderer";
import { Intersection, Mesh, Object3D, Raycaster, Vector2 } from "three";
import { isSceneObject, SceneObject } from "../renderer/SceneObject";
import { Maybe, toDegrees, toRadians } from "../util/util";
import { isTransformable, Transformable } from "../Transformable";
import { prefix } from "../util/log";
import { isMesh } from "../util/three";
import { TextureAtlas } from "../texture";
import { InstanceReference } from "../instance/InstanceReference";

const p = prefix("SceneInspector");

const help = "<span>Ctrl/Cmd+Click to Select<br/></span><br/>";

/**
 * Browser controls for inspecting and editing scene objects with Ctrl/Cmd-click selection.
 * Construct it with a renderer, attach its panels with {@link appendTo}, and call {@link dispose} when finished.
 */
export class SceneInspector {

    readonly objectInfoContainer: HTMLDivElement;
    readonly objectControlsContainer: HTMLDivElement;

    protected readonly raycaster: Raycaster;
    private readonly mouse: Vector2 = new Vector2();

    private selectedObject?: Object3D;
    private pointer?: PointerEvent;
    private readonly listeners = new AbortController();

    constructor(readonly renderer: Renderer) {
        this.objectInfoContainer = document.createElement("div");
        this.objectControlsContainer = document.createElement("div");

        this.raycaster = new Raycaster();

        this.init();
    }

    protected init() {
        this.objectInfoContainer.classList.add("minerender-inspector", "minerender-object-info");
        this.objectControlsContainer.classList.add("minerender-inspector", "minerender-object-controls");

        this.objectInfoContainer.innerHTML = help;

        const canvas = this.renderer.renderer.domElement;
        const options = { signal: this.listeners.signal };
        canvas.addEventListener("pointerdown", event => {
            this.pointer = event.button === 0 && (event.ctrlKey || event.metaKey) ? event : undefined;
        }, options);
        canvas.addEventListener("pointermove", event => {
            if (this.pointer?.pointerId === event.pointerId
                && Math.hypot(event.clientX - this.pointer.clientX, event.clientY - this.pointer.clientY) > 5) {
                this.pointer = undefined;
            }
        }, options);
        canvas.addEventListener("pointerup", event => {
            const start = this.pointer;
            this.pointer = undefined;
            if (start?.pointerId === event.pointerId
                && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) <= 5) {
                this.onClick(event);
            }
        }, options);
        canvas.addEventListener("pointercancel", () => { this.pointer = undefined; }, options);
        canvas.addEventListener("pointerleave", () => { this.pointer = undefined; }, options);
        canvas.addEventListener("contextmenu", event => {
            // macOS Ctrl+click opens a context menu instead of firing click.
            if (this.pointer?.ctrlKey) event.preventDefault();
        }, options);
    }

    public dispose(): void {
        this.listeners.abort();
        this.pointer = undefined;
        this.selectedObject = undefined;
        this.objectInfoContainer.remove();
        this.objectControlsContainer.remove();
    }

    findMeshChildren(from: Object3D, out: Mesh[] = []) {
        if (!from.visible) return out;
        for (let c of from.children) {
            if (c.visible && isMesh(c)) {
                out.push(c);
            }
            this.findMeshChildren(c, out);
        }
        return out;
    }

    onClick(event: MouseEvent) {
        const canvas = this.renderer.renderer.domElement;
        if (event.target !== canvas || event.button !== 0 || !(event.ctrlKey || event.metaKey)) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left, y = event.clientY - rect.top;
        if (rect.width <= 0 || rect.height <= 0 || x < 0 || y < 0 || x >= rect.width || y >= rect.height) return;
        this.mouse.set(x / rect.width * 2 - 1, 1 - y / rect.height * 2);
        this.renderer.camera.updateWorldMatrix(true, false);
        this.renderer.scene.updateMatrixWorld(true);
        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
        this.handleRaycasterObjects(this.raycaster.intersectObjects(this.findMeshChildren(this.renderer.scene), false));
    }

    appendTo(el: HTMLElement) {
        el.append(this.objectInfoContainer);
        el.append(this.objectControlsContainer);
    }

    protected handleRaycasterObjects(intersections: Intersection[]) {
        const hit = intersections[0];
        if (!hit) return;
        const instance = this.getIntersectionInstance(hit);
        this.selectObject(instance?.instanceable ?? hit.object, hit, instance);
    }

    private getIntersectionInstance(hit?: Intersection): Maybe<InstanceReference<SceneObject>> {
        if (hit?.instanceId === undefined) return undefined;
        for (let parent = hit.object.parent; parent; parent = parent.parent) {
            if (isSceneObject(parent)) {
                const instance = parent.getInstanceReference(hit.object, hit.instanceId);
                if (instance) return instance;
            }
        }
        return undefined;
    }

    public selectObject(targetObject: Object3D, targetIntersection?: Intersection,
                        instance = this.getIntersectionInstance(targetIntersection)) {
        this.selectedObject = targetObject;
        console.log(p, "selected", targetObject);
        this.redraw(targetObject, targetIntersection, instance);
    }

    protected redraw(targetObject: Object3D, targetIntersection?: Intersection, instance?: InstanceReference<SceneObject>) {
        this.objectInfoContainer.innerHTML = help;
        if (targetIntersection) {
            this.addInfoLine("Distance", "D", targetIntersection.distance);
            this.addInfoLine("Instance #", "I", targetIntersection.instanceId);
        }
        this.addInfoLine("Type", "T", targetObject.constructor.name + "/" + targetObject.type);
        this.addInfoLine("Name", "N", targetObject.name);
        if (targetObject.parent) {
            this.addInfoLine("Parent", "P", targetObject.parent.constructor.name);
            if (isSceneObject(targetObject.parent)) {
                //...
            }
        }

        const atlas = 'atlas' in targetObject ? targetObject['atlas'] as Maybe<TextureAtlas> : undefined;
        if (atlas?.image.canvas) {
            // const img = document.createElement("img");
            const img = atlas.image.canvas as HTMLCanvasElement;
            // img.src = atlas.image.dataUrl;
            img.style.width = "100px";
            img.style.height = "100px";
            img.style.float = "right";
            img.style.imageRendering = "pixelated";
            this.objectInfoContainer.prepend(img);
        }

        this.objectControlsContainer.innerHTML = '';
        this.addControls(targetObject, targetIntersection, instance);
    }

    protected addControls(object: Object3D, intersection?: Intersection, instance?: InstanceReference<SceneObject>) {
        const container = document.createElement("div");

        container.append(this.separator("Select Parent/Child"));

        if (object.parent) {
            container.append(this.buttonControl("Select Parent " + object.parent.constructor.name + " " + object.parent.name, "P", () => {
                this.selectObject(object.parent!, intersection, instance);
            }));
        }
        if (object.children.length > 0) {
            let i = 1;
            for (let child of object.children) {
                container.append(this.buttonControl("Select Child " + child.constructor.name + " " + child.name, "C" + (i++), () => {
                    this.selectObject(child, intersection, instance);
                }));
            }
        }
        container.append(this.separator());

        const selectedInstance = instance && (object === instance.instanceable || object === intersection?.object) ? instance : undefined;
        if (!selectedInstance) {
            container.append(this.toggleControl("Visibility", "V", object.visible, v => object.visible = v));
        }

        container.append(this.separator("Mesh"))
        this.addObjectControls(object, intersection, container, selectedInstance);
        container.append(this.separator());


        this.objectControlsContainer.append(container);
    }


    protected addInfoLine(name: string, id: string, value: any): HTMLElement {
        const el = document.createElement("span");
        el.innerText = `${ id }: ${ value }`;
        el.setAttribute("title", name);

        this.objectInfoContainer.append(el);
        this.objectInfoContainer.append(document.createElement("br"));

        return el;
    }


    protected addObjectControls(target: Object3D, intersection: Maybe<Intersection>, container: HTMLElement, instance?: InstanceReference<SceneObject>) {

        const posRange = 16 * 16;
        const rotRange = 360;
        const scaleRange = 4;

        const transform = instance ?? (isTransformable(target) ? target : undefined);
        if (transform) {
            const parent: Transformable = transform;

            container.append(this.separator("Position"))

            let pos = parent.getPosition();
            container.append(this.rangeControl("X Position", "X", pos.x - posRange, pos.x + posRange, pos.x, 1, v => {
                pos = parent.getPosition();
                pos.x = v;
                parent.setPosition(pos)
            }));
            container.append(this.rangeControl("Y Position", "Y", pos.y - posRange, pos.y + posRange, pos.y, 1, v => {
                pos = parent.getPosition();
                pos.y = v;
                parent.setPosition(pos)
            }));
            container.append(this.rangeControl("Z Position", "Z", pos.z - posRange, pos.z + posRange, pos.z, 1, v => {
                pos = parent.getPosition();
                pos.z = v;
                parent.setPosition(pos)
            }));

            container.append(this.separator("Rotation"))

            let rot = parent.getRotation();
            container.append(this.rangeControl("X Rotation", "X", 0, rotRange, Math.round(toDegrees(rot.x)), 1, v => {
                rot = parent.getRotation();
                rot.x = toRadians(v);
                parent.setRotation(rot);
            }));
            container.append(this.rangeControl("Y Rotation", "Y", 0, rotRange, Math.round(toDegrees(rot.y)), 1, v => {
                rot = parent.getRotation();
                rot.y = toRadians(v);
                parent.setRotation(rot);
            }));
            container.append(this.rangeControl("Z Rotation", "Z", 0, rotRange, Math.round(toDegrees(rot.z)), 1, v => {
                rot = parent.getRotation();
                rot.z = toRadians(v);
                parent.setRotation(rot);
            }));

            container.append(this.separator("Scale"))

            let scl = parent.getScale();
            container.append(this.rangeControl("X Scale", "X", 0, scaleRange, scl.x, 0.1, v => {
                scl = parent.getScale();
                scl.x = v;
                parent.setScale(scl);
            }));
            container.append(this.rangeControl("Y Scale", "Y", 0, scaleRange, scl.y, 0.1, v => {
                scl = parent.getScale();
                scl.y = v;
                parent.setScale(scl);
            }));
            container.append(this.rangeControl("Z Scale", "Z", 0, scaleRange, scl.z, 0.1, v => {
                scl = parent.getScale();
                scl.z = v;
                parent.setScale(scl);
            }));
        } else {
            container.append(this.separator("Position"))

            container.append(this.rangeControl("X Position", "X", -posRange, posRange, target.position.x, 1, v => target!.position.setX(v)));
            container.append(this.rangeControl("Y Position", "Y", -posRange, posRange, target.position.y, 1, v => target!.position.setY(v)));
            container.append(this.rangeControl("Z Position", "Z", -posRange, posRange, target.position.z, 1, v => target!.position.setZ(v)));

            container.append(this.separator("Rotation"))

            container.append(this.rangeControl("X Rotation", "X", 0, rotRange, toDegrees(target.rotation.x), 1, v => target!.rotation.x = toRadians(v)));
            container.append(this.rangeControl("Y Rotation", "Y", 0, rotRange, toDegrees(target.rotation.y), 1, v => target!.rotation.y = toRadians(v)));
            container.append(this.rangeControl("Z Rotation", "Z", 0, rotRange, toDegrees(target.rotation.z), 1, v => target!.rotation.z = toRadians(v)));

            container.append(this.separator("Scale"))

            container.append(this.rangeControl("X Scale", "X", 0, scaleRange, target.scale.x, 0.1, v => target!.scale.x = v));
            container.append(this.rangeControl("Y Scale", "Y", 0, scaleRange, target.scale.y, 0.1, v => target!.scale.y = v));
            container.append(this.rangeControl("Z Scale", "Z", 0, scaleRange, target.scale.z, 0.1, v => target!.scale.z = v));
        }
    }

    protected buttonControl(name: string, id: string, click: () => void): HTMLElement {
        const button = document.createElement("button");
        button.innerText = id;
        button.setAttribute("title", name);
        button.addEventListener("click", click);
        return button;
    }

    protected selectControl(name: string, id: string, options: string[], change: (v: string) => void): HTMLElement {
        const label = document.createElement("label");
        label.innerText = id;
        label.setAttribute("title", name);

        const select = document.createElement("select");
        options.forEach(o => {
            const opt = document.createElement("option");
            opt.value = o;
            opt.innerText = o;
            select.append(opt);
        });
        select.addEventListener("change", e => {
            change(options[select.selectedIndex]);
        });
        select.selectedIndex = 0;
        label.append(select);
        label.append(document.createElement("br"));
        return label;
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
            this.renderer.scene.dirty = true;
        });
        label.append(toggle);
        label.append(document.createElement("br"));
        return label;
    }

    protected rangeControl(name: string, id: string, min: number, max: number, val: number, step: number, change: (v: number) => void): HTMLElement {
        const label = document.createElement("label");
        const labelText = document.createElement("span");
        label.append(labelText);
        label.setAttribute("title", name);
        labelText.style.width = "18%";
        labelText.style.display = "inline-block";

        const range = document.createElement("input");
        range.setAttribute("type", "range");
        range.style.width = "80%";
        range.max = `${ max }`;
        range.min = `${ min }`;
        range.step = `${ step }`;
        range.value = `${ val }`;
        labelText.innerText = `${ id } (${ range.value })`;
        const onChange = () => {
            change(parseFloat(range.value));
            this.renderer.scene.dirty = true;
            labelText.innerText = `${ id } (${ range.value })`
        };
        // range.addEventListener("change", onChange);
        range.addEventListener("input", onChange);
        range.addEventListener("wheel", e => {
            e.preventDefault();
            if (e.deltaY < 0) {
                range.value = `${ parseFloat(range.value) + step }`;
                onChange();
            } else if (e.deltaY > 0) {
                range.value = `${ parseFloat(range.value) - step }`;
                onChange();
            }
        })
        label.append(range);
        label.append(document.createElement("br"));
        return label;
    }

    protected separator(name?: string): HTMLElement {
        const span = document.createElement("span");
        if (name) {
            span.innerText = name;
        }
        span.prepend(document.createElement("br"));
        span.append(document.createElement("br"));
        return span;
    }

}
