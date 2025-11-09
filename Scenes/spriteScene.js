import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import createHButton from '../js/htmlElements/createHButton.js';
import createHDiv from '../js/htmlElements/createHDiv.js';
import SpriteSheet from '../js/Spritesheet.js';


export class SpriteScene extends Scene {
    constructor(...args) {
        super('spriteScene', ...args);
        this.loaded = 0;
        this.isReady = false;
    }

    onReady() {
        // quick canvas clear 
        const worldLayers = ['bg', 'base', 'overlay'];
        for (const ln of worldLayers) {
            try {
                this.Draw.useCtx(ln);
                this.Draw.popMatrix(false,true)
                this.Draw.clear();
            } catch (e) { console.warn('Could not clear world layer', ln, e); }
        }
        const UILayers = ['UI', 'overlays'];
        for (const ln of UILayers) {
            try {
                this.UIDraw.useCtx(ln);
                this.UIDraw.popMatrix(false,true)
                this.UIDraw.clear();
            } catch (e) { console.warn('Could not clear UI layer', ln, e); }
        }
        this.Draw.useCtx('base')
        this.UIDraw.useCtx('UI')

        // Create or reuse the shared layer panel for persistent HTML buttons
        try {
            const panel = document.getElementById('layer-panel');
            if (panel) {
                // If the panel was created by the Tiles scene, update the scene buttons
                const tilesBtn = document.getElementById('tiles-scene-btn');
                const spritesBtn = document.getElementById('sprites-scene-btn');
                if (tilesBtn) {
                    tilesBtn.style.background = '#333';
                    tilesBtn.onclick = () => { try { this.switchScene && this.switchScene('title'); } catch(e){} };
                }
                if (spritesBtn) {
                    spritesBtn.style.background = '#555';
                    spritesBtn.onclick = () => { try { this.switchScene && this.switchScene('spriteScene'); } catch(e){} };
                }
            } else {
                // If the panel doesn't exist (edge case), create a small placeholder panel
                const panel2 = createHDiv('layer-panel', new Vector(8,8), new Vector(360,44), '#00000033', { borderRadius: '6px', border: '1px solid #FFFFFF22', padding: '6px', display: 'flex', alignItems: 'center', gap: '6px' }, 'UI');
                const sceneBtnSize = new Vector(80, 28);
                const tilesSceneBtn = createHButton('tiles-scene-btn', new Vector(6, 8), sceneBtnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel2);
                tilesSceneBtn.textContent = 'Tiles';
                const spritesSceneBtn = createHButton('sprites-scene-btn', new Vector(92, 8), sceneBtnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel2);
                spritesSceneBtn.textContent = 'Sprites';
                tilesSceneBtn.onclick = () => { try { this.switchScene && this.switchScene('title'); } catch(e){} };
                spritesSceneBtn.onclick = () => { try { this.switchScene && this.switchScene('spriteScene'); } catch(e){} };
                spritesSceneBtn.style.background = '#555';
            }
        } catch (e) { console.warn('SpriteScene.createUI failed', e); }

        // Minimal scene state
        this.infoText = 'Sprites editor — import images and build animations.';
        // create a default editable spritesheet to show a blank frame
        try {
            this.currentSprite = SpriteSheet.createNew(16, 'idle');
            // Quick test paint: draw a small emoji-like face into the first idle frame
            try {
                const frame = this.currentSprite.getFrame('idle', 0);
                if (frame) {
                    const fctx = frame.getContext('2d');
                    // clear transparent
                    fctx.clearRect(0, 0, frame.width, frame.height);
                    // orange face
                    fctx.fillStyle = '#FFAA33';
                    fctx.fillRect(1, 1, frame.width - 2, frame.height - 2);
                    // eyes
                    fctx.fillStyle = '#000000';
                    fctx.fillRect(4, 4, 2, 2);
                    fctx.fillRect(10, 4, 2, 2);
                    // mouth
                    fctx.fillRect(6, 10, 4, 1);
                }
                // rebuild the packed sheet so Draw.sheet picks up the change
                if (typeof this.currentSprite._rebuildSheetCanvas === 'function') this.currentSprite._rebuildSheetCanvas();
            } catch (e) { console.warn('failed to paint test frame', e); }
        } catch (e) { console.warn('failed to create default SpriteSheet', e); }
        
        
        this.zoom = new Vector(1,1)
        this.pan = new Vector(0,0)
        this.offset = new Vector(0,0)
        this.zoomPos = new Vector(0,0)
        this.panVlos = new Vector(0,0)
        this.zoomVlos = new Vector(0,0)
    // zoom limits and smoothing params
    this.minZoom = 0.25;
    this.maxZoom = 16;
    this.zoomSmooth = 8; // damping (larger = snappier)
    this.zoomImpulse = 12; // multiplier for wheel->velocity impulse
    this.zoomStep = -0.001; // exponential factor per wheel delta (use with Math.exp)
        
        
        this.isReady = true;
    }
    zoomScreen(tickDelta){
        try {
            if (!this.mouse) return;

            // Get ctrl+wheel delta (only when ctrl was pressed during wheel)
            const delta = this.mouse.wheel(null, false, true) || 0;
            if (!delta) return;

            // Mouse position in screen/canvas coordinates
            const mpos = this.mouse.pos || new Vector(0,0);
            const mx = mpos.x;
            const my = mpos.y;

            // Choose a zoom step. pow(zoomStep, delta) gives smooth steps for small integer deltas.
            // If your mouse reports large delta values, you can reduce sensitivity by using a
            // smaller base (e.g. 1.05) or divide `delta` by a factor.
            // use exponential factor for smooth scaling: factor = exp(zoomStep * delta)
            // zoomStep should be a small number (e.g. -0.001). Negative makes wheel direction
            // match typical UX where ctrl+wheel up zooms in.
            const zoomStep = this.zoomStep || -0.001;
            let desiredFactor = Math.exp(zoomStep * delta);
            // compute desired zooms and clamp to scene limits
            let desiredZoomX = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom.x * desiredFactor));
            let desiredZoomY = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom.y * desiredFactor));

            // Instead of applying immediately, add an impulse to zoom velocity so we smooth over time.
            // The impulse magnitude is proportional to the delta between desired and current zoom.
            const impulseX = (desiredZoomX - this.zoom.x) * (this.zoomImpulse || 8);
            const impulseY = (desiredZoomY - this.zoom.y) * (this.zoomImpulse || 8);
            this.zoomVlos.x += impulseX;
            this.zoomVlos.y += impulseY;

            // store last zoom pos for any UI/debug use
            if (this.zoomPos && typeof this.zoomPos.clone === 'function') {
                this.zoomPos.x = mx;
                this.zoomPos.y = my;
            }
        } catch (e) {
            console.warn('zoomScreen failed', e);
        }
    }

    // tick handler: called by Scene.tick() via sceneTick
    sceneTick(tickDelta){
        try {
            // handle ctrl+wheel zoom (adds velocity impulses)
            this.zoomScreen(tickDelta);

            // Integrate zoom velocity for smooth zooming
            try {
                const dt = tickDelta || 0;
                const mpos = (this.mouse && this.mouse.pos) ? this.mouse.pos : new Vector(0,0);

                // X axis
                if (Math.abs(this.zoomVlos.x) > 1e-6) {
                    const oldZoomX = this.zoom.x || 1;
                    let newZoomX = oldZoomX + this.zoomVlos.x * dt;
                    // clamp
                    newZoomX = Math.max(this.minZoom, Math.min(this.maxZoom, newZoomX));
                    if (newZoomX !== oldZoomX) {
                        // adjust offset so the screen point under the mouse stays fixed
                        this.offset.x = this.offset.x + mpos.x * (1 / newZoomX - 1 / oldZoomX);
                        this.zoom.x = newZoomX;
                    }
                    // if clamped hard, kill velocity in that axis
                    if (newZoomX === this.minZoom || newZoomX === this.maxZoom) this.zoomVlos.x = 0;
                }

                // Y axis
                if (Math.abs(this.zoomVlos.y) > 1e-6) {
                    const oldZoomY = this.zoom.y || 1;
                    let newZoomY = oldZoomY + this.zoomVlos.y * dt;
                    newZoomY = Math.max(this.minZoom, Math.min(this.maxZoom, newZoomY));
                    if (newZoomY !== oldZoomY) {
                        this.offset.y = this.offset.y + mpos.y * (1 / newZoomY - 1 / oldZoomY);
                        this.zoom.y = newZoomY;
                    }
                    if (newZoomY === this.minZoom || newZoomY === this.maxZoom) this.zoomVlos.y = 0;
                }

                // Damping
                const damp = Math.exp(-(this.zoomSmooth || 6) * dt);
                this.zoomVlos.x *= damp;
                this.zoomVlos.y *= damp;
                // tiny cutoff
                if (Math.abs(this.zoomVlos.x) < 1e-4) this.zoomVlos.x = 0;
                if (Math.abs(this.zoomVlos.y) < 1e-4) this.zoomVlos.y = 0;
            } catch (e) {
                console.warn('zoom integration failed', e);
            }

            // tools (pen) operate during ticks
            this.penTool && this.penTool();
        } catch (e) {
            console.warn('sceneTick failed', e);
        }
    }

    // Simple pen tool: paint a single pixel into the current frame while left mouse is held.
    // Returns early if left button isn't held.
    penTool() {
        try {
            if (!this.mouse || !this.currentSprite) return;
            if (!this.mouse.held('left')) return; // early return as requested

            // Use the shared helper to map mouse -> pixel coords
            const pos = this.getPos(this.mouse.pos);
            if (!pos || !pos.inside) return;
            const sheet = this.currentSprite;
            const color = this.penColor || '#000000';
            if (typeof sheet.setPixel === 'function') {
                sheet.setPixel('idle', 0, pos.x, pos.y, color, 'replace');
            } else if (typeof sheet.modifyFrame === 'function') {
                sheet.modifyFrame('idle', 0, { x: pos.x, y: pos.y, color: color, blendType: 'replace' });
            }
        } catch (e) {
            console.warn('penTool failed', e);
        }
    }

    // Compute the draw area used by displayDrawArea and tools.
    // Returns { topLeft, size, padding, dstW, dstH, dstPos }
    computeDrawArea() {
        const drawCtx = this.Draw && this.Draw.ctx;
        if (!drawCtx || !drawCtx.canvas) return null;
        const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
        const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
        const size = new Vector(384, 384);
        const topLeft = new Vector((uiW - size.x) / 2, (uiH - size.y) / 2);
        const padding = 16;
        const dstW = Math.max(1, size.x - padding * 2);
        const dstH = Math.max(1, size.y - padding * 2);
        const dstPos = new Vector(topLeft.x + (size.x - dstW) / 2, topLeft.y + (size.y - dstH) / 2);
        return { topLeft, size, padding, dstW, dstH, dstPos };
    }

    // Map a screen position (Vector) into frame pixel coordinates.
    // If screenPos omitted, uses this.mouse.pos. Returns {inside, x, y, relX, relY}
    getPos(screenPos = null) {
        try {
            if (!this.currentSprite) return null;
            const area = this.computeDrawArea();
            if (!area) return null;
            const sp = screenPos || (this.mouse && this.mouse.pos) || new Vector(0,0);
            const mx = sp.x || 0;
            const my = sp.y || 0;
            if (mx < area.dstPos.x || my < area.dstPos.y || mx > area.dstPos.x + area.dstW || my > area.dstPos.y + area.dstH) return { inside: false };
            const relX = (mx - area.dstPos.x) / area.dstW;
            const relY = (my - area.dstPos.y) / area.dstH;
            const px = Math.min(this.currentSprite.slicePx - 1, Math.max(0, Math.floor(relX * this.currentSprite.slicePx)));
            const py = Math.min(this.currentSprite.slicePx - 1, Math.max(0, Math.floor(relY * this.currentSprite.slicePx)));
            return { inside: true, x: px, y: py, relX, relY };
        } catch (e) {
            return null;
        }
    }

    // Map a frame pixel coordinate (object {x,y} or two args) to a screen Vector for the pixel center.
    getScreenPos(ix, iy = null) {
        try {
            if (ix === undefined || ix === null) return null;
            let x,y;
            if (typeof ix === 'object') { x = ix.x; y = ix.y; }
            else { x = ix; y = iy; }
            const area = this.computeDrawArea();
            if (!area) return null;
            const pxCenterX = area.dstPos.x + ((x + 0.5) / this.currentSprite.slicePx) * area.dstW;
            const pxCenterY = area.dstPos.y + ((y + 0.5) / this.currentSprite.slicePx) * area.dstH;
            return new Vector(pxCenterX, pxCenterY);
        } catch (e) {
            return null;
        }
    }

    draw() {
        if (!this.isReady) return;
        // Clear and draw a simple background + text
        this.Draw.background('#222')
        // Create a transform container.
        this.Draw.pushMatrix()
        // scale first
        this.Draw.scale(this.zoom)
        // then transform
        this.Draw.translate(this.offset)
        
        // display the editable frame centered on the screen
        try {
            const drawCtx = this.Draw.ctx;
            if (drawCtx && drawCtx.canvas) {
                const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
                const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
                const size = new Vector(384, 384);
                const topLeft = new Vector((uiW - size.x) / 2, (uiH - size.y) / 2);
                this.displayDrawArea(topLeft, size, this.currentSprite, 'idle', 0);
            }
        } catch (e) { console.warn('displayDrawArea error', e); }

        // Remove previous transform container to prevent transform stacking
        this.Draw.popMatrix()

        if (this.UIDraw) {
            this.UIDraw.useCtx('UI');
            this.UIDraw.text(this.infoText, new Vector(40, 80), '#FFFFFFFF', 0, 20, { align: 'left', baseline: 'top' });
        }
    }

    /**
     * Render the sprite editing area: a background box at `pos` with `size`,
     * and draw the specified frame from `sheet` (SpriteSheet instance).
     * `animation` is the animation name and `frame` the frame index.
     */
    displayDrawArea(pos, size, sheet, animation = 'idle', frame = 0) {
        try {
            if (!this.Draw || !pos || !size) return;
            this.Draw.useCtx('base');
            // draw a subtle checkerboard background for transparency
            const tile = 16;
            const cols = Math.ceil(size.x / tile);
            const rows = Math.ceil(size.y / tile);
            for (let y = 0; y < rows; y++) {
                for (let x = 0; x < cols; x++) {
                    const px = pos.x + x * tile;
                    const py = pos.y + y * tile;
                    const isLight = ((x + y) % 2) === 0;
                    this.Draw.rect(new Vector(px, py), new Vector(tile, tile), isLight ? '#3a3a3aff' : '#2e2e2eff', true);
                }
            }

            // draw border
            this.Draw.rect(pos, size, '#FFFFFF88', false, true, 2, '#FFFFFF88');

            // draw the frame image centered inside the box with some padding
            if (sheet) {
                const frameCanvas = (typeof sheet.getFrame === 'function') ? sheet.getFrame(animation, frame) : null;
                const padding = 16;
                const dstW = Math.max(1, size.x - padding * 2);
                const dstH = Math.max(1, size.y - padding * 2);
                const dstPos = new Vector(pos.x + (size.x - dstW) / 2, pos.y + (size.y - dstH) / 2);
                // Prefer Draw.sheet which understands SpriteSheet metadata (rows/frames).
                if (sheet && typeof this.Draw.sheet === 'function') {
                    try {
                        // Draw.sheet expects a sheet-like object with `.sheet` (Image/Canvas)
                        // and `.slicePx` and an animations map. Our SpriteSheet provides those.
                        this.Draw.sheet(sheet, dstPos, new Vector(dstW, dstH), animation, frame, null, 1, false);
                    } catch (e) {
                        // fallback to per-frame canvas if Draw.sheet fails
                        if (frameCanvas) this.Draw.image(frameCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                        else if (sheet && sheet.sheet) this.Draw.image(sheet.sheet, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                    }
                } else if (frameCanvas) {
                    // fallback: draw per-frame canvas
                    this.Draw.image(frameCanvas, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                } else if (sheet && sheet.sheet) {
                    // fallback: draw the packed sheet (will show full sheet)
                    this.Draw.image(sheet.sheet, dstPos, new Vector(dstW, dstH), null, 0, 1, false);
                }

                // Draw a pixel cursor preview if the mouse is over the draw area
                this.displayCursor(dstPos,dstW,dstH)
            }
        } catch (e) {
            console.warn('displayDrawArea failed', e);
        }
    }
    displayCursor(dstPos,dstW,dstH){
        try {
            const posInfo = this.getPos(this.mouse && this.mouse.pos);
            if (posInfo && posInfo.inside) {
                const cellW = dstW / this.currentSprite.slicePx;
                const cellH = dstH / this.currentSprite.slicePx;
                const cellX = dstPos.x + posInfo.x * cellW;
                const cellY = dstPos.y + posInfo.y * cellH;
                // translucent fill + stroked outline
                this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), '#FFFFFF22', true);
                this.Draw.rect(new Vector(cellX, cellY), new Vector(cellW, cellH), '#FFFFFFEE', false, true, 2, '#FFFFFFEE');
            }
        } catch (e) {
            // ignore cursor errors
        }
    }
}
