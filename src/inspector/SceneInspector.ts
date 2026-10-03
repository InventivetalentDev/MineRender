import { Renderer } from "../renderer/Renderer";
import { InstancedMesh, Intersection, Mesh, Object3D, Raycaster, Vector2 } from "three";
import { isSceneObject, SceneObject } from "../renderer/SceneObject";
import { Maybe, toDegrees, toRadians } from "../util/util";
import { isTransformable, Transformable } from "../Transformable";
import { prefix } from "../util/log";
import { isMesh } from "../util/three";
import { TextureAtlas } from "../texture";

const p = prefix("SceneInspector");

const help = "<span>Ctrl+Click to Select<br/></span><br/>";

export class SceneInspector {

    readonly objectInfoContainer: HTMLDivElement;
    readonly objectControlsContainer: HTMLDivElement;

    protected readonly raycaster: Raycaster;
    private readonly mouse: Vector2 = new Vector2();

    private selectedObject?: Object3D;

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

        document.addEventListener("click", this.onClick.bind(this), {
            passive: true
        })
    }

    findMeshChildren(from: Object3D, out: Mesh[] = []) {
        for (let c of from.children) {
            if (isMesh(c)) {
                out.push(c);
            }
            this.findMeshChildren(c, out);
        }
        return out;
    }

    onClick(event) {
        if ((<HTMLElement>event.target)?.nodeName !== "CANVAS") return;
        if (!event.ctrlKey) return;

        setTimeout(() => {
            this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
            let start = Date.now();
            let targets = this.findMeshChildren(this.renderer.scene);
            const intersects = this.raycaster.intersectObjects(targets, false);
            console.debug("Raycast took " + (Date.now() - start) + "ms for " + targets.length + " possible targets with " + intersects.length + " results");
            if (intersects.length > 0) {
                this.handleRaycasterObjects(intersects)
            }
        });
    }

    appendTo(el: HTMLElement) {
        el.append(this.objectInfoContainer);
        el.append(this.objectControlsContainer);
    }

    protected handleRaycasterObjects(intersections: Intersection[]) {
        console.debug(intersections);
        const firstIntersection = intersections[0];
        if (firstIntersection && firstIntersection.object) {
            const firstObject = firstIntersection.object;

            let targetIntersection: Maybe<Intersection> = undefined;
            let targetObject: Maybe<Object3D> = undefined;
            const firstSceneObjectIntersection = intersections.find(i => i.object && i.object.parent && isSceneObject(i.object.parent));
            if (firstSceneObjectIntersection && firstSceneObjectIntersection.object) {
                targetIntersection = firstSceneObjectIntersection;
                targetObject = firstSceneObjectIntersection.object;
            } else {
                // fallback to first intersect
                targetIntersection = firstIntersection;
                targetObject = firstObject;
            }

            if (!targetIntersection || !targetObject) return;

            this.selectObject(targetObject, targetIntersection);
        }
    }

    public selectObject(targetObject: Object3D, targetIntersection?: Intersection) {
        this.selectedObject = targetObject;
        console.log(p, "selected", targetObject);

        this.redraw(targetObject, targetIntersection);
    }

    protected redraw(targetObject: Object3D, targetIntersection?: Intersection) {
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

        if ('atlas' in targetObject) {
            const atlas =  targetObject['atlas'] as TextureAtlas;
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
        this.addControls(targetObject, targetIntersection);
    }

    protected addControls(object: Object3D, intersection?: Intersection) {
        const container = document.createElement("div");

        container.append(this.separator("Select Parent/Child"));

        if (object.parent) {
            container.append(this.buttonControl("Select Parent " + object.parent.constructor.name + " " + object.parent.name, "P", () => {
                this.selectObject(object.parent!, intersection);
            }));
        }
        if (object.children.length > 0) {
            let i = 1;
            for (let child of object.children) {
                container.append(this.buttonControl("Select Child " + child.constructor.name + " " + child.name, "C" + (i++), () => {
                    this.selectObject(child, intersection);
                }));
            }
        }
        container.append(this.separator());

        container.append(this.toggleControl("Visibility", "V", object.visible, v => object.visible = v));

        // let transformTarget = object.parent!;
        // container.append(this.selectControl("Transform Target","T",["parent","mesh"],v=>{
        //     switch (v) {
        //         case "parent":
        //             transformTarget = object.parent!;
        //             break;
        //         case "mesh":
        //             transformTarget = object;
        //             break;
        //     }
        // }))


        // if(object.parent) {
        //     container.append(this.separator("Parent"))
        //     this.addObjectControls(object.parent, intersection, container);
        //     container.append(this.separator());
        // }


        container.append(this.separator("Mesh"))
        this.addObjectControls(object, intersection, container);
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


    protected addObjectControls(target: Object3D, intersection: Maybe<Intersection>, container: HTMLElement) {

        const posRange = 16 * 16;
        const rotRange = 360;
        const scaleRange = 4;

        if (typeof intersection !== "undefined" && typeof intersection.instanceId !== "undefined" && isSceneObject(target) && (<SceneObject>target).isInstanced) {
            const scObj: SceneObject = target as SceneObject;

            container.append(this.separator("Position"))

            let pos = scObj.getPositionAt(intersection.instanceId);
            container.append(this.rangeControl("X Position", "X", -posRange + pos.x, posRange + pos.x, pos.x, 1, v => {
                pos = scObj.getPositionAt(intersection.instanceId!);
                pos.x = v;
                scObj.setPositionAt(intersection.instanceId!, pos);
            }));
            container.append(this.rangeControl("Y Position", "Y", -posRange + pos.y, posRange + pos.y, pos.y, 1, v => {
                pos = scObj.getPositionAt(intersection.instanceId!);
                pos.y = v;
                scObj.setPositionAt(intersection.instanceId!, pos);
            }));
            container.append(this.rangeControl("Z Position", "Z", -posRange + pos.z, posRange + pos.z, pos.z, 1, v => {
                pos = scObj.getPositionAt(intersection.instanceId!);
                pos.z = v;
                scObj.setPositionAt(intersection.instanceId!, pos);
            }));

            container.append(this.separator("Rotation"))

            let rot = scObj.getRotationAt(intersection.instanceId);
            container.append(this.rangeControl("X Rotation", "X", 0, rotRange, Math.round(toDegrees(rot.x)), 1, v => {
                rot = scObj.getRotationAt(intersection.instanceId!);
                rot.x = toRadians(v);
                scObj.setRotationAt(intersection.instanceId!, rot);
            }));
            container.append(this.rangeControl("Y Rotation", "Y", 0, rotRange, Math.round(toDegrees(rot.y)), 1, v => {
                rot = scObj.getRotationAt(intersection.instanceId!);
                rot.y = toRadians(v);
                scObj.setRotationAt(intersection.instanceId!, rot);
            }));
            container.append(this.rangeControl("Z Rotation", "Z", 0, rotRange, Math.round(toDegrees(rot.z)), 1, v => {
                rot = scObj.getRotationAt(intersection.instanceId!);
                rot.z = toRadians(v);
                scObj.setRotationAt(intersection.instanceId!, rot);
            }));

            container.append(this.separator("Scale"))

            let scl = scObj.getScale();
            container.append(this.rangeControl("X Scale", "X", 0, scaleRange, scl.x, 0.1, v => {
                scl = scObj.getScaleAt(intersection.instanceId!);
                scl.x = v;
                scObj.setScaleAt(intersection.instanceId!, scl);
            }));
            container.append(this.rangeControl("Y Scale", "Y", 0, scaleRange, scl.y, 0.1, v => {
                scl = scObj.getScaleAt(intersection.instanceId!);
                scl.y = v;
                scObj.setScaleAt(intersection.instanceId!, scl);
            }));
            container.append(this.rangeControl("Z Scale", "Z", 0, scaleRange, scl.z, 0.1, v => {
                scl = scObj.getScaleAt(intersection.instanceId!);
                scl.z = v;
                scObj.setScaleAt(intersection.instanceId!, scl);
            }));
        } else if (isTransformable(target)) {
            const parent: Transformable = target;

            container.append(this.separator("Position"))

            let pos = parent.getPosition();
            container.append(this.rangeControl("X Position", "X", -posRange, posRange, pos.x, 1, v => {
                pos = parent.getPosition();
                pos.x = v;
                parent.setPosition(pos)
            }));
            container.append(this.rangeControl("Y Position", "Y", -posRange, posRange, pos.y, 1, v => {
                pos = parent.getPosition();
                pos.y = v;
                parent.setPosition(pos)
            }));
            container.append(this.rangeControl("Z Position", "Z", -posRange, posRange, pos.z, 1, v => {
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
        labelText.innerText = `${ id } (${ val })`;

        const range = document.createElement("input");
        range.setAttribute("type", "range");
        range.style.width = "80%";
        range.max = `${ max }`;
        range.min = `${ min }`;
        range.step = `${ step }`;
        range.value = `${ val }`;
        const onChange = () => {
            change(parseFloat(range.value));
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
