import Vector from './Vector.js';

/**
 * Simple Camera class handling zoom, offset and input-driven movement.
 * Accepts a `Draw` instance and a `Mouse` instance and exposes helper
 * methods to apply world transforms and convert between screen/world.
 *
 * Keyframe system: push { zoom: Vector, offset: Vector, duration, ease }
 * and Camera will interpolate automatically. For now easing is linear.
 */
export default class Camera {
    /**
     * @param {object} Draw - drawing helper with pushMatrix/scale/translate/popMatrix
     * @param {Mouse} mouse - mouse input instance
     * @param {object} [opts]
     */
    constructor(Draw, mouse, opts = {}){
        this.Draw = Draw;
        this.mouse = mouse;

        this.zoom = new Vector(1,1);
        this.offset = new Vector(0,0);
        this.zoomPos = new Vector(0,0);

        // smoothing targets (we lerp current values towards these)
        this.targetZoom = new Vector(1,1);
        this.targetOffset = new Vector(0,0);

        // defaults, can be overridden by opts
        this.minZoom = opts.minZoom || 0.25;
        this.maxZoom = opts.maxZoom || 16;
        this.zoomSmooth = opts.zoomSmooth || 8;
        this.zoomImpulse = opts.zoomImpulse || 12;
        this.zoomStep = (typeof opts.zoomStep === 'number') ? opts.zoomStep : -0.001;

        this.panSmooth = opts.panSmooth || 8;
        this.panImpulse = opts.panImpulse || 1.0;

        // keyframe stack
        this.keyframes = [];
        this._kf = null; // active keyframe {start,end,duration,t}
    }

    /**
     * Push a camera keyframe. `target` may contain `zoom` and/or `offset` (Vectors).
     * @param {{zoom?:Vector,offset?:Vector}} target
     * @param {number} duration seconds
     */
    addKeyframe(target, duration = 0.5){
        this.keyframes.push({ target, duration });
    }

    _startNextKeyframe(){
        if (this._kf || this.keyframes.length === 0) return;
        const next = this.keyframes.shift();
        const start = { zoom: this.zoom.clone(), offset: this.offset.clone() };
        const end = {
            zoom: next.target.zoom ? next.target.zoom.clone() : this.zoom.clone(),
            offset: next.target.offset ? next.target.offset.clone() : this.offset.clone()
        };
        this._kf = { start, end, duration: Math.max(1e-6, next.duration || 0.001), t: 0 };
    }

    _updateKeyframe(dt){
        if (!this._kf) return;
        this._kf.t += dt;
        const p = Math.min(1, this._kf.t / this._kf.duration);
        // linear ease for now
        const t = p;
        // interp zoom (component-wise)
        this.zoom.x = this._kf.start.zoom.x + (this._kf.end.zoom.x - this._kf.start.zoom.x) * t;
        this.zoom.y = this._kf.start.zoom.y + (this._kf.end.zoom.y - this._kf.start.zoom.y) * t;
        // interp offset
        this.offset.x = this._kf.start.offset.x + (this._kf.end.offset.x - this._kf.start.offset.x) * t;
        this.offset.y = this._kf.start.offset.y + (this._kf.end.offset.y - this._kf.start.offset.y) * t;

        if (p >= 1) {
            this._kf = null;
            // ensure smoothing targets match final keyframe to avoid jump
            this.targetZoom = this.zoom.clone();
            this.targetOffset = this.offset.clone();
        }
    }

    /**
     * Handle input-driven impulses (wheel for pan/zoom).
     * If ctrl+wheel detected, produce zoom impulse; otherwise pan.
     */
    handleInput(){
        if (!this.mouse) return;

        // ctrl+wheel -> zoom (mouse.wheel(requireCtrl=true))
        const delta = this.mouse.wheel(null, false, true) || 0;
        if (delta) {
            const mpos = this.mouse.pos || new Vector(0,0);
            const zoomStep = this.zoomStep || -0.001;
            let desiredFactor = Math.exp(zoomStep * delta);
            // apply multiplicative change to the target zoom and clamp
            this.targetZoom.x = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom.x * desiredFactor));
            this.targetZoom.y = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom.y * desiredFactor));
            if (this.zoomPos && typeof this.zoomPos.clone === 'function'){
                this.zoomPos.x = mpos.x; this.zoomPos.y = mpos.y;
            }
            return; // prefer zoom when ctrl+wheel
        }

        // otherwise pan (wheel + wheelX)
        const wheelY = this.mouse.wheel() || 0;
        const wheelX = this.mouse.wheelX() || 0;
        const zX = this.targetZoom.x || 1;
        const zY = this.targetZoom.y || 1;
        const impulseX = -wheelX * (this.panImpulse) * (1 / zX);
        const impulseY = -wheelY * (this.panImpulse) * (1 / zY);
        // modify offset target directly
        this.targetOffset.x += impulseX;
        this.targetOffset.y += impulseY;
    }

    /**
     * Integrate velocities, keyframes and damping.
     * @param {number} dt
     */
    update(dt){
        if (!dt) dt = 0;
        // start keyframe if any
        this._startNextKeyframe();
        if (this._kf) {
            this._updateKeyframe(dt);
            // While keyframing, do not apply smoothing towards targets
            return;
        }

        // Exponential smoothing (equivalent to lerp with frame-independent factor)
        const zSmooth = Math.max(0, this.zoomSmooth || 0);
        const pSmooth = Math.max(0, this.panSmooth || 0);
        const zFactor = 1 - Math.exp(-zSmooth * dt);
        const pFactor = 1 - Math.exp(-pSmooth * dt);

        // For zoom, interpolate component-wise toward targetZoom
        const prevZoomX = this.zoom.x;
        const prevZoomY = this.zoom.y;
        this.zoom.x = this.zoom.x + (this.targetZoom.x - this.zoom.x) * zFactor;
        this.zoom.y = this.zoom.y + (this.targetZoom.y - this.zoom.y) * zFactor;

        // When zoom changes, apply an exact correction to the offset so the world
        // point under the mouse stays fixed: offset += mousePos * (1/newZoom - 1/oldZoom)
        const mpos = (this.mouse && this.mouse.pos) ? this.mouse.pos : new Vector(0,0);
        if (prevZoomX > 1e-9 && this.zoom.x !== prevZoomX) {
            this.offset.x += mpos.x * (1 / this.zoom.x - 1 / prevZoomX);
        }
        if (prevZoomY > 1e-9 && this.zoom.y !== prevZoomY) {
            this.offset.y += mpos.y * (1 / this.zoom.y - 1 / prevZoomY);
        }

        // Offset: lerp towards targetOffset (smoothing)
        this.offset.x = this.offset.x + (this.targetOffset.x - this.offset.x) * pFactor;
        this.offset.y = this.offset.y + (this.targetOffset.y - this.offset.y) * pFactor;
    }

    /**
     * Apply the camera transform to the Draw instance (push+scale+translate).
     */
    applyTransform(){
        if (!this.Draw) return;
        this.Draw.pushMatrix();
        this.Draw.scale(this.zoom);
        this.Draw.translate(this.offset);
    }

    /**
     * Pop the transform (mirror of applyTransform).
     */
    popTransform(){
        if (!this.Draw) return;
        this.Draw.popMatrix();
    }

    /**
     * Convert screen (canvas) coordinates to world coordinates.
     * @param {Vector|null} screen
     * @returns {Vector}
     */
    screenToWorld(screen){
        const s = screen || (this.mouse && this.mouse.pos) || new Vector(0,0);
        return new Vector(s.x / this.zoom.x - this.offset.x, s.y / this.zoom.y - this.offset.y);
    }

    /**
     * Convert world coords to screen coords.
     * @param {Vector|null} world
     * @returns {Vector}
     */
    worldToScreen(world){
        const w = world || new Vector(0,0);
        return new Vector((w.x + this.offset.x) * this.zoom.x, (w.y + this.offset.y) * this.zoom.y);
    }
}
