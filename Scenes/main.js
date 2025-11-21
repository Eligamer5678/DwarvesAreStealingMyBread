    
import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import Geometry from '../js/Geometry.js';

import { perlinNoise } from '../js/noiseGen.js';
import Camera from '../js/Camera.js';
import SpriteSheet from '../js/Spritesheet.js';
import Dwarf from '../js/sprites/Dwarf.js';
import Sprite from '../js/sprites/Sprite.js';
import Slime from '../js/sprites/Slime.js';

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
            // load slime spritesheet
            try {
                const sImg = await new Promise((resolve, reject) => {
                    const i = new Image();
                    i.onload = () => resolve(i);
                    i.onerror = () => reject(new Error('Failed to load slime image'));
                    i.src = 'Assets/Sprites/slime.png';
                });
                const slimeSheet = new SpriteSheet(sImg, 16);
                // assume layout rows: idle(2), walk(2), defeat(6), attack(8)
                slimeSheet.addAnimation('idle', 0, 2);
                slimeSheet.addAnimation('walk', 1, 2);
                slimeSheet.addAnimation('defeat', 2, 6);
                slimeSheet.addAnimation('attack', 3, 8);
                this.SpriteImages.set('slime', slimeSheet);
            } catch (e) {
                console.warn('Failed to load slime spritesheet', e);
            }
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
        // blockMap stores explicit block types placed/generated in the world:
        // key: "sx,sy" -> { type: 'solid'|'ladder' } or null for empty
        this.blockMap = new Map();
        this.torches = new Map(); // key: "sx,sy" -> {intensity:255, range:6}
        this.lightMap = new Map(); // key: "sx,sy" -> numeric level 0..255
        this._lightsDirty = true;
        this.miningProgress = 0;
        this.baseMiningTime = 2.0; // seconds to mine with speed=1.0
        this.maxLight = 12; // max light level (integer steps)

        // Make noise tiles match the player's size so one tile == one dwarf
        this.noiseTileSize = (this.player && this.player.size && this.player.size.x) ? this.player.size.x*1.1 : 8;
        // Start camera tracking with sensible defaults; tune these values as needed.
        this.camera.track(this.player, {
            offset: new Vector(0, -8),      // lift player slightly above center
            panSmooth: 12,                  // override pan smoothing while tracking
            zoomSmooth: 10,                  // override zoom smoothing while tracking
            zoom: 3
        });
        this.isReady = true;
        // monster group: store active enemy sprites
        this.monsterGroup = [];
        // spawn a few slimes for testing
        try {
            const spawnCount = 50;
            for (let i = 0; i < spawnCount; i++) {
                const sx = (this.player.pos.x || 0) + (Math.random() * 200 - 100);
                const sy = (this.player.pos.y || 0) + (Math.random() * 120 - 60);
                const sz = Math.max(12, Math.min(48, Math.random() * 32 + 12));
                const s = new Slime(this.Draw, new Vector(sx, sy), new Vector(sz, sz), { scene: this, sheet: this.SpriteImages.get('slime') });
                this.monsterGroup.push(s);
            }
        } catch (e) {
            console.warn('Failed to spawn slimes', e);
        }
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
        // update monsters (only if within active radius)
        if (this.monsterGroup && this.monsterGroup.length) {
            const activeTiles = 32; // monsters beyond this many tiles are frozen
            const maxDist = (this.noiseTileSize || 1) * activeTiles;
            const px = (this.player && this.player.pos) ? (this.player.pos.x + (this.player.size.x || 0) * 0.5) : 0;
            const py = (this.player && this.player.pos) ? (this.player.pos.y + (this.player.size.y || 0) * 0.5) : 0;
            for (const m of this.monsterGroup) {
                try {
                    const mx = (m.pos.x || 0) + (m.size.x || 0) * 0.5;
                    const my = (m.pos.y || 0) + (m.size.y || 0) * 0.5;
                    const d = Math.hypot(px - mx, py - my);
                    if (d <= maxDist) {
                        m.update(tickDelta);
                        // resolve collisions for the monster using same logic as player
                        try { this._resolveSpriteCollisions(m); } catch (e) { /* ignore per-monster errors */ }
                    }
                } catch (e) { console.warn('Monster update failed', e); }
            }
        }
        this._updateHighlight();
        this._updateMining(tickDelta);

        this._collideTiles();
        this._generateChunks();
    }

    _updateMining(tickDelta){
        const miningHeld = !!this.keys.held(' ');
        if (miningHeld && !this._prevMiningHeld) {
            // mining started this frame: capture current highlight as mining target and start progress
            if (this.highlightTile) {
                this._miningActive = true;
                this.miningTarget = { sx: this.highlightTile.sx, sy: this.highlightTile.sy };
                this.miningProgress = 0;
            }
        } else if (!miningHeld && this._prevMiningHeld) {
            // mining released this frame: clear target
            this._miningActive = false;
            this.miningTarget = null;
        }
        this._prevMiningHeld = miningHeld;

        // Torch toggle: press 't' to toggle a torch at the dwarf's current tile (not the highlight)
        if (this.keys.pressed && this.keys.pressed('t')) {
            if (this.player && this.noiseTileSize) {
                const px = (this.player.pos.x || 0) + (this.player.size.x || 0) * 0.5;
                const py = (this.player.pos.y || 0) + (this.player.size.y || 0) * 0.5;
                const tsz = this.noiseTileSize || 1;
                const sx = Math.floor(px / tsz);
                const sy = Math.floor(py / tsz);
                const key = `${sx},${sy}`;
                if (this.torches.has(key)) {
                    // always allow removal
                    this.torches.delete(key);
                    this._lightsDirty = true;
                } else {
                    // only place a torch if the tile is empty (no solid/ladder)
                    const existing = this._getTileValue(sx, sy);
                    if (!existing) {
                        this.torches.set(key, { level: this.maxLight });
                        this._lightsDirty = true;
                    }
                }
            }
        }

        // If currently mining (holding), validate target and advance progress; cancel if invalid or too far
        if (this._miningActive && miningHeld && this.miningTarget && this.player) {
            // validate that the target still exists (solid or ladder)
            const tv = this._getTileValue(this.miningTarget.sx, this.miningTarget.sy);
            const targetExists = (tv && (tv.type === 'solid' || tv.type === 'ladder'));
            // cancel if target no longer exists
            if (!targetExists) {
                this._miningActive = false;
                this.miningTarget = null;
                this.miningProgress = 0;
            } else {
                // cancel if player moved too far away (more than 2 tiles)
                const px = (this.player.pos.x || 0) + (this.player.size.x || 0) * 0.5;
                const py = (this.player.pos.y || 0) + (this.player.size.y || 0) * 0.5;
                const tx = (this.miningTarget.sx * this.noiseTileSize) + (this.noiseTileSize * 0.5);
                const ty = (this.miningTarget.sy * this.noiseTileSize) + (this.noiseTileSize * 0.5);
                const dist = Math.hypot(px - tx, py - ty) / (this.noiseTileSize || 1);
                if (dist > 2.0) {
                    this._miningActive = false;
                    this.miningTarget = null;
                    this.miningProgress = 0;
                } else {
                    const speed = (this.player.currentTool && typeof this.player.currentTool.speed === 'number') ? this.player.currentTool.speed : 1.0;
                    const required = (this.baseMiningTime || 2.0) / Math.max(0.0001, speed);
                    this.miningProgress += tickDelta;
                    if (this.miningProgress >= required) {
                        // complete mining
                        this._mineTile(this.miningTarget.sx, this.miningTarget.sy);
                        // reset mining state (require re-press to mine again)
                        this._miningActive = false;
                        this.miningTarget = null;
                        this.miningProgress = 0;
                    }
                }
            }
        } else if (!miningHeld) {
            // ensure progress resets when not holding
            this.miningProgress = 0;
        }
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
        // Only show the selector highlight when there is an actual block (solid or ladder)
        const val = this._getTileValue(sx, sy);
        const hasBlock = (val && (val.type === 'solid' || val.type === 'ladder'));
        if (hasBlock) this.highlightTile = { sx, sy };
        else this.highlightTile = null;
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
        // treat mining as setting the tile to empty (override with `null`)
        // this.modifiedTiles can hold structured entries; `null` means explicitly empty
        this.modifiedTiles.set(key, null);
        // also remove any generated block (like ladders) at this location
        if (this.blockMap && this.blockMap.has(key)) this.blockMap.delete(key);
        // remove any torch placed on this tile and mark lights dirty
        if (this.torches && this.torches.has(key)) {
            this.torches.delete(key);
            this._lightsDirty = true;
        }
        // Ensure lighting is recomputed because removing a block can change light propagation
        this._lightsDirty = true;
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

        // Ladder detection: only detect ladders close to the player's horizontal center
        // Use Geometry.spriteToTile for intersection tests but do NOT apply resolution
        this.player.onLadder = false;
        const playerCenterX = this.player.pos.x + this.player.size.x * 0.5;
        const tolerance = (this.noiseTileSize || 1) * 0.35; // only detect ladders near the center
        const minSx = Math.floor((playerCenterX - tolerance) / this.noiseTileSize);
        const maxSx = Math.floor((playerCenterX + tolerance) / this.noiseTileSize);
        const topSample = Math.floor(this.player.pos.y / this.noiseTileSize) - 1;
        const bottomSample = Math.floor((this.player.pos.y + this.player.size.y) / this.noiseTileSize) + 1;
        ladder_scan: for (let sy = topSample; sy <= bottomSample; sy++){
            for (let sx = minSx; sx <= maxSx; sx++){
                const t = this._getTileValue(sx, sy);
                if (!t || t.type !== 'ladder') continue;
                const tileWorld = new Vector(sx * this.noiseTileSize, sy * this.noiseTileSize);
                const pPos = this.player.pos.clone();
                const pV = this.player.vlos.clone();
                const res = Geometry.spriteToTile(pPos, pV, size, tileWorld, tileSizeVec, 0);
                if (res && res.collided) {
                    this.player.onLadder = true;
                    break ladder_scan;
                }
            }
        }
        
        for (let dy = -radius; dy <= radius; dy++){
            for (let dx = -radius; dx <= radius; dx++){
                const sx = sampleX + dx;
                const sy = sampleY + dy;
                const val = this._getTileValue(sx, sy);
                // Treat tiles with type 'solid' as collidable
                const isSolid = (val && val.type === 'solid');
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

    // Generic collision resolver for any sprite using tile-based collision.
    // Mirrors the player's collision logic so monsters use the same physics.
    _resolveSpriteCollisions(sprite){
        if(!sprite || !sprite.pos || !this.noiseTileSize) return;
        const prevPos = sprite.pos.clone();
        const size = sprite.size.clone();
        const radius = 3;
        const sampleX = Math.floor(prevPos.x / this.noiseTileSize);
        const sampleY = Math.floor(prevPos.y / this.noiseTileSize);
        const tileSizeVec = new Vector(this.noiseTileSize, this.noiseTileSize);
        let collidedBottom = false;

        for (let dy = -radius; dy <= radius; dy++){
            for (let dx = -radius; dx <= radius; dx++){
                const sx = sampleX + dx;
                const sy = sampleY + dy;
                const val = this._getTileValue(sx, sy);
                const isSolid = (val && val.type === 'solid');
                if (!isSolid) continue;
                const tileWorld = new Vector(sx * this.noiseTileSize, sy * this.noiseTileSize);
                const res = Geometry.spriteToTile(sprite.pos, sprite.vlos, size, tileWorld, tileSizeVec, 5);
                if (res) {
                    if (res.collided && res.collided.bottom) collidedBottom = true;
                    sprite.vlos = res.vlos;
                    sprite.pos = res.pos;
                    sprite.onGround = collidedBottom;
                }
            }
        }
    }
    // Recompute lighting using multi-source BFS propagation.
    // This is not the bitshift optimization yet, but it's a correct baseline
    // that supports many torches and can be optimized later.
    _recomputeLighting(){
        // integer light propagation like Minecraft: each torch seeds `maxLight` and
        // light decreases by 1 per tile; solids block propagation.
        this.lightMap.clear();
        if (!this.torches || this.torches.size === 0) return;

        const q = [];
        const push = (sx, sy, level) => {
            const k = `${sx},${sy}`;
            const cur = this.lightMap.get(k) || 0;
            if (level <= cur) return;
            this.lightMap.set(k, level);
            q.push({sx, sy, level});
        };

        // seed with torches (use integer `level` field)
        for (const [k, t] of this.torches) {
            const parts = k.split(',');
            if (parts.length < 2) continue;
            const sx = parseInt(parts[0], 10);
            const sy = parseInt(parts[1], 10);
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
            const lvl = (t && Number.isFinite(t.level)) ? Math.min(this.maxLight, Math.max(0, Math.floor(t.level))) : this.maxLight;
            push(sx, sy, lvl);
        }

        // BFS propagate with 4-neighborhood, decrease by 1 each step
        while (q.length) {
            const cur = q.shift();
            const nextLevel = cur.level - 1;
            if (nextLevel <= 0) continue;
            const neighbors = [ [cur.sx+1,cur.sy], [cur.sx-1,cur.sy], [cur.sx,cur.sy+1], [cur.sx,cur.sy-1] ];
            for (const [nx, ny] of neighbors) {
                // solids should RECEIVE light but still BLOCK propagation beyond them.
                const tile = this._getTileValue(nx, ny);
                const isSolid = (tile && tile.type === 'solid');
                const key = `${nx},${ny}`;
                const curVal = this.lightMap.get(key) || 0;
                if (nextLevel > curVal) {
                    // set light level on this neighbor
                    this.lightMap.set(key, nextLevel);
                    // propagate further only if the neighbor is not solid
                    if (!isSolid) {
                        q.push({ sx: nx, sy: ny, level: nextLevel });
                    }
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
        // If the player or code has modified this sample explicitly, prefer that
        if (this.modifiedTiles && this.modifiedTiles.has(mkey)) {
            // modifiedTiles entries may be primitives (legacy) or structured (null => empty, {type:...})
            const v = this.modifiedTiles.get(mkey);
            if (v === null) return null;
            if (typeof v === 'object') return v;
            // legacy numeric: treat <0.999 as solid, else empty
            if (typeof v === 'number') return (v < 0.999) ? { type: 'solid' } : null;
            return null;
        }
        // next prefer explicit generated/placed blocks
        if (this.blockMap && this.blockMap.has(mkey)) {
            return this.blockMap.get(mkey);
        }
        const cx = Math.floor(sx / this.chunkSize);
        const cy = Math.floor(sy / this.chunkSize);
        const key = this._chunkKey(cx, cy);
        let chunk = this.chunks.get(key);
        if (!chunk) chunk = this._ensureChunk(cx, cy);
        if (!chunk) return null;
        const lx = sx - cx * this.chunkSize;
        const ly = sy - cy * this.chunkSize;
        if (lx < 0 || ly < 0 || lx >= chunk.width || ly >= chunk.height) return null;
        const raw = chunk.data[ly * chunk.width + lx];
        // interpret raw noise value: <0.999 => solid, >=0.999 => empty
        if (typeof raw === 'number' && raw < 0.999) return { type: 'solid' };
        return null;
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
        // Simpler seeded ladder columns: pick columns deterministically using global x
        // and place ladder tiles for the whole column within this chunk (skipping player-modified tiles).
        try {
            if (!this.blockMap) this.blockMap = new Map();
            const raw = map.data;
            const w = map.width, h = map.height;
            const seed = (this.noiseOptions && Number.isFinite(this.noiseOptions.seed)) ? Number(this.noiseOptions.seed) : 1337;
            const columnChance = (this.noiseOptions && Number.isFinite(this.noiseOptions.ladderChance)) ? Number(this.noiseOptions.ladderChance) : 0.02;

            // Deterministic per-x pseudo-random: use a simple fract(sin()) hash which
            // behaves well for sparsity and avoids bitwise edge cases across JS engines.
            const pseudo = (s, n) => {
                const x = n * 12.9898 + s * 78.233;
                const v = Math.sin(x) * 43758.5453123;
                return v - Math.floor(v);
            };

            for (let xx = 0; xx < w; xx++) {
                const globalSx = startX + xx;
                const r = pseudo(seed, globalSx);
                if (r >= columnChance) continue;
                // mark entire column within this chunk as ladder (replace chunk content visually)
                for (let y = 0; y < h; y++) {
                    const globalSy = startY + y;
                    const key = `${globalSx},${globalSy}`;
                    if (this.modifiedTiles.has(key)) continue; // do not overwrite player edits
                    this.blockMap.set(key, { type: 'ladder' });
                }
            }
            // After seeding ladders, remove any ladder where the noise map contains a solid block
            // (normal blocks override ladders). Respect player edits in `modifiedTiles`.
            for (let y = 0; y < h; y++) {
                for (let xx = 0; xx < w; xx++) {
                    const v = raw[y * w + xx];
                    if (typeof v === 'number' && v < 0.999) {
                        const sx = startX + xx;
                        const sy = startY + y;
                        const key = `${sx},${sy}`;
                        if (this.modifiedTiles && this.modifiedTiles.has(key)) continue;
                        if (this.blockMap && this.blockMap.has(key)) this.blockMap.delete(key);
                    }
                }
            }
        } catch (e) {
            console.warn('Chunk ladder generation failed', e);
        }

        return { x: cx, y: cy, width: map.width, height: map.height, data: map.data };
    }

    draw() {
        if (!this.isReady) return;
        // Background
        this.Draw.background('#000000');
        this.Draw.useCtx('base');
        
        

        // World transform (use camera)
        this.camera.applyTransform();

        // Ensure light map is up-to-date before drawing tiles
        if (this._lightsDirty) {
            this._recomputeLighting();
            this._lightsDirty = false;
        }

        // Render chunked noise as tiles modulated by per-tile lighting
        const ts = this.noiseTileSize || 4;
        for (const [k, chunk] of this.chunks) {
            const cx = chunk.x, cy = chunk.y;
            const data = chunk.data;
            const w = chunk.width, h = chunk.height;
            const baseX = cx * this.chunkSize * ts;
            const baseY = cy * this.chunkSize * ts;
            for (let yy = 0; yy < h; yy++){
                for (let xx = 0; xx < w; xx++){
                    const sx = cx * this.chunkSize + xx;
                    const sy = cy * this.chunkSize + yy;
                    const tile = this._getTileValue(sx, sy);
                    if (!tile) continue;
                    const pos = new Vector(baseX + xx * ts, baseY + yy * ts);
                    // compute light level (0..maxLight) for this tile
                    const lkey = `${sx},${sy}`;
                    const lvl = (this.lightMap && this.lightMap.has(lkey)) ? this.lightMap.get(lkey) : 0;
                    const ambientMin = 0.12; // minimum ambient brightness
                    const bright = ambientMin + (Math.max(0, Math.min(this.maxLight || 1, lvl)) / Math.max(1, (this.maxLight || 1))) * (1 - ambientMin);

                    // helper: modulate a hex color by brightness and return rgba string
                    const modColor = (hex, b) => {
                        if (!hex) return `rgba(0,0,0,${b})`;
                        let h = hex.replace('#','');
                        if (h.length === 3) h = h.split('').map(c=>c+c).join('');
                        const n = parseInt(h, 16);
                        const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * b)));
                        const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * b)));
                        const bl = Math.max(0, Math.min(255, Math.round((n & 255) * b)));
                        return `rgba(${r},${g},${bl},1.0)`;
                    };

                    if (tile.type === 'solid') {
                        this.Draw.rect(pos, new Vector(ts, ts), modColor('#555555', bright));
                    } else if (tile.type === 'ladder') {
                        // draw ladder: vertical brown strip + rungs, modulated by light
                        this.Draw.rect(pos, new Vector(ts, ts), modColor('#6b4f2b', bright));
                        const rungCount = Math.max(2, Math.floor(ts / 6));
                        for (let r = 0; r < rungCount; r++) {
                            const ry = pos.y + (r + 1) * (ts / (rungCount + 1));
                            this.Draw.line(new Vector(pos.x + ts * 0.15, ry), new Vector(pos.x + ts * 0.85, ry), modColor('#caa97a', bright), 1);
                        }
                    }
                }
            }
        }
        // Draw torches markers (flame + subtle glow)
        if (this.torches && this.torches.size > 0) {
            for (const [k, t] of this.torches) {
                const parts = k.split(',');
                if (parts.length < 2) continue;
                const sx = parseInt(parts[0], 10);
                const sy = parseInt(parts[1], 10);
                if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
                const cx = sx * ts + ts * 0.5;
                const cy = sy * ts + ts * 0.5;
                // outer glow
                this.Draw.circle(new Vector(cx, cy), ts * 0.45, 'rgba(255,180,80,0.12)', true);
                // inner flame
                this.Draw.circle(new Vector(cx, cy), ts * 0.22, 'rgba(255,220,100,1.0)', true);
                // core
                this.Draw.circle(new Vector(cx, cy), ts * 0.08, 'rgba(255,255,255,0.9)', true);
            }
        }

        // Highlight targeted tile (mining) if present
        if (this.highlightTile && Number.isFinite(this.highlightTile.sx) && Number.isFinite(this.highlightTile.sy)) {
            const hx = this.highlightTile.sx * ts;
            const hy = this.highlightTile.sy * ts;
            // translucent yellow fill + stroke
            this.Draw.rect(new Vector(hx, hy), new Vector(ts, ts), 'rgba(255,255,0,0.25)', true, true, 2, '#FFFF00');
        }
        
        // Loading / mining UI: circular progress over locked mining target
        if (this._miningActive && this.miningTarget && this.player) {
            const sx = this.miningTarget.sx, sy = this.miningTarget.sy;
            const cx = sx * ts + ts * 0.5;
            const cy = sy * ts + ts * 0.5;
            const speed = (this.player.currentTool && typeof this.player.currentTool.speed === 'number') ? this.player.currentTool.speed : 1.0;
            const required = (this.baseMiningTime || 2.0) / Math.max(0.0001, speed);
            const frac = Math.max(0, Math.min(1, (this.miningProgress || 0) / required));
            const size = new Vector(ts * 0.8, ts * 0.8);
            // subtle dark background circle
            this.Draw.circle(new Vector(cx, cy), ts * 0.4, 'rgba(0,0,0,0.5)', true);
            // progress arc from -90deg clockwise
            const start = -Math.PI / 2;
            const end = start + frac * Math.PI * 2;
            this.Draw.arc(new Vector(cx, cy), size, start, end, 'rgba(255,220,80,0.95)', true, false);
            // outline
            this.Draw.circle(new Vector(cx, cy), ts * 0.4, 'rgba(255,255,255,0.25)', false, 2);
        }
        // draw monsters (below player)
        if (this.monsterGroup && this.monsterGroup.length) {
            const activeTiles = 32;
            const maxDist = (this.noiseTileSize || 1) * activeTiles;
            const px = (this.player && this.player.pos) ? (this.player.pos.x + (this.player.size.x || 0) * 0.5) : 0;
            const py = (this.player && this.player.pos) ? (this.player.pos.y + (this.player.size.y || 0) * 0.5) : 0;
            for (const m of this.monsterGroup) {
                try {
                    const mx = (m.pos.x || 0) + (m.size.x || 0) * 0.5;
                    const my = (m.pos.y || 0) + (m.size.y || 0) * 0.5;
                    const d = Math.hypot(px - mx, py - my);
                    if (d <= maxDist) {
                        if (typeof m.draw === 'function') m.draw(new Vector(0,0));
                    }
                } catch (e) { console.warn('Monster draw failed', e); }
            }
        }
        // draw player on top of chunks (inside world transform)
        try { if (this.player && typeof this.player.draw === 'function') this.player.draw(new Vector(0,0)); } catch (e) {}
        this.camera.popTransform();
    }
}

