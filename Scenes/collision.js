import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import createHButton from '../js/htmlElements/createHButton.js';
import createHDiv from '../js/htmlElements/createHDiv.js';
import createHLabel from '../js/htmlElements/createHLabel.js';
import SpriteSheet from '../js/Spritesheet.js';
import Cat from '../js/sprites/Cat.js';
import PackageManager from '../js/PackageManager.js';
import BufferedSegment from '../js/physics/BufferedSegment.js';
import BufferedPolygon from '../js/physics/BufferedPolygon.js';
import Menu from '../js/UI/Menu.js';
import UIButton from '../js/UI/Button.js';
import UIRect from '../js/UI/Rect.js';
import BoxSprite from '../js/sprites/Box.js';

export class CollisionScene extends Scene {
    constructor(...args) {
        super('collision', ...args);
        this.isReady = false;
        this.importedSheets = []; // [{id, slicePx, image, url}] (tilesheets import - legacy)
        this.importedChunks = []; // [{layer, x, y, image, url}] (image chunk import)
        this._importUrls = []; // object URLs to revoke on cleanup
        this.packageManager = new PackageManager(null, this);
    this.segment = null; // single test segment (legacy/demo)
    // removed test polygon; editor-created polygons live in this.editor.polyObjects
        this.editor = {
            polygons: [],        // Array<Vector[]> finalized polygons
            polyObjects: [],     // Array<BufferedPolygon>
            current: [],         // Array<Vector> current in-progress points
            baseRadius: 22,
            coeffs: { kv: 0.20, ka: 0.06, min: 3 },
        };
        // Level data for export (JSON)
        this.levelData = {
            spawn: null,   // { pos: {x,y}, size: {x,y} }
            goal: null,    // { pos: {x,y}, size: {x,y} }
            entities: [],  // placeholder for future
        };
        this._placeMode = null; // 'spawn' | 'goal' | null
        this.spawnSize = new Vector(48, 48);
        this.goalSize = new Vector(48, 48);
 
        // Entities (UI + data)
        this.entitiesUI = null;
        this.defaultEntitySize = new Vector(64, 64);
        this.entitiesRuntime = [];
        this.assets = { boxImage: null };
    }

    onReady() {
        // Ensure draw contexts are set
        try {
            const worldLayers = ['bg', 'base', 'overlay'];
            for (const ln of worldLayers) {
                try {
                    this.Draw.useCtx(ln);
                    this.Draw.popMatrix(false, true);
                    this.Draw.clear();
                } catch (e) { /* ignore per-layer errors */ }
            }
            const uiLayers = ['UI', 'overlays'];
            for (const ln of uiLayers) {
                try {
                    this.UIDraw.useCtx(ln);
                    this.UIDraw.popMatrix(false, true);
                    this.UIDraw.clear();
                } catch (e) { /* ignore per-layer errors */ }
            }
            this.Draw.useCtx('base');
            this.UIDraw.useCtx('UI');
        } catch (e) { /* ignore */ }

        // Update or create the shared scene switcher panel
        try {
            const panel = document.getElementById('layer-panel');
            if (panel) {
                const tilesBtn = document.getElementById('tiles-scene-btn');
                const spritesBtn = document.getElementById('sprites-scene-btn');
                const collisionBtn = document.getElementById('collision-scene-btn');
                if (tilesBtn) {
                    tilesBtn.style.background = '#333';
                    tilesBtn.onclick = () => { try { this.switchScene && this.switchScene('title'); } catch(e){} };
                }
                if (spritesBtn) {
                    spritesBtn.style.background = '#333';
                    spritesBtn.onclick = () => { try { this.switchScene && this.switchScene('spriteScene'); } catch(e){} };
                }
                if (collisionBtn) {
                    collisionBtn.style.background = '#555';
                    collisionBtn.onclick = () => { try { this.switchScene && this.switchScene('collision'); } catch(e){} };
                }

                // Import button is handled as a floating control (bottom-right), not in this panel.
            } else {
                // minimal fallback if panel wasn't created
                const panel2 = createHDiv('layer-panel', new Vector(8,8), new Vector(540,44), '#00000033', { borderRadius: '6px', border: '1px solid #FFFFFF22', padding: '6px', display: 'flex', alignItems: 'center', gap: '6px' }, 'UI');
                const sceneBtnSize = new Vector(80, 28);
                const tilesSceneBtn = createHButton('tiles-scene-btn', new Vector(6, 8), sceneBtnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel2);
                tilesSceneBtn.textContent = 'Tiles';
                const spritesSceneBtn = createHButton('sprites-scene-btn', new Vector(92, 8), sceneBtnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel2);
                spritesSceneBtn.textContent = 'Sprites';
                const collisionSceneBtn = createHButton('collision-scene-btn', new Vector(178, 8), sceneBtnSize, '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel2);
                collisionSceneBtn.textContent = 'Collision';
                tilesSceneBtn.onclick = () => { try { this.switchScene && this.switchScene('title'); } catch(e){} };
                spritesSceneBtn.onclick = () => { try { this.switchScene && this.switchScene('spriteScene'); } catch(e){} };
                collisionSceneBtn.onclick = () => { try { this.switchScene && this.switchScene('collision'); } catch(e){} };
                collisionSceneBtn.style.background = '#555';
                // Import button is handled as a floating control (bottom-right), not in this panel.
            }
        } catch (e) { /* ignore panel errors */ }

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
        // pan smoothing and impulse (wheel -> pan velocity)
        this.panSmooth = 8; // damping for panning velocity
        this.panImpulse = 1.0; // multiplier for wheel->pan velocity
        // spawn a test Cat sprite (load cat spritesheet lazily)
        try {
            const img = new Image();
            img.onload = () => {
                try {
                    const sheet = new SpriteSheet(img, 32);
                    const animList = ['sit','sit2','lick','lick2','walk','run','sleep','play','jump','stretch'];
                    const frameCounts = [4,4,4,4,8,8,4,6,7,8];
                    for (let i = 0; i < animList.length; i++) {
                        sheet.addAnimation(animList[i], i, frameCounts[i]);
                    }
                    sheet.addAnimation('land', 8, 7);
                    this.cat = new Cat(this.keys, this.Draw, new Vector(628,328), new Vector(256,256), sheet);
                    this.catRadius = 24; // collision radius for the cat, independent of draw size
                } catch (e) { console.warn('Failed to build cat sheet', e); }
            };
            img.src = 'Assets/Sprites/cat.png';
        } catch (e) { console.warn('Failed to init Cat sprite', e); }
        // Create or recreate a floating Import button at bottom-right (1920x1080 logical)
        try {
            const existing = document.getElementById('import-images-btn');
            if (existing && existing.parentNode) { try { existing.remove(); } catch(e){} }
            const btnSize = new Vector(140, 36);
            const pos = new Vector(1920 - btnSize.x - 12, 1080 - btnSize.y - 12);

            // Optionally keep a single segment for quick comparison; disabled by default
            // this.segment = new BufferedSegment(new Vector(420, 420), new Vector(1280, 720), 18, { kv: 0.20, ka: 0.06 });
            this._prevCatVel = new Vector(0,0);
            const importBtn = createHButton('import-images-btn', pos, btnSize, '#444', { color: '#fff', borderRadius: '6px', fontSize: 14, border: '1px solid #777' }, 'UI');
            importBtn.textContent = 'Import Images';
            importBtn.onclick = async () => { try { await this.promptImportImagesTar(); } catch(e){ console.warn('import failed', e); } };

            // Export JSON button above Import
            const exportPos = new Vector(pos.x, pos.y - (btnSize.y + 8));
            const exportBtn = createHButton('export-json-btn', exportPos, btnSize, '#446', { color: '#fff', borderRadius: '6px', fontSize: 14, border: '1px solid #778' }, 'UI');
            exportBtn.textContent = 'Export JSON';
            exportBtn.onclick = () => { try { this.exportLevelJSON(); } catch(e){ console.warn('export failed', e); } };
        } catch (e) { /* ignore button errors */ }

        // Collision editor UI panel (minimal)
        try {
            const panelId = 'collision-editor-panel';
            const old = document.getElementById(panelId);
            if (old) old.remove();
            const panel = createHDiv(panelId, new Vector(8, 60), new Vector(560, 120), '#00000055', { borderRadius: '6px', border: '1px solid #FFFFFF22', padding: '8px' }, 'UI');
            createHLabel(null, new Vector(12, 8), new Vector(396, 20), 'Collision Editor: click to add points; Space = new polygon; Backspace = undo', { color: '#fff', fontSize: 13, justifyContent: 'left' }, panel);
            const newBtn = createHButton('editor-new-poly', new Vector(12, 38), new Vector(130, 28), '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel);
            newBtn.textContent = 'New (Space)';
            newBtn.onclick = () => this._finalizeCurrentPolygon();
            const undoBtn = createHButton('editor-undo', new Vector(152, 38), new Vector(100, 28), '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel);
            undoBtn.textContent = 'Undo (Bksp)';
            undoBtn.onclick = () => this._undoPoint();
            const clearBtn = createHButton('editor-clear', new Vector(262, 38), new Vector(130, 28), '#333', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #777' }, panel);
            clearBtn.textContent = 'Clear All';
            clearBtn.onclick = () => this._clearAllPolygons();

            // Spawn/Goal placement controls
            const spawnBtn = createHButton('editor-set-spawn', new Vector(402, 38), new Vector(70, 28), '#665500', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #AA8' }, panel);
            spawnBtn.textContent = 'Spawn';
            spawnBtn.onclick = () => { this._placeMode = 'spawn'; };
            const goalBtn = createHButton('editor-set-goal', new Vector(482, 38), new Vector(66, 28), '#225522', { color: '#fff', borderRadius: '4px', fontSize: 13, border: '1px solid #7A7' }, panel);
            goalBtn.textContent = 'Goal';
            goalBtn.onclick = () => { this._placeMode = 'goal'; };
        } catch (e) { /* ignore editor UI errors */ }

        // Entities UI (JS UI components with signals)
        try {
            // Create a menu at the top-right of the screen
            const menuSize = new Vector(260, 70);
            const layer = 60;
            const menuPos = new Vector(1920 - menuSize.x - 8, 8);
            const menu = new Menu(this.mouse, this.keys, menuPos, menuSize, layer, '#222A');
            const labelBg = new UIRect(new Vector(8, 8), new Vector(244, 20), layer + 1, '#00000055');
            const addBoxBtn = new UIButton(this.mouse, this.keys, new Vector(8, 34), new Vector(120, 28), layer + 2, null, '#444', '#555', '#222');
            // quick title by drawing an overlay rect; we'll draw the text with UIDraw later
            addBoxBtn.onPressed['left'].connect(() => { this._placeMode = 'entity-box'; });
            menu.addElement('labelBg', labelBg);
            menu.addElement('addBox', addBoxBtn);
            this.entitiesUI = { menu, addBoxBtn };
        } catch (e) { /* ignore entities UI errors */ }

        // Preload box image asset
        try {
            const img = new Image();
            img.onload = () => { this.assets.boxImage = img; };
            img.src = 'Assets/Sprites/box.png';
        } catch (e) { /* ignore asset load errors */ }

        this.isReady = true;
    }

    onSwitchFrom() {
        // Cleanup object URLs to avoid leaks
        try {
            if (Array.isArray(this._importUrls)) {
                for (const url of this._importUrls) { try { URL.revokeObjectURL(url); } catch(e){} }
            }
        } catch (e) { /* ignore */ }
        this._importUrls = [];
        try { const btn = document.getElementById('import-images-btn'); if (btn) btn.remove(); } catch (e) {}
        try { const btn2 = document.getElementById('export-json-btn'); if (btn2) btn2.remove(); } catch (e) {}
        try { const panel = document.getElementById('collision-editor-panel'); if (panel) panel.remove(); } catch (e) {}
        // call parent if defined
        if (super.onSwitchFrom) try { super.onSwitchFrom(); } catch(e){}
    }

    // Coordinate helpers
    getWorldPos(screen){
        const s = screen || this.mouse.pos || new Vector(0,0);
        return new Vector(s.x / this.zoom.x - this.offset.x, s.y / this.zoom.y - this.offset.y);
    }
    getScreenPos(world){
        const w = world || new Vector(0,0);
        return new Vector((w.x + this.offset.x) * this.zoom.x, (w.y + this.offset.y) * this.zoom.y);
    }

    // Editor helpers
    _finalizeCurrentPolygon(){
        const pts = this.editor.current;
        if (!pts || pts.length === 0) return;
        if (pts.length === 1) {
            // create a short segment from single point
            const p0 = pts[0];
            pts.push(p0.add(new Vector(32, 0)));
        }
        const polyPts = pts.map(v => v.clone());
        this.editor.polygons.push(polyPts);
        try {
            const obj = new BufferedPolygon(polyPts, this.editor.baseRadius, this.editor.coeffs);
            this.editor.polyObjects.push(obj);
        } catch (e) {}
        this.editor.current = [];
    }
    _undoPoint(){
        if (this.editor.current.length > 0) {
            this.editor.current.pop();
            return;
        }
        if (this.editor.polygons.length > 0) {
            this.editor.polygons.pop();
            this.editor.polyObjects.pop();
        }
    }
    _clearAllPolygons(){
        this.editor.current = [];
        this.editor.polygons = [];
        this.editor.polyObjects = [];
    }

    // Prompt user to pick an image-chunks tar (bg/base/overlay folders with x_y.png) or a tilesheets tar. Prefer chunks.
    async promptImportImagesTar(){
        return new Promise((resolve) => {
            try {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.tar,application/x-tar,application/tar';
                input.style.display = 'none';
                input.onchange = async (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (!file) { resolve(false); return; }
                    try {
                        const arrayBuf = await file.arrayBuffer();
                        // First try image-chunk tar format (bg/base/overlay/<x>_<y>.png)
                        const chunksParsed = await this.packageManager.parseImageChunksTar(arrayBuf);
                        if (chunksParsed && chunksParsed.chunks && chunksParsed.chunks.length) {
                            this.importedChunks = [];
                            for (const c of chunksParsed.chunks) {
                                if (!c.url) continue;
                                this._importUrls.push(c.url);
                                const img = new Image();
                                const p = new Promise((res)=>{ img.onload = () => res(true); img.onerror = () => res(false); });
                                img.src = c.url;
                                await p;
                                this.importedChunks.push({ layer: c.layer, x: c.x, y: c.y, image: img, url: c.url });
                            }
                            console.log('Imported chunks:', this.importedChunks.length);
                            resolve(this.importedChunks.length > 0);
                        } else {
                            // Fallback to tilesheets tar format
                            const parsed = await this.packageManager.parseTarBuffer(arrayBuf);
                            if (parsed && parsed.sheetsPayload && Array.isArray(parsed.sheetsPayload.sheets)) {
                                this.importedSheets = [];
                                for (const s of parsed.sheetsPayload.sheets) {
                                    if (!s.imageData) continue;
                                    this._importUrls.push(s.imageData);
                                    const img = new Image();
                                    const p = new Promise((res)=>{ img.onload = () => res(true); img.onerror = () => res(false); });
                                    img.src = s.imageData; await p;
                                    this.importedSheets.push({ id: s.id || 'sheet', slicePx: s.slicePx || 16, image: img, url: s.imageData });
                                }
                                console.log('Imported tilesheets:', this.importedSheets.map(x=>x.id));
                                resolve(this.importedSheets.length > 0);
                            } else {
                                resolve(false);
                            }
                        }
                    } catch (err) {
                        console.warn('Import tar failed', err); resolve(false);
                    }
                    try { input.remove(); } catch (ee){}
                };
                document.body.appendChild(input);
                input.click();
                setTimeout(() => { try { input.remove(); } catch (e){} }, 3000);
            } catch (e) { console.warn('promptImportImagesTar failed', e); resolve(false); }
        });
    }

    // Handle ctrl+wheel zooming with smooth velocity integration
    panScreen(tickDelta){
        if (this.keys.held('Control')) return; // prefer zoom when ctrl is pressed
        // Read wheel deltas (robustly handle multiple mouse APIs)
        let wheelY = 0, wheelX = 0;
        wheelY = this.mouse.wheel();
        wheelX = this.mouse.wheelX();
        
    
        // Convert wheel deltas to pan velocity impulses. We divide by zoom so
        // panning speed feels consistent at different zoom levels.
        const zX = this.zoom.x;
        const zY = this.zoom.y;
        // invert direction so wheel down moves content up (typical UX)
        const impulseX = -wheelX * (this.panImpulse) * (1 / zX);
        const impulseY = -wheelY * (this.panImpulse) * (1 / zY);
        this.panVlos.x += impulseX;
        this.panVlos.y += impulseY;
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

    // Called by base Scene.tick() at fixed rate
    sceneTick(tickDelta) {
        // If mouse is over the general UI area, pause mouse input briefly to prevent bleed-through
        const inTopLeft = (this.mouse.pos.x < 700 && this.mouse.pos.y < 200);
        const inTopRight = (this.mouse.pos.x > (1920 - 300) && this.mouse.pos.y < 200);
        if (inTopLeft || inTopRight) this.mouse.pause(0.1);        

        // handle ctrl+wheel zoom (adds velocity impulses)
        this.zoomScreen(tickDelta);
        // handle wheel-based panning (horizontal/vertical wheel)
        this.panScreen(tickDelta);

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

            // Integrate pan velocity into offset and apply damping
            try {
                if (Math.abs(this.panVlos.x) > 1e-6) {
                    this.offset.x += this.panVlos.x * dt;
                }
                if (Math.abs(this.panVlos.y) > 1e-6) {
                    this.offset.y += this.panVlos.y * dt;
                }
                const pdamp = Math.exp(-(this.panSmooth || 6) * dt);
                this.panVlos.x *= pdamp;
                this.panVlos.y *= pdamp;
                if (Math.abs(this.panVlos.x) < 1e-4) this.panVlos.x = 0;
                if (Math.abs(this.panVlos.y) < 1e-4) this.panVlos.y = 0;
            } catch (e) {
                console.warn('pan integration failed', e);
            }
            // update cat
            try {
                if (this.cat && typeof this.cat.update === 'function') {
                    // compute acceleration from velocity delta
                    const lastV = this.cat.vlos ? this.cat.vlos.clone() : new Vector(0,0);
                    this.cat.update(tickDelta);
                    const curV = this.cat.vlos ? this.cat.vlos.clone() : new Vector(0,0);
                    const accelMag = tickDelta > 0 ? curV.sub(this._prevCatVel || lastV).divS(tickDelta).mag() : 0;
                    const velMag = curV.mag();
                    if (this.segment) this.segment.updateBuffer(velMag, accelMag);
                    if (this.editor && this.editor.polyObjects) {
                        for (const obj of this.editor.polyObjects) obj.updateBuffer(velMag, accelMag);
                    }
                    this._prevCatVel = curV;
                }
            } catch (e) {}
            // Editor input: add points and finalize polygons
            try {
                if (this.mouse && this.mouse.pressed('left')) {
                    const wp = this.getWorldPos(this.mouse.pos);
                    if (this._placeMode === 'spawn') {
                        const topLeft = wp.sub(this.spawnSize.mult(0.5));
                        this.levelData.spawn = { pos: { x: topLeft.x, y: topLeft.y }, size: { x: this.spawnSize.x, y: this.spawnSize.y } };
                        this._placeMode = null;
                    } else if (this._placeMode === 'goal') {
                        const topLeft = wp.sub(this.goalSize.mult(0.5));
                        this.levelData.goal = { pos: { x: topLeft.x, y: topLeft.y }, size: { x: this.goalSize.x, y: this.goalSize.y } };
                        this._placeMode = null;
                    } else if (this._placeMode === 'entity-box') {
                        const sz = this.defaultEntitySize;
                        const topLeft = wp.sub(sz.mult(0.5));
                        const entData = { type: 'box', pos: { x: topLeft.x, y: topLeft.y }, size: { x: sz.x, y: sz.y } };
                        this.levelData.entities.push(entData);
                        try {
                            const sprite = new BoxSprite(this.Draw, new Vector(entData.pos.x, entData.pos.y), new Vector(entData.size.x, entData.size.y), this.assets.boxImage);
                            this.entitiesRuntime.push({ type:'box', sprite });
                        } catch (e) {}
                        this._placeMode = null;
                    } else {
                        this.editor.current.push(wp);
                    }
                }
                if (this.keys && this.keys.pressed(' ')) {
                    this._finalizeCurrentPolygon();
                }
                if (this.keys && this.keys.pressed('Backspace')) {
                    this._undoPoint();
                }
            } catch (e) { /* ignore editor input errors */ }
            // Resolve collision between cat (circle) and buffered shapes (edge-only)
            try {
                if (this.cat && this.segment) {
                    const center = this.cat.pos.add(this.cat.size.mult(0.5));
                    const radius = this.catRadius || Math.min(this.cat.size.x, this.cat.size.y) * 0.2;
                    const hit = this.segment.collideCircle(center, radius);
                    if (hit && hit.collides) {
                        // push cat out along normal by penetration
                        const push = hit.normal.mult(hit.penetration);
                        // move top-left by same push as center
                        this.cat.pos.addS(push);
                        // remove inward normal component of velocity (simple resolve, no bounce)
                        const vn = this.cat.vlos.dot(hit.normal);
                        if (vn < 0) this.cat.vlos.subS(hit.normal.mult(vn));
                    }
                }
                // removed test polygon collision; editor polygons below handle collisions
                if (this.cat && this.editor && this.editor.polyObjects && this.editor.polyObjects.length) {
                    for (let iter = 0; iter < 2; iter++) {
                        const center = this.cat.pos.add(this.cat.size.mult(0.5));
                        const radius = this.catRadius || Math.min(this.cat.size.x, this.cat.size.y) * 0.2;
                        let resolved = false;
                        // collide against all editor polygons; apply deepest first
                        let best = null; let bestPen = 0; let bestObj = null;
                        for (const obj of this.editor.polyObjects) {
                            const hit = obj.collideCircle(center, radius);
                            if (hit && hit.collides && hit.penetration > bestPen) { best = hit; bestPen = hit.penetration; bestObj = obj; }
                        }
                        if (best && best.collides) {
                            const push = best.normal.mult(best.penetration);
                            this.cat.pos.addS(push);
                            const vn = this.cat.vlos.dot(best.normal);
                            if (vn < 0) this.cat.vlos.subS(best.normal.mult(vn));
                            resolved = true;
                        }
                        if (!resolved) break;
                    }
                }
            } catch (e) { /* ignore collision errors */ }
        } catch (e) {
            console.warn('zoom integration failed', e);
        }
        // Update Entities UI
        try { if (this.entitiesUI && this.entitiesUI.menu) this.entitiesUI.menu.update(tickDelta); } catch (e) {}
    }

    draw() {
        if (!this.isReady) return;
        // Background
        this.Draw.background('#202020');
        this.Draw.useCtx('base');

        // World transform container (so zoom/pan affects content)
        this.Draw.pushMatrix();
        this.Draw.scale(this.zoom);
        this.Draw.translate(this.offset);

        // If imported chunk images exist, draw them at their world positions by layer order.
        if (this.importedChunks && this.importedChunks.length) {
            const layerOrder = ['bg','base','overlay'];
            for (const layer of layerOrder) {
                const items = this.importedChunks.filter(c => c.layer === layer).sort((a,b)=> (a.y-b.y) || (a.x-b.x));
                for (const c of items) {
                    try {
                        // infer tilePixelSize from image width assuming 16x16 tiles per chunk
                        const chunkSize = 16;
                        const tilePx = c.image.width / chunkSize;
                        const pxX = c.x * tilePx;
                        const pxY = c.y * tilePx;
                        this.Draw.image(c.image, (new Vector(pxX, pxY)).mult(4), new Vector(c.image.width, c.image.height).mult(4), null, 0, 1, false);
                    } catch (e) { /* ignore draw errors */ }
                }
            }
        } else if (this.importedSheets && this.importedSheets.length) {
            // Legacy tilesheet preview: draw first sheet centered
            const s = this.importedSheets[0];
            if (s && s.image) this.Draw.image(s.image, new Vector(32, 32), new Vector(512, 512), null, 0, 1, false);
        } else {
            // no fallback test geometry in world; leave empty
        }

        // draw buffered segment inside world transform so it respects pan/zoom
        if (this.editor && this.editor.polyObjects) {
            for (const obj of this.editor.polyObjects) { obj.drawBuffer(this.Draw, '#66FFAA55'); obj.drawDebug(this.Draw); }
        }
        if (this.segment) { this.segment.drawBuffer(this.Draw, '#44AAFF66'); this.segment.drawDebug(this.Draw); }

        // Draw current editing poly (thin lines and points)
        const cur = this.editor.current || [];
        for (let i=1;i<cur.length;i++) {
            this.Draw.line(cur[i-1], cur[i], '#FF66AA', 2);
        }
        for (const p of cur) this.Draw.circle(p, 4, '#FF66AA', true);
        // draw cat collision radius (outline)
        if (this.cat) {
            const center = this.cat.pos.add(this.cat.size.mult(0.5));
            const radius = this.catRadius || Math.min(this.cat.size.x, this.cat.size.y) * 0.2;
            this.Draw.circle(center, radius, '#00FF00AA', false, 2);
        }
        // draw cat above segment for visibility
        this.cat.draw(new Vector(0,0));
        // Draw spawn/goal boxes (world)
        if (this.levelData.spawn) {
            const p = new Vector(this.levelData.spawn.pos.x, this.levelData.spawn.pos.y);
            const sz = new Vector(this.levelData.spawn.size.x, this.levelData.spawn.size.y);
            // single call: fill + outline
            this.Draw.rect(p, sz, '#FFFF0088', true, true, 2, '#FFFF00FF');
        }
        if (this.levelData.goal) {
            const p = new Vector(this.levelData.goal.pos.x, this.levelData.goal.pos.y);
            const sz = new Vector(this.levelData.goal.size.x, this.levelData.goal.size.y);
            // single call: fill + outline
            this.Draw.rect(p, sz, '#00FF0088', true, true, 2, '#00FF00FF');
        }

        this.Draw.popMatrix();

        // Optional UI label and Entities UI label
        if (this.UIDraw) {
            this.UIDraw.useCtx('UI');
            this.UIDraw.text('Collision Editor (WIP)', new Vector(32, 32), '#FFFFFFFF', 1, 20, { align: 'left', baseline: 'top' });
            const count = (this.importedChunks && this.importedChunks.length) ? this.importedChunks.length : (this.importedSheets && this.importedSheets.length) ? this.importedSheets.length : 0;
            if (count) this.UIDraw.text(`Images: ${count}`, new Vector(32, 56), '#FFFFFFFF', 1, 16, { align: 'left', baseline: 'top' });
            // Small HUD showing zoom level
            this.UIDraw.text(`zoom: ${this.zoom.x.toFixed(2)}x`, new Vector(32, 76), '#FFFFFFFF', 1, 16, { align: 'left', baseline: 'top' });
            // Draw Entities UI components and labels at their positions
            if (this.entitiesUI && this.entitiesUI.menu) {
                const m = this.entitiesUI.menu;
                this.entitiesUI.menu.draw(this.UIDraw);
                // Title inside label area
                this.UIDraw.text('Entities', m.pos.add(new Vector(12, 10)), '#FFFFFFCC', 1, 14, { align: 'left', baseline: 'top' });
                // Button label: align with button local pos (8,34)
                this.UIDraw.text('Add Box', m.pos.add(new Vector(16, 40)), '#FFFFFF', 1, 13, { align: 'left', baseline: 'top' });
            }
        }

        // Draw entities in world (use sprites if available)
        if (Array.isArray(this.entitiesRuntime) && this.entitiesRuntime.length) {
            for (const r of this.entitiesRuntime) {
                if (r && r.type === 'box' && r.sprite) r.sprite.draw(new Vector(0,0));
            }
        } else if (Array.isArray(this.levelData.entities)) {
            // Fallback if runtime not built yet
            for (const ent of this.levelData.entities) {
                if (ent.type === 'box' && ent.pos && ent.size) {
                    const p = new Vector(ent.pos.x, ent.pos.y);
                    const sz = new Vector(ent.size.x, ent.size.y);
                    this.Draw.rect(p, sz, '#00CCFFFF', true, true, 2, '#0066FFFF');
                }
            }
        }
        
    }
}

// Export helpers
CollisionScene.prototype.exportLevelJSON = function(){
    try {
        const data = {
            spawn: this.levelData.spawn,
            goal: this.levelData.goal,
            entities: this.levelData.entities || [],
            collision: (this.editor.polygons || []).map(poly => poly.map(v => [v.x, v.y]))
        };
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'level.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch(e){} }, 0);
    } catch (e) {
        console.warn('exportLevelJSON failed', e);
    }
}
