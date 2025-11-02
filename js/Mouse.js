import Vector from './Vector.js';

export default class Mouse {
    constructor(rect, offset = new Vector(0, 0), scale = 1) {
        this.rect = rect;
        this.scale = scale;
        this.pos = new Vector();
        // Tap detection variables
        this._tapStart = 0;
        this._tapStartX = 0;
        this._tapStartY = 0;
        this._TAP_THRESHOLD = 200; // ms
        this._MOVE_THRESHOLD = 10; // px
        this.prevPos = new Vector();
        this.grabPos = null;
        this.scrollDelta = 0;
        this._lastScroll = 0;
        this.pauseTime = 0;
        this.prevDelta = 0;
        this.offset = offset;
        this.canvasScale = new Vector(1,1);

        // === Power system ===
        this.power = 0;  // current input context power
        this.mask = 0;   // max power allowed

        this.buttons = {
            left: this._makeButton(),
            middle: this._makeButton(),
            right: this._makeButton()
        };

        // Use Pointer Events (covers mouse, touch, pen)
        window.addEventListener("pointermove", e => this._onMove(e));
        window.addEventListener("pointerdown", e => this._setButton(e.button, 1));
        window.addEventListener("pointerup", e => this._setButton(e.button, 0));
        window.addEventListener("wheel", e => {
            this.scrollDelta += e.deltaY;
        }, { passive: true });
        window.addEventListener("touchstart", e => {
            const touch = e.changedTouches[0];
            this._tapStart = e.timeStamp;
            this._tapStartX = touch.clientX;
            this._tapStartY = touch.clientY;
        });
        window.addEventListener("touchend", e => {
            const touch = e.changedTouches[0];
            const tapDuration = e.timeStamp - this._tapStart;
            const moveX = Math.abs(touch.clientX - this._tapStartX);
            const moveY = Math.abs(touch.clientY - this._tapStartY);
            if (tapDuration < this._TAP_THRESHOLD && moveX < this._MOVE_THRESHOLD && moveY < this._MOVE_THRESHOLD) {
                // Recognized as a tap
                this._setButton(0, 1);
                setTimeout(() => this._setButton(0, 0), 10); // Release after short delay
            }
        });
    }

    _onMove(e) {
        this.prevPos = this.pos.clone();
        this.pos = new Vector(
            (e.clientX - this.rect.left + this.offset.x) * this.scale/this.canvasScale.x,
            (e.clientY - this.rect.top + this.offset.y) * this.scale/this.canvasScale.y
        );
    }

    updateRect(rect) {
        this.prevPos = new Vector(
            (this.prevPos.x * (rect.left / this.rect.left)),
            (this.prevPos.y * (rect.top / this.rect.top))
        );
        this.rect = rect;
        this.pos = new Vector(
            (this.pos.x * (rect.left / this.rect.left)),
            (this.pos.y * (rect.top / this.rect.top))
        );
    }

    // === Power Control ===
    setPower(level) { this.power = level; }
    setOffset(offset) { this.offset = offset; }
    setMask(level) { this.mask = level; }
    addMask(amount) { this.mask += amount; }
    addPower(amount) { this.power += amount; }
    _allowed() { return this.power >= this.mask; }
    pause(duration = 0.1) { this.pauseTime = duration; }
    setScale(scale) { this.scale = scale; }

    _makeButton() {
        return { state: 0, time: 0, prev: 0, justReleased: 0 };
    }

    _setButton(code, val) {
        // Chromebook/Touch: treat button -1 or undefined as left click
        if (code === 0 || code === -1 || code === undefined) this.buttons.left.state = val;
        if (code === 1) this.buttons.middle.state = val;
        if (code === 2) this.buttons.right.state = val;
    }

    update(delta) {
        if (this.pauseTime > 0) {
            this.pauseTime -= delta;
            if (this.pauseTime < 0) this.pauseTime = 0;
        }
        for (const b of Object.values(this.buttons)) {
            b.time = b.state ? b.time + delta : 0;
            b.justReleased = b.prev && !b.state;
            b.prev = b.state;
        }
        this.prevDelta = delta;
        this._lastScroll = this.scrollDelta;
        this.scrollDelta = 0;
        this.delta = this.prevPos.sub(this.pos);
    }

    pressed(button = null) {
        if (button === null || button === 'any') {
            return this.pressed("left") || this.pressed("middle") || this.pressed("right");
        }
        if (this.buttons[button].time > this.prevDelta + 0.001) return false;
        if (this.pauseTime > 0) return false;
        if (!this._allowed()) return false;
        return !!this.buttons[button].state;
    }

    held(button, returnTime = false) {
        if (this.pauseTime > 0) return returnTime ? 0 : false;
        if (!this._allowed()) return returnTime ? 0 : false;
        const b = this.buttons[button];
        return returnTime ? b.time : !!b.state;
    }

    released(button) {
        if (this.pauseTime > 0) return false;
        if (!this._allowed()) return false;
        return !!this.buttons[button].justReleased;
    }

    grab(pos) { this.grabPos = pos.clone(); }
    releaseGrab() { this.grabPos = null; }

    getGrabDelta() {
        if (!this.grabPos) return new Vector(0, 0);
        return this.pos.sub(this.grabPos);
    }

    scroll(mode = null, returnBool = false) {
        if (!this._allowed()) return returnBool ? false : 0;
        let delta = this._lastScroll;
        if (mode === "up" && delta >= 0) delta = 0;
        if (mode === "down" && delta <= 0) delta = 0;
        if (returnBool) return delta !== 0;
        return delta;
    }
}