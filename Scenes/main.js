    
import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import Geometry from '../js/Geometry.js';

import { perlinNoise } from '../js/noiseGen.js';
import Camera from '../js/Camera.js';
import SpriteSheet from '../js/Spritesheet.js';
import Dwarf from '../js/sprites/Dwarf.js';
import Sprite from '../js/sprites/Sprite.js';

export class MainScene extends Scene {
    constructor(...args) {
        super('main', ...args);
        this.loaded = 0;
        this.playerCount = 1;
        this.defaultSaveData = {
            'settings':{
                'volume': {

                },
                'colors':{

                },
            },
            'game':{

            }
        }
        this.settings = this.defaultSaveData.settings;
        this.elements = new Map()
    }
    /**
     * Preload assets for the scene. Loads dwarf spritesheet into `this.SpriteImages`.
     * @param {Map|null} resources Optional incoming resources map
     */
    async onPreload(resources = null) {
        try {
            if (!this.SpriteImages) this.SpriteImages = new Map();
            if (resources && resources instanceof Map && resources.has('sprites')) {
                const sprites = resources.get('sprites');
                if (sprites && sprites.get && sprites.get('dwarf')) {
                    this.SpriteImages.set('dwarf', sprites.get('dwarf'));
                    this.isPreloaded = true;
                    return true;
                }
            }
    
            // Load the image
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error('Failed to load dwarf image'));
                i.src = 'Assets/Sprites/dwarf.png';
            });
    
            const sheet = new SpriteSheet(img, 16);
            if (!sheet.animations || sheet.animations.size === 0) {
                sheet.addAnimation('idle', 0, 6);
                sheet.addAnimation('hold', 1, 3);
                sheet.addAnimation('march', 2, 5);
                sheet.addAnimation('walk', 3, 5);
            }
            this.SpriteImages.set('dwarf', sheet);
            this.player = new Dwarf(this.keys, this.Draw, new Vector(150, 220), new Vector(48, 48), sheet, { type: 'platformer' });
            this.isPreloaded = true;
            return true;
        } catch (error) {
            console.error('Failed to load resources in mainScene:',error)
            return false;
        }
    }

    onReady() {
        // Camera: handles zoom/offset, input and keyframes
        this.camera = new Camera(this.Draw, this.mouse, {
            minZoom: 4,
            maxZoom: 16,
            zoomSmooth: 8,
            zoomImpulse: 12,
            zoomStep: -0.001,
            panSmooth: 8,
            panImpulse: 1.0
        });

        // Perlin noise base options
        this.noiseOptions = { width: 64, height: 64, scale: 24, octaves: 4, seed: 1337, normalize: false, split: 0.2, offsetX: 0, offsetY: 0 ,bridgeWidth:2,connect:true};
        // `noiseTileSize` will be set to match the player's draw size so that
        // one noise tile == one dwarf. It is assigned after player creation.

        // Chunk system: generate 16x16 sample chunks on demand around the mouse/player
        this.chunkSize = 16; // samples per chunk (16x16)
        this.chunks = new Map(); // key: "cx,cy" -> { x:cx, y:cy, data, width, height }
        this.lastMouseChunk = null;
        this.modifiedTiles = new Map(); // key: "sx,sy" -> numeric tile value (overrides chunk data)
        this._miningActive = false;
        this._prevMiningHeld = false;
        this.miningTarget = null;

        // Make noise tiles match the player's size so one tile == one dwarf
        this.noiseTileSize = (this.player && this.player.size && this.player.size.x) ? this.player.size.x*1.1 : 8;
        // Start camera tracking with sensible defaults; tune these values as needed.
        this.camera.track(this.player, {
            offset: new Vector(0, -8),      // lift player slightly above center
            panSmooth: 12,                  // override pan smoothing while tracking
            zoomSmooth: 10,                  // override zoom smoothing while tracking
            zoom: 5
        });
        this.isReady = true;
    }

    


    sceneTick(tickDelta) {
        this.mouse.update(tickDelta)
        this.keys.update(tickDelta)
        this.mouse.setMask(0)
        // Do UI here
        this.mouse.setPower(0)
        
        this.camera.handleInput(tickDelta);
        this.camera.update(tickDelta);

        this.player.update(tickDelta);
        // update target highlight for mining based on held input/facing
        this._updateHighlight();
        // Mining state: lock the target on press start and mine once; while held,
        // keep highlighting the same tile to avoid flicker when player input/pos changes.
        const miningHeld = !!this.keys.held(' ');
        if (miningHeld && !this._prevMiningHeld) {
            // mining started this frame: capture current highlight as mining target and mine it
            if (this.highlightTile) {
                this._miningActive = true;
                this.miningTarget = { sx: this.highlightTile.sx, sy: this.highlightTile.sy };
                this._mineTile(this.miningTarget.sx, this.miningTarget.sy);
            }
        } else if (!miningHeld && this._prevMiningHeld) {
            // mining released this frame: clear target
            this._miningActive = false;
            this.miningTarget = null;
        }
        this._prevMiningHeld = miningHeld;

        this._collideTiles();
        this._generateChunks();
    }

    _updateHighlight(){
        // If mining is active and we have a locked mining target, keep that highlighted
        if (this._miningActive && this.miningTarget) {
            this.highlightTile = { sx: this.miningTarget.sx, sy: this.miningTarget.sy };
            return;
        }
        if (!this.player || !this.noiseTileSize) { this.highlightTile = null; return; }
        const input = this.player.inputDir || new Vector(0,0);
        const ix = input.x || 0;
        const iy = input.y || 0;
        const centerY = this.player.pos.y + this.player.size.y * 0.5;

        const holdUp = (iy < -0.5) || this.keys.held('ArrowUp');

        let sx, sy;
        if (holdUp) {
            const centerX = this.player.pos.x + this.player.size.x * 0.5;
            const headY = this.player.pos.y - 10;
            sx = Math.floor(centerX / this.noiseTileSize);
            sy = Math.floor(headY / this.noiseTileSize);
        } else {
            const holdLeft = ix < -0.5;
            const holdRight = ix > 0.5;
            let dir = 1;
            if (holdLeft) dir = -1;
            else if (holdRight) dir = 1;
            else {
                if (this.player.invert && typeof this.player.invert.x === 'number') dir = this.player.invert.x;
                else if (typeof this.player.invert === 'number') dir = this.player.invert;
            }
            const frontX = this.player.pos.x + this.player.size.x * 0.5 + dir * (this.player.size.x * 0.6);
            sx = Math.floor(frontX / this.noiseTileSize);
            sy = Math.floor(centerY / this.noiseTileSize);
        }
        this.highlightTile = { sx, sy };
    }

    _tryMineInFront(){
        if (!this.player || !this.noiseTileSize) return;

        const input = this.player.inputDir || new Vector(0,0);
        const ix = input.x || 0;
        const iy = input.y || 0;
        const centerY = this.player.pos.y + this.player.size.y * 0.5;

        // allow upward mining when player holds up (or presses ArrowUp) even if not moving
        const holdUp = (iy < -0.5) || this.keys.held('ArrowUp');

        let sx, sy;
        if (holdUp) {
            const centerX = this.player.pos.x + this.player.size.x * 0.5;
            const headY = this.player.pos.y - 5;
            sx = Math.floor(centerX / this.noiseTileSize);
            sy = Math.floor(headY / this.noiseTileSize);
        } else {
            // horizontal mining based on held input direction; fall back to facing if none held
            const holdLeft = ix < -0.5;
            const holdRight = ix > 0.5;
            let dir = 1;
            if (holdLeft) dir = -1;
            else if (holdRight) dir = 1;
            else {
                // fallback to sprite facing (invert.x or scalar)
                if (this.player.invert && typeof this.player.invert.x === 'number') dir = this.player.invert.x;
                else if (typeof this.player.invert === 'number') dir = this.player.invert;
            }

            let frontX = this.player.pos.x + this.player.size.x * 0.5 + dir * (this.player.size.x * 0.6);
            sx = Math.floor(frontX / this.noiseTileSize);
            sy = Math.floor(centerY / this.noiseTileSize);
        }

        this._mineTile(sx, sy);
    }

    _mineTile(sx, sy){
        const key = `${sx},${sy}`;
        // treat mining as setting the tile to empty (1.0) — matches render check (v >= 0.999)
        this.modifiedTiles.set(key, 1.0);
        // If the chunk containing this sample is already generated, update it for immediate effect
        const cx = Math.floor(sx / this.chunkSize);
        const cy = Math.floor(sy / this.chunkSize);
        const ckey = this._chunkKey(cx, cy);
        const chunk = this.chunks.get(ckey);
        if (chunk) {
            const lx = sx - cx * this.chunkSize;
            const ly = sy - cy * this.chunkSize;
            if (lx >= 0 && ly >= 0 && lx < chunk.width && ly < chunk.height) {
                chunk.data[ly * chunk.width + lx] = 1.0;
            }
        }
    }
    _collideTiles(){
        if(!this.player || !this.noiseTileSize) {console.log('missing args'); return;}

        // Compute the assumed previous position (before the update moved it)

        const prevPos = this.player.pos.clone();
        const size = this.player.size.clone();
        

        const radius = 3; // 1 -> 3x3, 2 -> 5x5
        
        const sampleX = Math.floor(prevPos.x / this.noiseTileSize);
        const sampleY = Math.floor(prevPos.y / this.noiseTileSize);
        
        const tileSizeVec = new Vector(this.noiseTileSize, this.noiseTileSize);
        let collidedBottom = false;
        
        for (let dy = -radius; dy <= radius; dy++){
            for (let dx = -radius; dx <= radius; dx++){
                const sx = sampleX + dx;
                const sy = sampleY + dy;
                const val = this._getTileValue(sx, sy);
                // Treat solid tiles as numeric values less than 0.999 (empty threshold)
                const isSolid = (typeof val === 'number' && val < 0.999);
                if (!isSolid) continue;
                
                const tileWorld = new Vector(sx * this.noiseTileSize, sy * this.noiseTileSize);
                const res = Geometry.spriteToTile(this.player.pos, this.player.vlos, size, tileWorld, tileSizeVec, 5);
                if (res) {
                    if (res.collided && res.collided.bottom) collidedBottom = true;
                    // apply resolved position/velocity to player
                    this.player.vlos = res.vlos;
                    this.player.pos = res.pos;
                    // mark grounded state for the player (used by jump logic)
                    this.player.onGround = collidedBottom;
                }
            }
        }

    }
    _generateChunks(){
        // prefer player world position; fall back to mouse if player missing
        let worldX = 0, worldY = 0;
        if (this.player && this.player.pos) {
            worldX = this.player.pos.x;
            worldY = this.player.pos.y;
        } else if (this.mouse && this.mouse.pos) {
            worldX = this.mouse.pos.x;
            worldY = this.mouse.pos.y;
        }
    
        const sampleX = Math.floor(worldX / (this.noiseTileSize || 1));
        const sampleY = Math.floor(worldY / (this.noiseTileSize || 1));
        const cx = Math.floor(sampleX / this.chunkSize);
        const cy = Math.floor(sampleY / this.chunkSize);
        const ck = `${cx},${cy}`;
        if (this.lastMouseChunk !== ck) {
            this.lastMouseChunk = ck;
            // radius in chunks to generate around player (1 -> 3x3)
            const radius = 1;
            for (let dy = -radius; dy <= radius; dy++){
                for (let dx = -radius; dx <= radius; dx++){
                    const ncx = cx + dx, ncy = cy + dy;
                    this._ensureChunk(ncx, ncy);
                }
            }
        }
    }

    // --- Chunk helpers ---
    _chunkKey(cx, cy){ return `${cx},${cy}`; }

    _ensureChunk(cx, cy){
        const key = this._chunkKey(cx,cy);
        if (this.chunks.has(key)) return this.chunks.get(key);
        const chunk = this._generateChunk(cx, cy);
        this.chunks.set(key, chunk);
        return chunk;
    }

    /**
     * Return the noise value for a global sample coordinate (sx, sy).
     * This will ensure the containing chunk exists and return the value
     * (number) or null when out-of-range.
     */
    _getTileValue(sx, sy){
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
        const mkey = `${sx},${sy}`;
        if (this.modifiedTiles && this.modifiedTiles.has(mkey)) return this.modifiedTiles.get(mkey);
        const cx = Math.floor(sx / this.chunkSize);
        const cy = Math.floor(sy / this.chunkSize);
        const key = this._chunkKey(cx, cy);
        let chunk = this.chunks.get(key);
        if (!chunk) chunk = this._ensureChunk(cx, cy);
        if (!chunk) return null;
        const lx = sx - cx * this.chunkSize;
        const ly = sy - cy * this.chunkSize;
        if (lx < 0 || ly < 0 || lx >= chunk.width || ly >= chunk.height) return null;
        return chunk.data[ly * chunk.width + lx];
    }

    _generateChunk(cx, cy){
        // chunk sample origin (in sample units)
        const startX = cx * this.chunkSize;
        const startY = cy * this.chunkSize;
        const opts = Object.assign({}, this.noiseOptions || {});
        // remove width/height if present
        delete opts.width; delete opts.height;
        // set offsets so perlinNoise samples correspond to global sample coordinates
        opts.offsetX = startX;
        opts.offsetY = startY;
        const map = perlinNoise(this.chunkSize, this.chunkSize, opts);
        return { x: cx, y: cy, width: map.width, height: map.height, data: map.data };
    }

    draw() {
        if (!this.isReady) return;
        // Background
        this.Draw.background('#000000');
        this.Draw.useCtx('base');
        
        

        // World transform (use camera)
        this.camera.applyTransform();

        // Render chunked noise as grayscale tiles
        const ts = this.noiseTileSize || 4;
        for (const [k, chunk] of this.chunks) {
            const cx = chunk.x, cy = chunk.y;
            const data = chunk.data;
            const w = chunk.width, h = chunk.height;
            const baseX = cx * this.chunkSize * ts;
            const baseY = cy * this.chunkSize * ts;
            for (let yy = 0; yy < h; yy++){
                for (let xx = 0; xx < w; xx++){
                    const v = data[yy * w + xx];
                    const c = Math.max(0, Math.min(255, Math.floor(v * 255)));
                    // Skip tiles that are '1' (treated as empty/transparent).
                    if (c >= 0.999) continue;
                    this.Draw.rect(new Vector(baseX + xx * ts, baseY + yy * ts), new Vector(ts, ts), '#555555');
                }
            }
        }
        // Highlight targeted tile (mining) if present
        if (this.highlightTile && Number.isFinite(this.highlightTile.sx) && Number.isFinite(this.highlightTile.sy)) {
            const hx = this.highlightTile.sx * ts;
            const hy = this.highlightTile.sy * ts;
            // translucent yellow fill + stroke
            this.Draw.rect(new Vector(hx, hy), new Vector(ts, ts), 'rgba(255,255,0,0.25)', true, true, 2, '#FFFF00');
        }
        // draw player on top of chunks (inside world transform)
        try { if (this.player && typeof this.player.draw === 'function') this.player.draw(new Vector(0,0)); } catch (e) {}
        this.camera.popTransform();
    }
}

