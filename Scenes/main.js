import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import Camera from '../js/Camera.js';
import SpriteSheet from '../js/Spritesheet.js';
import Dwarf from '../js/sprites/Dwarf.js';
import Slime from '../js/sprites/Slime.js';
import Moth from '../js/sprites/Moth.js';
import ChunkManager from '../js/ChunkManager.js';
import LightingSystem from '../js/LightingSystem.js';
import MiningSystem from '../js/MiningSystem.js';
import TileHighlight from '../js/TileHighlight.js';
import EntityManager from '../js/EntityManager.js';
import CollisionSystem from '../js/CollisionSystem.js';

export class MainScene extends Scene {
    constructor(...args) {
        super('main', ...args);
        this.loaded = 0;
        this.playerCount = 1;
        this.defaultSaveData = {
            'settings': {
                'volume': {},
                'colors': {},
            },
            'game': {}
        };
        this.settings = this.defaultSaveData.settings;
        this.elements = new Map();
    }
    /**
     * Preload assets for the scene. Loads spritesheet into `this.SpriteImages`.
     * @param {Map|null} resources Optional incoming resources map
     */
    async onPreload(resources = null) {
        try {
            if (!this.SpriteImages) this.SpriteImages = new Map();
            
            // Check for pre-loaded resources
            if (resources && resources instanceof Map && resources.has('sprites')) {
                const sprites = resources.get('sprites');
                if (sprites && sprites.get && sprites.get('dwarf')) {
                    this.SpriteImages.set('dwarf', sprites.get('dwarf'));
                    this.isPreloaded = true;
                    return true;
                }
            }
    
            // Load dwarf spritesheet
            const dwarfImg = await this._loadImage('Assets/Sprites/dwarf.png', 'dwarf');
            const dwarfSheet = new SpriteSheet(dwarfImg, 16);
            dwarfSheet.addAnimation('idle', 0, 6);
            dwarfSheet.addAnimation('hold', 1, 3);
            dwarfSheet.addAnimation('march', 2, 5);
            dwarfSheet.addAnimation('walk', 3, 5);
            this.SpriteImages.set('dwarf', dwarfSheet);

            // Load slime spritesheet
            try {
                const slimeImg = await this._loadImage('Assets/Sprites/slime.png', 'slime');
                const slimeSheet = new SpriteSheet(slimeImg, 16);
                slimeSheet.addAnimation('idle', 0, 2);
                slimeSheet.addAnimation('walk', 0, 2);
                slimeSheet.addAnimation('defeat', 1, 6);
                slimeSheet.addAnimation('attack', 2, 8);
                this.SpriteImages.set('slime', slimeSheet);
            } catch (e) {
                console.warn('Failed to load slime spritesheet', e);
            }

            // Load moth spritesheet
            try {
                const mothImg = await this._loadImage('Assets/Sprites/moth.png', 'moth');
                const mothSheet = new SpriteSheet(mothImg, 16);
                // row0: fly (6 frames), row1: defeat (8 frames)
                mothSheet.addAnimation('fly', 0, 6);
                mothSheet.addAnimation('defeat', 1, 8);
                this.SpriteImages.set('moth', mothSheet);
            } catch (e) {
                console.warn('Failed to load moth spritesheet', e);
            }

            // Create player
            this.player = new Dwarf(
                this.keys, 
                this.Draw, 
                new Vector(150, 220), 
                new Vector(48, 48), 
                dwarfSheet, 
                { type: 'platformer' }
            );

            this.isPreloaded = true;
            return true;
        } catch (error) {
            console.error('Failed to load resources in mainScene:', error);
            return false;
        }
    }

    async _loadImage(src, name) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load ${name} image`));
            img.src = src;
        });
    }

    onReady() {
        // Prevent double initialization
        if (this.isReady) {
            console.warn('onReady called but scene already ready, skipping re-initialization');
            return;
        }

        // Tile size matches player sprite size
        this.noiseTileSize = (this.player && this.player.size && this.player.size.x) 
            ? this.player.size.x * 1.1 
            : 8;

        // Enable moth path debugging visualization
        this.debugMothPaths = true;

        // Initialize systems
        this._initializeChunkSystem();
        // Ensure player is not embedded in solid tiles for some seeds
        this._ensurePlayerSpawn();
        this._initializeLightingSystem();
        this._initializeMiningSystem();
        this._initializeHighlightSystem();
        this._initializeCollisionSystem();
        this._initializeEntitySystem();
        this._initializeCamera();

        this.isReady = true;
    }

    _initializeChunkSystem() {
        const noiseOptions = {
            width: 64, height: 64, scale: 24, octaves: 4,
            seed:3, normalize: false, split: 0.2,
            offsetX: 0, offsetY: 0, bridgeWidth: 2, connect: true
        };

        this.chunkManager = new ChunkManager({
            chunkSize: 16,
            noiseTileSize: this.noiseTileSize,
            noiseOptions: noiseOptions
        });
    }

    // Ensure the player's starting position is free. If the current player position
    // lies inside solid tiles (due to generation seed), search outward for the nearest
    // tile area that can contain the player and move them there.
    _ensurePlayerSpawn() {
        if (!this.player || !this.chunkManager) return;
        const ts = this.noiseTileSize || 8;
        // generate surrounding chunks so getTileValue will work
        this.chunkManager.generateChunksAround(this.player.pos.x, this.player.pos.y, 2);

        // convert current player pos to tile coords
        const startTx = Math.floor(this.player.pos.x / ts);
        const startTy = Math.floor(this.player.pos.y / ts);

        // required tile footprint for player
        const wTiles = Math.max(1, Math.ceil(this.player.size.x / ts));
        const hTiles = Math.max(1, Math.ceil(this.player.size.y / ts));

        const keyOf = (x,y)=>`${x},${y}`;
        const visited = new Set();
        const q = [];
        q.push({x:startTx,y:startTy,d:0});
        visited.add(keyOf(startTx,startTy));
        const maxRadius = 64; // tiles

        const isAreaFree = (tx, ty) => {
            for (let yy = 0; yy < hTiles; yy++) {
                for (let xx = 0; xx < wTiles; xx++) {
                    const vx = tx + xx;
                    const vy = ty + yy;
                    const tile = this._getTileValue(vx, vy);
                    if (tile && tile.type === 'solid') return false;
                }
            }
            return true;
        };

        if (isAreaFree(startTx, startTy)) return; // already good

        let found = null;
        while (q.length) {
            const cur = q.shift();
            if (cur.d > maxRadius) break;
            // search neighbors in 8 directions
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = cur.x + dx;
                    const ny = cur.y + dy;
                    const k = keyOf(nx, ny);
                    if (visited.has(k)) continue;
                    visited.add(k);
                    if (isAreaFree(nx, ny)) {
                        found = {tx: nx, ty: ny};
                        break;
                    }
                    q.push({x: nx, y: ny, d: cur.d + 1});
                }
                if (found) break;
            }
            if (found) break;
        }

        if (found) {
            // place player so top-left matches tile top-left
            const worldX = found.tx * ts;
            const worldY = found.ty * ts;
            this.player.pos.x = worldX;
            this.player.pos.y = worldY;
            // update camera immediately if present
            try { if (this.camera && typeof this.camera.track === 'function') this.camera.track(this.player); } catch (e) {}
            console.log('Player spawn moved to nearest free tile:', found.tx, found.ty);
        } else {
            console.warn('Could not find free spawn area for player within radius');
        }
    }

    _initializeLightingSystem() {
        this.lightingSystem = new LightingSystem(this.chunkManager, {
            maxLight: 12,
            ambientMin: 0.12
        });
    }

    _initializeMiningSystem() {
        this.miningSystem = new MiningSystem(
            this.chunkManager,
            this.lightingSystem,
            this.keys,
            {
                noiseTileSize: this.noiseTileSize,
                baseMiningTime: 2.0,
                miningKey: ' ',
                maxMiningDistance: 2.0
            }
        );
        this.miningSystem.setPlayer(this.player);
    }

    _initializeHighlightSystem() {
        this.highlightSystem = new TileHighlight(this.chunkManager, this.keys, {
            noiseTileSize: this.noiseTileSize
        });
        this.highlightSystem.setPlayer(this.player);
    }

    _initializeCollisionSystem() {
        this.collisionSystem = new CollisionSystem(this.chunkManager, {
            noiseTileSize: this.noiseTileSize,
            collisionRadius: 3
        });
    }

    _initializeEntitySystem() {
        this.entityManager = new EntityManager(this.chunkManager, this.Draw, {
            noiseTileSize: this.noiseTileSize,
            activeRadius: 32
        });
        this.entityManager.setPlayer(this.player);

        // Spawn slimes
        this._spawnSlimes();
        // Spawn moths
        this._spawnMoths();
    }

    _initializeCamera() {
        this.camera = new Camera(this.Draw, this.mouse, {
            minZoom: 4,
            maxZoom: 16,
            zoomSmooth: 8,
            zoomImpulse: 12,
            zoomStep: -0.001,
            panSmooth: 8,
            panImpulse: 1.0
        });

        this.camera.track(this.player, {
            offset: new Vector(0, -8),
            panSmooth: 12,
            zoomSmooth: 10,
            zoom: 3
        });
    }

    _spawnSlimes() {
        try {
            const slimeSheet = this.SpriteImages.get('slime');
            if (!slimeSheet) {
                console.warn('No slime spritesheet available; skipping slime spawn.');
                return;
            }

            const spawnCount = 50;
            const ts = this.noiseTileSize || 8;
            const playerCenter = this.player.pos.add(this.player.size.mult(0.5));
            for (let i = 0; i < spawnCount; i++) {
                // try to find a free spawn location, avoid spawning inside solid tiles or too close to player
                let placed = false;
                for (let attempt = 0; attempt < 12; attempt++) {
                    const sx = (this.player.pos.x || 0) + (Math.random() * 200 - 100);
                    const sy = (this.player.pos.y || 0) + (Math.random() * 120 - 60);
                    // check tile under spawn
                    const tx = Math.floor(sx / ts);
                    const ty = Math.floor(sy / ts);
                    const tile = this._getTileValue(tx, ty);
                    const dist = Math.hypot(sx - playerCenter.x, sy - playerCenter.y);
                    if (tile && tile.type === 'solid') continue; // inside block
                    if (dist < ts * 1.5) continue; // too close to player
                    // good spot
                    const sz = Math.max(12, Math.min(48, Math.random() * 32 + 12));
                    const slime = new Slime(
                        this.Draw,
                        new Vector(sx, sy),
                        new Vector(sz, sz),
                        slimeSheet,
                        { scene: this }
                    );
                    this.entityManager.addEntity(slime);
                    placed = true;
                    break;
                }
                if (!placed) {
                    // fallback: still spawn but slightly offset above player
                    const sx = playerCenter.x + (Math.random()*40-20);
                    const sy = playerCenter.y - (ts * 2 + Math.random()*20);
                    const sz = Math.max(12, Math.min(48, Math.random() * 32 + 12));
                    const slime = new Slime(this.Draw, new Vector(sx, sy), new Vector(sz, sz), slimeSheet, { scene: this });
                    this.entityManager.addEntity(slime);
                }
            }
        } catch (e) {
            console.warn('Failed to spawn slimes', e);
        }
    }

    _spawnMoths() {
        try {
            const mothSheet = this.SpriteImages.get('moth');
            if (!mothSheet) {
                console.warn('No moth spritesheet available; skipping moth spawn.');
                return;
            }

            const spawnCount = 1000;
            const ts = this.noiseTileSize || 8;
            const playerCenter = this.player.pos.add(this.player.size.mult(0.5));
            for (let i = 0; i < spawnCount; i++) {
                let placed = false;
                for (let attempt = 0; attempt < 16; attempt++) {
                    const sx = (this.player.pos.x || 0) + (Math.random() * 400 - 200);
                    const sy = (this.player.pos.y || 0) + (Math.random() * 240 - 120);
                    const tx = Math.floor(sx / ts);
                    const ty = Math.floor(sy / ts);
                    const tile = this._getTileValue(tx, ty);
                    const dist = Math.hypot(sx - playerCenter.x, sy - playerCenter.y);
                    if (tile && tile.type === 'solid') continue;
                    if (dist < ts * 1.5) continue;
                    const sz = Math.max(12, Math.min(32, Math.random() * 20 + 12));
                    const moth = new Moth(this.Draw, new Vector(sx, sy), new Vector(sz, sz), mothSheet, { scene: this });
                    this.entityManager.addEntity(moth);
                    placed = true;
                    break;
                }
                if (!placed) {
                    const sx = playerCenter.x + (Math.random()*60-30);
                    const sy = playerCenter.y - (ts * 3 + Math.random()*40);
                    const sz = Math.max(12, Math.min(32, Math.random() * 20 + 12));
                    const moth = new Moth(this.Draw, new Vector(sx, sy), new Vector(sz, sz), mothSheet, { scene: this });
                    this.entityManager.addEntity(moth);
                }
            }
        } catch (e) {
            console.warn('Failed to spawn moths', e);
        }
    }

    sceneTick(tickDelta) {
        // Update input systems
        this.mouse.update(tickDelta);
        this.keys.update(tickDelta);
        this.mouse.setMask(0);
        this.mouse.setPower(0);

        // Update camera
        this.camera.handleInput(tickDelta);
        this.camera.update(tickDelta);

        // Update player
        this.player.update(tickDelta);

        // Update game systems
        this.collisionSystem.updatePlayer(this.player);
        this.entityManager.update(tickDelta);
        
        const miningTarget = this.miningSystem.getTarget();
        this.highlightSystem.update(miningTarget);
        
        const highlightedTile = this.highlightSystem.getTile();
        this.miningSystem.update(tickDelta, highlightedTile);

        // Handle torch placement
        this._handleTorchInput();

        // Update lighting
        this.lightingSystem.update();

        // Generate chunks around player
        const worldX = this.player.pos.x;
        const worldY = this.player.pos.y;
        this.chunkManager.generateChunksAround(worldX, worldY, 1);
    }

    _handleTorchInput() {
        if (this.keys.pressed && this.keys.pressed('t') && this.player && this.noiseTileSize) {
            const px = this.player.pos.x + this.player.size.x * 0.5;
            const py = this.player.pos.y + this.player.size.y * 0.5;
            const sx = Math.floor(px / this.noiseTileSize);
            const sy = Math.floor(py / this.noiseTileSize);
            this.lightingSystem.toggleTorch(sx, sy);
        }
    }

    // Legacy accessor for Slime compatibility
    _getTileValue(sx, sy) {
        return this.chunkManager.getTileValue(sx, sy);
    }

    draw() {
        if (!this.isReady) return;

        // Background
        this.Draw.background('#000000');
        this.Draw.useCtx('base');

        // Apply camera transform
        this.camera.applyTransform();

        // Draw tiles
        this._drawTiles();

        // Draw torches
        this._drawTorches();

        // Draw tile highlight
        this._drawHighlight();

        // Draw mining progress
        this._drawMiningProgress();

        // Draw entities and player
        if (this.entityManager) {
            this.entityManager.drawEntities();
        }
        if (this.player && typeof this.player.draw === 'function') {
            this.player.draw(new Vector(0, 0));
        }

        this.camera.popTransform();
    }

    _drawTiles() {
        const ts = this.noiseTileSize;
        const chunks = this.chunkManager.getChunks();

        for (const [key, chunk] of chunks) {
            const cx = chunk.x;
            const cy = chunk.y;
            const w = chunk.width;
            const h = chunk.height;
            const baseX = cx * this.chunkManager.chunkSize * ts;
            const baseY = cy * this.chunkManager.chunkSize * ts;

            for (let yy = 0; yy < h; yy++) {
                for (let xx = 0; xx < w; xx++) {
                    const sx = cx * this.chunkManager.chunkSize + xx;
                    const sy = cy * this.chunkManager.chunkSize + yy;
                    const tile = this.chunkManager.getTileValue(sx, sy);
                    
                    if (!tile) continue;

                    const pos = new Vector(baseX + xx * ts, baseY + yy * ts);
                    const brightness = this.lightingSystem.getBrightness(sx, sy);

                    if (tile.type === 'solid') {
                        const color = LightingSystem.modulateColor('#555555', brightness);
                        this.Draw.rect(pos, new Vector(ts, ts), color);
                    } else if (tile.type === 'ladder') {
                        const baseColor = LightingSystem.modulateColor('#6b4f2b', brightness);
                        const rungColor = LightingSystem.modulateColor('#caa97a', brightness);
                        this.Draw.rect(pos, new Vector(ts, ts), baseColor);
                        
                        const rungCount = Math.max(2, Math.floor(ts / 6));
                        for (let r = 0; r < rungCount; r++) {
                            const ry = pos.y + (r + 1) * (ts / (rungCount + 1));
                            this.Draw.line(
                                new Vector(pos.x + ts * 0.15, ry),
                                new Vector(pos.x + ts * 0.85, ry),
                                rungColor,
                                1
                            );
                        }
                    }
                }
            }
        }
    }

    _drawTorches() {
        const ts = this.noiseTileSize;
        const torches = this.lightingSystem.getTorches();

        for (const [key, torch] of torches) {
            const parts = key.split(',');
            if (parts.length < 2) continue;
            
            const sx = parseInt(parts[0], 10);
            const sy = parseInt(parts[1], 10);
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;

            const cx = sx * ts + ts * 0.5;
            const cy = sy * ts + ts * 0.5;

            // Outer glow
            this.Draw.circle(new Vector(cx, cy), ts * 0.45, 'rgba(255,180,80,0.12)', true);
            // Inner flame
            this.Draw.circle(new Vector(cx, cy), ts * 0.22, 'rgba(255,220,100,1.0)', true);
            // Core
            this.Draw.circle(new Vector(cx, cy), ts * 0.08, 'rgba(255,255,255,0.9)', true);
        }
    }

    _drawHighlight() {
        const highlightedTile = this.highlightSystem.getTile();
        if (!highlightedTile) return;

        const ts = this.noiseTileSize;
        const hx = highlightedTile.sx * ts;
        const hy = highlightedTile.sy * ts;
        
        this.Draw.rect(
            new Vector(hx, hy),
            new Vector(ts, ts),
            'rgba(255,255,0,0.25)',
            true,
            true,
            2,
            '#FFFF00'
        );
    }

    _drawMiningProgress() {
        if (!this.miningSystem.isActive() || !this.player) return;

        const target = this.miningSystem.getTarget();
        if (!target) return;

        const ts = this.noiseTileSize;
        const sx = target.sx;
        const sy = target.sy;
        const cx = sx * ts + ts * 0.5;
        const cy = sy * ts + ts * 0.5;
        const progress = this.miningSystem.getProgress();

        // Background circle
        this.Draw.circle(new Vector(cx, cy), ts * 0.4, 'rgba(0,0,0,0.5)', true);
        
        // Progress arc
        const start = -Math.PI / 2;
        const end = start + progress * Math.PI * 2;
        const size = new Vector(ts * 0.8, ts * 0.8);
        this.Draw.arc(new Vector(cx, cy), size, start, end, 'rgba(255,220,80,0.95)', true, false);
        
        // Outline
        this.Draw.circle(new Vector(cx, cy), ts * 0.4, 'rgba(255,255,255,0.25)', false, 2);
    }

    _updateMining(tickDelta) {
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
}
