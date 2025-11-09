import Color from './Color.js';

export default class SpriteSheet{
    constructor(sheet,slicePx,animations = null){
        // `sheet` may be an Image or a Canvas. Internally we maintain per-animation
        // frame canvases in `_frames` and keep `this.sheet` as a packed canvas
        // produced by `_rebuildSheetCanvas()` so Draw.sheet can still be used.
        this.sheet = sheet;
        this.slicePx = slicePx;
        this._frames = new Map(); // animationName -> [canvas, ...]
        if(animations){
            this.animations = animations;
        } else {
            this.animations = new Map();
        }
    }
    addAnimation(name,row,frameCount){
        // Only record the animation metadata (name/row/frameCount).
        // Do not create or modify any frame image data here; frame arrays
        // are managed separately by the importer/editor and by insert/pop.
        this.animations.set(name, { row: row, frameCount: frameCount });
    }
    removeAnimation(name){
        // Remove only the animation metadata. Keep any existing frame image
        // data in `this._frames` intact — editors may still reference them.
        this.animations.delete(name);
    }

    // Helper: rebuild the packed `this.sheet` canvas from `_frames` map and
    // update `this.animations` row/frameCount metadata.
    _rebuildSheetCanvas(){
        try {
            const animNames = Array.from(this._frames.keys());
            if (animNames.length === 0) {
                // no frames: create a minimal canvas
                const c = document.createElement('canvas');
                c.width = this.slicePx; c.height = this.slicePx;
                const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
                this.sheet = c;
                return;
            }

            // compute max frames in any animation (use ragged arrays allowed)
            let maxFrames = 0;
            for (const name of animNames) {
                const arr = this._frames.get(name) || [];
                if (arr.length > maxFrames) maxFrames = arr.length;
            }

            const rows = animNames.length;
            const outW = Math.max(1, maxFrames) * this.slicePx;
            const outH = Math.max(1, rows) * this.slicePx;
            const out = document.createElement('canvas');
            out.width = outW; out.height = outH;
            const outCtx = out.getContext('2d');
            outCtx.clearRect(0,0,outW,outH);

            // draw each frame canvas into the appropriate cell
            for (let r = 0; r < animNames.length; r++) {
                const name = animNames[r];
                const arr = this._frames.get(name) || [];
                for (let f = 0; f < arr.length; f++) {
                    const src = arr[f];
                    if (src) outCtx.drawImage(src, f * this.slicePx, r * this.slicePx, this.slicePx, this.slicePx);
                }
                // update animations metadata
                if (!this.animations.has(name)) this.animations.set(name, { row: r, frameCount: arr.length });
                else {
                    const meta = this.animations.get(name) || {};
                    meta.row = r; meta.frameCount = arr.length; this.animations.set(name, meta);
                }
            }

            this.sheet = out;
        } catch (e) {
            console.warn('_rebuildSheetCanvas failed', e);
        }
    }

    // Static factory: create an editable SpriteSheet with one blank frame and
    // a default animation name.
    static createNew(px, defaultAnimation = 'idle'){
        const c = document.createElement('canvas');
        c.width = px; c.height = px;
        const ctx = c.getContext('2d'); ctx.clearRect(0,0,c.width,c.height);
        const ss = new SpriteSheet(c, px, new Map());
        ss._frames = new Map();
        const arr = [document.createElement('canvas')];
        arr[0].width = px; arr[0].height = px;
        const aCtx = arr[0].getContext('2d'); aCtx.clearRect(0,0,px,px);
        ss._frames.set(defaultAnimation, arr);
        ss._rebuildSheetCanvas();
        return ss;
    }

    // Insert an empty frame into an animation at index (or push if undefined)
    insertFrame(animation, index = undefined) {
        if (!this._frames.has(animation)) {
            // create animation if missing
            this._frames.set(animation, []);
        }
        const arr = this._frames.get(animation);
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = this.slicePx; frameCanvas.height = this.slicePx;
        const ctx = frameCanvas.getContext('2d'); ctx.clearRect(0,0,frameCanvas.width, frameCanvas.height);
        if (typeof index === 'number' && index >= 0 && index <= arr.length) arr.splice(index, 0, frameCanvas);
        else arr.push(frameCanvas);
        this._rebuildSheetCanvas();
        return true;
    }

    // Remove a frame from an animation at index (or pop last if undefined)
    popFrame(animation, index = undefined) {
        if (!this._frames.has(animation)) return false;
        const arr = this._frames.get(animation);
        if (arr.length === 0) return false;
        let removed;
        if (typeof index === 'number' && index >= 0 && index < arr.length) removed = arr.splice(index,1);
        else removed = [arr.pop()];
        this._rebuildSheetCanvas();
        return removed[0] || null;
    }

    // Return the frame canvas (or null)
    getFrame(animation, index = 0) {
        const arr = this._frames.get(animation);
        if (!arr || arr.length === 0) return null;
        const idx = Math.max(0, Math.min(arr.length - 1, index));
        return arr[idx];
    }

    // Modify a frame by applying an array of changes: {x,y,color,blendType}
    // color: hex '#RRGGBB' or '#RRGGBBAA' or {r,g,b,a}
    // blendType: 'replace' (default) or 'alpha'
    modifyFrame(animation, index, changes) {
        try {
            const frame = this.getFrame(animation, index);
            if (!frame) return false;
            const ctx = frame.getContext('2d');
            const img = ctx.getImageData(0,0,frame.width, frame.height);
            const data = img.data;

            const applyChange = (chg) => {
                if (!chg) return;
                const x = Math.floor(chg.x || 0);
                const y = Math.floor(chg.y || 0);
                if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
                const idx = (y * frame.width + x) * 4;
                // Use centralized Color helper to convert inputs to RGB(A)
                let rgba;
                try {
                    const colObj = Color.convertColor(chg.color || '#000000');
                    const rgb = colObj.toRgb();
                    const ra = Math.round(rgb.a || 0);
                    const ga = Math.round(rgb.b || 0);
                    const ba = Math.round(rgb.c || 0);
                    const aa = Math.round((rgb.d === undefined ? 1 : rgb.d) * 255);
                    rgba = [ra, ga, ba, aa];
                } catch (e) {
                    rgba = [0,0,0,0];
                }
                const blend = chg.blendType || 'replace';
                if (blend === 'alpha') {
                    const srcA = rgba[3] / 255;
                    const dstA = data[idx+3] / 255;
                    // alpha composite: out = src + dst*(1-srcA)
                    const outA = srcA + dstA * (1 - srcA);
                    if (outA <= 0) {
                        data[idx] = data[idx+1] = data[idx+2] = data[idx+3] = 0;
                    } else {
                        data[idx] = Math.round((rgba[0] * srcA + data[idx] * dstA * (1 - srcA)) / outA);
                        data[idx+1] = Math.round((rgba[1] * srcA + data[idx+1] * dstA * (1 - srcA)) / outA);
                        data[idx+2] = Math.round((rgba[2] * srcA + data[idx+2] * dstA * (1 - srcA)) / outA);
                        data[idx+3] = Math.round(outA * 255);
                    }
                } else {
                    // replace
                    data[idx] = rgba[0]; data[idx+1] = rgba[1]; data[idx+2] = rgba[2]; data[idx+3] = rgba[3];
                }
            };

            if (Array.isArray(changes)) {
                for (const c of changes) applyChange(c);
            } else {
                applyChange(changes);
            }

            ctx.putImageData(img, 0, 0);
            this._rebuildSheetCanvas();
            return true;
        } catch (e) {
            console.warn('modifyFrame failed', e);
            return false;
        }
    }

    // Convenience: set a single pixel on a frame
    setPixel(animation, index, x, y, color, blendType = 'replace') {
        return this.modifyFrame(animation, index, { x: x, y: y, color: color, blendType: blendType });
    }

    // Convenience: fill a rectangle area on a frame with a color
    // x,y: top-left relative to frame. w,h inclusive of pixels.
    fillRect(animation, index, x, y, w, h, color, blendType = 'replace') {
        const changes = [];
        const ix = Math.floor(x || 0);
        const iy = Math.floor(y || 0);
        const iw = Math.max(0, Math.floor(w || 0));
        const ih = Math.max(0, Math.floor(h || 0));
        for (let yy = 0; yy < ih; yy++) {
            for (let xx = 0; xx < iw; xx++) {
                changes.push({ x: ix + xx, y: iy + yy, color: color, blendType: blendType });
            }
        }
        return this.modifyFrame(animation, index, changes);
    }

    // Convenience: apply an array of pixel changes quickly
    // pixels: [{x,y,color,blendType}, ...]
    drawPixels(animation, index, pixels) {
        if (!Array.isArray(pixels)) return false;
        return this.modifyFrame(animation, index, pixels);
    }
}