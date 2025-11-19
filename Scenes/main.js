    
import Scene from './Scene.js';
import Vector from '../js/Vector.js';

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
            // allow upstream resources to override
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
            this.isPreloaded = true;
            return true;
        } catch (e) {
            console.warn('MainScene.onPreload failed to load dwarf sheet', e);
            return false;
        }
    }

    onReady() {
        // Camera: handles zoom/offset, input and keyframes
        this.camera = new Camera(this.Draw, this.mouse, {
            minZoom: 0.25,
            maxZoom: 16,
            zoomSmooth: 8,
            zoomImpulse: 12,
            zoomStep: -0.001,
            panSmooth: 8,
            panImpulse: 1.0
        });

        // Perlin noise base options
        this.noiseOptions = { width: 64, height: 64, scale: 24, octaves: 4, seed: 1337, normalize: false, split: 0.2, offsetX: 0, offsetY: 0 ,bridgeWidth:2,connect:true};
        this.noiseTileSize = 8; // world units per noise sample

        // Chunk system: generate 16x16 sample chunks on demand around the mouse/player
        this.chunkSize = 16; // samples per chunk (16x16)
        this.chunks = new Map(); // key: "cx,cy" -> { x:cx, y:cy, data, width, height }
        this.lastMouseChunk = null;

        const sheet = this.SpriteImages.get('dwarf');
        this.player = new Dwarf(this.keys, this.Draw, new Vector(200, 200), new Vector(48, 48), sheet, { type: 'platformer' });
        // Start camera tracking with sensible defaults; tune these values as needed.
        this.camera.track(this.player, {
            offset: new Vector(0, -8),      // lift player slightly above center
            boundingRadius: 64,             // pixels: allow small movement before recenter
            stopVel: 1.5,                   // world units/sec: when nearly stopped, center
            panSmooth: 12,                  // override pan smoothing while tracking
            zoomSmooth: 10                  // override zoom smoothing while tracking
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


        // Generate chunks around the player when they move into a new chunk
        try {
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
        } catch (e){ /* non-fatal */ }
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
                    this.Draw.rect(new Vector(baseX + xx * ts, baseY + yy * ts), new Vector(ts, ts), `rgb(${c},${c},${c})`);
                }
            }
        }
        // draw player on top of chunks (inside world transform)
        try { if (this.player && typeof this.player.draw === 'function') this.player.draw(new Vector(0,0)); } catch (e) {}
        this.camera.popTransform();
    }
}

