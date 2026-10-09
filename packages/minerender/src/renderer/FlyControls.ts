import { Camera, Controls, Euler, MathUtils, Quaternion, Vector3 } from "three";

/** Events dispatched by {@link FlyControls}. */
export interface FlyControlsEventMap {
    /** The camera moved or turned. */
    change: {};
    /** Mouse look captured the pointer. */
    lock: {};
    /** Mouse look released the pointer. */
    unlock: {};
}

/** Movement actions that {@link FlyControls.keys} binds to `KeyboardEvent.code` values. */
export type FlyAction = "forward" | "back" | "left" | "right" | "up" | "down" | "sprint";

/** Metres per second of vanilla creative flight; sprinting doubles it. */
const VANILLA_FLY_SPEED = 10.89;
const PITCH_LIMIT = Math.PI / 2;
const MOVE_EPSILON = 1e-6;

const _euler = new Euler(0, 0, 0, "YXZ");
const _forward = new Vector3();
const _right = new Vector3();
const _targetVelocity = new Vector3();

/**
 * Creative-flight camera controls: WASD moves horizontally along the view direction, space and shift
 * move up and down, control sprints, and the mouse turns the camera (pointer lock, or drag).
 *
 * Call {@link FlyControls.update} with the elapsed seconds once per frame; the `change` event marks the
 * renderer dirty while keys are held. Speeds use scene units (16 per block). The element becomes focusable
 * and keys apply while it has focus or the pointer is locked. The wheel changes the speed, as in vanilla
 * spectator mode. Touch input uses the left half of the element as a joystick and the right half for looking.
 */
export class FlyControls extends Controls<FlyControlsEventMap, Camera> {
    public readonly isFlyControls: true = true;

    /** Horizontal and vertical speed in scene units per second; vanilla creative flight by default. */
    public movementSpeed: number = 16 * VANILLA_FLY_SPEED;
    /** Speed multiplier while the sprint key is held. */
    public sprintMultiplier: number = 2;
    /** Radians per pixel of pointer movement. */
    public lookSpeed: number = 0.002;
    /** Smooth acceleration and deceleration, approximating vanilla flight momentum. */
    public enableDamping: boolean = true;
    /** Portion of the remaining velocity change applied per 60 Hz frame (0–1) when damping is enabled. */
    public dampingFactor: number = 0.25;
    /** Capture the pointer on click so the mouse turns the camera without dragging; dragging works regardless. */
    public pointerLock: boolean = true;
    /** Scroll the wheel to change `movementSpeed` within `speedRange`. */
    public enableWheelSpeed: boolean = true;
    /** Minimum and maximum `movementSpeed` reachable with the wheel. */
    public speedRange: [number, number] = [16, 16 * 500];
    /** Touch joystick travel in CSS pixels for full speed. */
    public joystickRadius: number = 64;
    /** Key bindings by `KeyboardEvent.code`. */
    public keys: Record<FlyAction, string[]> = {
        forward: ["KeyW", "ArrowUp"],
        back: ["KeyS", "ArrowDown"],
        left: ["KeyA", "ArrowLeft"],
        right: ["KeyD", "ArrowRight"],
        up: ["Space"],
        down: ["ShiftLeft", "ShiftRight"],
        sprint: ["ControlLeft", "ControlRight"]
    };

    private readonly _pressed = new Set<FlyAction>();
    private readonly _velocity = new Vector3();
    private readonly _lastPosition = new Vector3();
    private readonly _lastQuaternion = new Quaternion();
    private _position0 = new Vector3();
    private _quaternion0 = new Quaternion();
    private _dragPointer?: number;
    private _dragMoved = false;
    private _joystick?: { id: number; originX: number; originY: number; x: number; y: number };
    private _locked = false;
    private _lastTime?: number;

    private readonly _onKeyDown = (event: KeyboardEvent) => this.handleKey(event, true);
    private readonly _onKeyUp = (event: KeyboardEvent) => this.handleKey(event, false);
    private readonly _onPointerDown = (event: PointerEvent) => this.handlePointerDown(event);
    private readonly _onPointerMove = (event: PointerEvent) => this.handlePointerMove(event);
    private readonly _onPointerUp = (event: PointerEvent) => this.handlePointerUp(event);
    private readonly _onPointerLockChange = () => this.handlePointerLockChange();
    private readonly _onContextMenu = (event: Event) => event.preventDefault();
    private readonly _onWheel = (event: WheelEvent) => this.handleWheel(event);
    private readonly _onBlur = () => this.releaseKeys();

    constructor(camera: Camera, domElement?: HTMLElement | null) {
        super(camera, domElement ?? null);
        this._lastPosition.copy(camera.position);
        this._lastQuaternion.copy(camera.quaternion);
        this.saveState();
        if (domElement) this.connect(domElement);
    }

    public connect(element: HTMLElement): void {
        super.connect(element);
        const document = element.ownerDocument;
        document.addEventListener("keydown", this._onKeyDown);
        document.addEventListener("keyup", this._onKeyUp);
        document.addEventListener("pointerlockchange", this._onPointerLockChange);
        document.defaultView?.addEventListener("blur", this._onBlur);
        element.addEventListener("pointerdown", this._onPointerDown);
        element.addEventListener("pointermove", this._onPointerMove);
        element.addEventListener("pointerup", this._onPointerUp);
        element.addEventListener("pointercancel", this._onPointerUp);
        element.addEventListener("contextmenu", this._onContextMenu);
        element.addEventListener("wheel", this._onWheel, { passive: false });
        element.addEventListener("blur", this._onBlur);
        element.style.touchAction = "none";
        if (element.tabIndex < 0) element.tabIndex = 0;
    }

    public disconnect(): void {
        const element = this.domElement;
        if (!element) return;
        const document = element.ownerDocument;
        document.removeEventListener("keydown", this._onKeyDown);
        document.removeEventListener("keyup", this._onKeyUp);
        document.removeEventListener("pointerlockchange", this._onPointerLockChange);
        document.defaultView?.removeEventListener("blur", this._onBlur);
        element.removeEventListener("pointerdown", this._onPointerDown);
        element.removeEventListener("pointermove", this._onPointerMove);
        element.removeEventListener("pointerup", this._onPointerUp);
        element.removeEventListener("pointercancel", this._onPointerUp);
        element.removeEventListener("contextmenu", this._onContextMenu);
        element.removeEventListener("wheel", this._onWheel);
        element.removeEventListener("blur", this._onBlur);
        element.style.touchAction = "auto";
        this.unlock();
        this.releaseKeys();
        this._dragPointer = undefined;
        this._joystick = undefined;
    }

    public dispose(): void {
        this.disconnect();
    }

    /** Whether mouse look currently owns the pointer. */
    public get locked(): boolean {
        return this._locked;
    }

    /** Requests pointer capture; browsers only allow this from a user gesture. */
    public lock(): void {
        const element = this.domElement;
        if (!element || this._locked || typeof element.requestPointerLock !== "function") return;
        try {
            // Newer browsers return a promise that rejects when the lock is refused.
            const result = element.requestPointerLock() as unknown;
            if (result instanceof Promise) result.catch(() => undefined);
        } catch {
            // Pointer lock is unavailable; dragging still turns the camera.
        }
    }

    /** Releases a captured pointer. */
    public unlock(): void {
        const document = this.domElement?.ownerDocument;
        if (document?.pointerLockElement && document.pointerLockElement === this.domElement) {
            document.exitPointerLock();
        }
    }

    /** Stores the camera pose that {@link reset} restores. */
    public saveState(): void {
        this._position0.copy(this.object.position);
        this._quaternion0.copy(this.object.quaternion);
    }

    /** Restores the saved camera pose and stops movement. */
    public reset(): void {
        this.object.position.copy(this._position0);
        this.object.quaternion.copy(this._quaternion0);
        this._velocity.set(0, 0, 0);
        this.notifyChange();
    }

    /** Horizontal yaw in radians, where zero looks toward -Z. */
    public get yaw(): number {
        return _euler.setFromQuaternion(this.object.quaternion).y;
    }

    /** Vertical pitch in radians, positive looking up. */
    public get pitch(): number {
        return _euler.setFromQuaternion(this.object.quaternion).x;
    }

    /** Turns the camera; pitch is clamped to straight up and down. */
    public setRotation(yaw: number, pitch: number): void {
        _euler.set(MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT), yaw, 0);
        this.object.quaternion.setFromEuler(_euler);
        this.notifyChange();
    }

    /** Points the camera at a position without rolling it. */
    public lookAt(target: Vector3): void {
        _forward.copy(target).sub(this.object.position);
        if (_forward.lengthSq() < MOVE_EPSILON) return;
        _forward.normalize();
        this.setRotation(Math.atan2(-_forward.x, -_forward.z), Math.asin(MathUtils.clamp(_forward.y, -1, 1)));
    }

    /** Whether an action's key is held. */
    public isPressed(action: FlyAction): boolean {
        return this._pressed.has(action);
    }

    /**
     * Advances movement by `delta` seconds (measured since the previous call when omitted)
     * and dispatches `change` when the camera moved.
     */
    public update(delta?: number): void {
        if (delta === undefined) {
            const now = typeof performance !== "undefined" ? performance.now() : Date.now();
            delta = this._lastTime === undefined ? 0 : (now - this._lastTime) / 1000;
            this._lastTime = now;
        }
        if (!this.enabled) {
            this._velocity.set(0, 0, 0);
            return;
        }
        if (delta > 0) this.move(delta);
        this.notifyChange();
    }

    private move(delta: number): void {
        const camera = this.object;
        let forward = (this._pressed.has("forward") ? 1 : 0) - (this._pressed.has("back") ? 1 : 0);
        let strafe = (this._pressed.has("right") ? 1 : 0) - (this._pressed.has("left") ? 1 : 0);
        const climb = (this._pressed.has("up") ? 1 : 0) - (this._pressed.has("down") ? 1 : 0);
        const joystick = this._joystick;
        if (joystick) {
            const radius = Math.max(this.joystickRadius, 1);
            forward = MathUtils.clamp(forward + (joystick.originY - joystick.y) / radius, -1, 1);
            strafe = MathUtils.clamp(strafe + (joystick.x - joystick.originX) / radius, -1, 1);
        }

        _euler.setFromQuaternion(camera.quaternion);
        const yaw = _euler.y;
        _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
        _right.set(Math.cos(yaw), 0, -Math.sin(yaw));

        _targetVelocity.set(0, 0, 0);
        if (forward || strafe || climb) {
            _targetVelocity.addScaledVector(_forward, forward).addScaledVector(_right, strafe);
            if (_targetVelocity.lengthSq() > 1) _targetVelocity.normalize();
            _targetVelocity.y = climb;
            const speed = this.movementSpeed * (this._pressed.has("sprint") ? this.sprintMultiplier : 1);
            _targetVelocity.multiplyScalar(speed);
        }

        if (this.enableDamping) {
            // Frame-rate independent exponential approach: dampingFactor per 60 Hz frame.
            const blend = 1 - Math.pow(1 - MathUtils.clamp(this.dampingFactor, 0, 1), delta * 60);
            this._velocity.lerp(_targetVelocity, blend);
            if (_targetVelocity.lengthSq() === 0 && this._velocity.lengthSq() < MOVE_EPSILON) this._velocity.set(0, 0, 0);
        } else {
            this._velocity.copy(_targetVelocity);
        }
        camera.position.addScaledVector(this._velocity, delta);
    }

    private notifyChange(): void {
        const camera = this.object;
        if (this._lastPosition.distanceToSquared(camera.position) > MOVE_EPSILON
            || 8 * (1 - this._lastQuaternion.dot(camera.quaternion)) > MOVE_EPSILON) {
            this._lastPosition.copy(camera.position);
            this._lastQuaternion.copy(camera.quaternion);
            this.dispatchEvent({ type: "change" });
        }
    }

    private releaseKeys(): void {
        this._pressed.clear();
    }

    private handleKey(event: KeyboardEvent, down: boolean): void {
        if (!this.enabled) return;
        const action = this.actionFor(event.code);
        if (!action) return;
        if (down && !this._locked && event.target !== this.domElement) return;
        if (down) this._pressed.add(action);
        else this._pressed.delete(action);
        event.preventDefault();
    }

    private actionFor(code: string): FlyAction | undefined {
        for (const action in this.keys) {
            if (this.keys[action as FlyAction].includes(code)) return action as FlyAction;
        }
        return undefined;
    }

    private handlePointerDown(event: PointerEvent): void {
        const element = this.domElement;
        if (!this.enabled || !element) return;
        element.focus?.({ preventScroll: true });
        if (this._locked) return;
        if (event.pointerType === "touch" && !this._joystick && this.onJoystickSide(event)) {
            this._joystick = { id: event.pointerId, originX: event.clientX, originY: event.clientY, x: event.clientX, y: event.clientY };
            element.setPointerCapture?.(event.pointerId);
            return;
        }
        if (this._dragPointer !== undefined) return;
        if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 2) return;
        this._dragPointer = event.pointerId;
        this._dragMoved = false;
        element.setPointerCapture?.(event.pointerId);
    }

    private onJoystickSide(event: PointerEvent): boolean {
        const rect = this.domElement?.getBoundingClientRect?.();
        return !!rect && event.clientX < rect.left + rect.width / 2;
    }

    private handlePointerMove(event: PointerEvent): void {
        if (!this.enabled) return;
        const joystick = this._joystick;
        if (joystick && event.pointerId === joystick.id) {
            joystick.x = event.clientX;
            joystick.y = event.clientY;
            return;
        }
        if (!this._locked && event.pointerId !== this._dragPointer) return;
        const dx = event.movementX ?? 0;
        const dy = event.movementY ?? 0;
        if (!dx && !dy) return;
        this._dragMoved = true;
        this.turn(dx, dy);
    }

    private handlePointerUp(event: PointerEvent): void {
        if (this._joystick?.id === event.pointerId) {
            this._joystick = undefined;
            this.domElement?.releasePointerCapture?.(event.pointerId);
            return;
        }
        if (event.pointerId !== this._dragPointer) return;
        this._dragPointer = undefined;
        this.domElement?.releasePointerCapture?.(event.pointerId);
        if (this.enabled && this.pointerLock && !this._dragMoved && event.pointerType === "mouse" && event.button === 0) {
            this.lock();
        }
    }

    private handleWheel(event: WheelEvent): void {
        if (!this.enabled || !this.enableWheelSpeed) return;
        event.preventDefault();
        // Lines and pages scroll in larger units than pixels.
        const steps = event.deltaMode === 0 ? event.deltaY / 100 : event.deltaY;
        const [min, max] = this.speedRange;
        this.movementSpeed = MathUtils.clamp(this.movementSpeed * Math.pow(1.15, -steps), Math.min(min, max), Math.max(min, max));
    }

    private handlePointerLockChange(): void {
        const document = this.domElement?.ownerDocument;
        const locked = !!document && document.pointerLockElement === this.domElement;
        if (locked === this._locked) return;
        this._locked = locked;
        if (!locked) this.releaseKeys();
        this.dispatchEvent({ type: locked ? "lock" : "unlock" });
    }

    private turn(dx: number, dy: number): void {
        _euler.setFromQuaternion(this.object.quaternion);
        _euler.y -= dx * this.lookSpeed;
        _euler.x = MathUtils.clamp(_euler.x - dy * this.lookSpeed, -PITCH_LIMIT, PITCH_LIMIT);
        _euler.z = 0;
        this.object.quaternion.setFromEuler(_euler);
        this.notifyChange();
    }
}

export function isFlyControls(obj: any): obj is FlyControls {
    return (<FlyControls>obj)?.isFlyControls === true;
}
