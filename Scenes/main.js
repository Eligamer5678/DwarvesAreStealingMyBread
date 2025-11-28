import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import Camera from '../js/Camera.js';
import SpriteSheet from '../js/Spritesheet.js';
import Dwarf from '../js/sprites/Dwarf.js';
import Slime from '../js/sprites/Slime.js';
import Moth from '../js/sprites/Moth.js';
import Bat from '../js/sprites/Bat.js';
import ChunkManager from '../js/ChunkManager.js';
import LightingSystem from '../js/LightingSystem.js';
import MiningSystem from '../js/MiningSystem.js';
import EntityManager from '../js/EntityManager.js';
import CollisionSystem from '../js/CollisionSystem.js';
import MainUI from '../js/UI/MainUI.js';

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
            dwarfSheet.addAnimation('idle', 5, 1, 8);
            dwarfSheet.addAnimation('walk', 1, 5, 8);
            dwarfSheet.addAnimation('mine', 4, 5, 24);
            dwarfSheet.addAnimation('hold_pick', 6, 1, 8);
            dwarfSheet.addAnimation('walk_and_hold_pick', 7, 5, 8);
            dwarfSheet.addAnimation('walk_and_hold_pick_as_sheild', 8, 5, 8);
            dwarfSheet.addAnimation('look', 1, 5, 8);
            dwarfSheet.addAnimation('point', 0, 3, 8);
            dwarfSheet.addAnimation('walk_and_point', 2, 5, 8);
            dwarfSheet.playAnimation('idle')
            this.SpriteImages.set('dwarf', dwarfSheet);

            // Load slime spritesheet
            try {
                const slimeImg = await this._loadImage('Assets/Sprites/slime.png', 'slime');
                const slimeSheet = new SpriteSheet(slimeImg, 16);
                slimeSheet.addAnimation('idle', 0, 2, 8);
                slimeSheet.addAnimation('walk', 0, 2, 8);
                slimeSheet.addAnimation('defeat', 1, 6, 8);
                slimeSheet.addAnimation('attack', 2, 8,8,0,'swapTo','walk');
                this.SpriteImages.set('slime', slimeSheet);
            } catch (e) {
                console.warn('Failed to load slime spritesheet', e);
            }
            // Load moth spritesheet
            try {
                const mothImg = await this._loadImage('Assets/Sprites/moth.png', 'moth');
                const mothSheet = new SpriteSheet(mothImg, 16);
                // row0: fly (6 frames), row1: defeat (8 frames)
                mothSheet.addAnimation('idle', 0, 6, 32);
                mothSheet.addAnimation('fly', 0, 6, 32);
                mothSheet.addAnimation('defeat', 1, 8, 8);
                this.SpriteImages.set('moth', mothSheet);
            } catch (e) {
                console.warn('Failed to load moth spritesheet', e);
            }
            try {
                const batImg = await this._loadImage('Assets/Sprites/bat.png', 'bat');
                const batSheet = new SpriteSheet(batImg, 16);
                // row0: fly (6 frames), row1: defeat (8 frames)
                batSheet.addAnimation('fly', 0, 7, 32);
                batSheet.addAnimation('defeat', 1, 11, 8);
                this.SpriteImages.set('bat', batSheet);
            } catch (e) {
                console.warn('Failed to load bat spritesheet', e);
            }

            // Load ores tilesheet (64x64, 16px slices)
            try {
                const oresImg = await this._loadImage('Assets/Tilemaps/ores.png', 'ores');
                // store raw image; ChunkManager will attach it to its TileSheet
                this.SpriteImages.set('ores', oresImg);
            } catch (e) {
                console.warn('Failed to load ores tilesheet', e);
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
        this.debugBatPaths = true;

        // Initialize systems
        this._initializeChunkSystem();
        // Ensure player is not embedded in solid tiles for some seeds
        this._ensurePlayerSpawn();
        this._initializeLightingSystem();
        this._initializeMiningSystem();
        // Highlighting is handled by MiningSystem now
        this._initializeCollisionSystem();
        this._initializeEntitySystem();
        this._initializeCamera();

        // Create Main UI
        this.mainUI = new MainUI(this.Draw,this.mouse,this.keys,this.player); 
        

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
        // If we preloaded an ores image, attach it to the oreTileSheet so ores can be rendered
        try {
            const oresImg = (this.SpriteImages && this.SpriteImages.get) ? this.SpriteImages.get('ores') : null;
            if (oresImg && this.chunkManager && this.chunkManager.oreTileSheet) {
                this.chunkManager.oreTileSheet.sheet = oresImg;
                // ensure slicePx matches the image slice (16)
                this.chunkManager.oreTileSheet.slicePx = this.chunkManager.noiseOptions.oreSlicePx || 16;
            }
        } catch (e) { /* ignore */ }
    }

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
            ambientMin: 0.0
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
        // provide lighting system to entity manager for per-sprite lighting
        try { if (this.lightingSystem) this.entityManager.setLightingSystem(this.lightingSystem); } catch (e) {}
        this.entityManager.setPlayer(this.player);

        // Spawn slimes
        this._spawnSlimes();
        // Spawn moths
        this._spawnMoths();
        // Spawn bats
        this._spawnBats();
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

            const spawnCount = 10;
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
                        slimeSheet.connect(),
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
                    const slime = new Slime(this.Draw, new Vector(sx, sy), new Vector(sz, sz), slimeSheet.connect(), { scene: this });
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

            const spawnCount = 10;
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
                    const moth = new Moth(this.Draw, new Vector(sx, sy), new Vector(sz, sz), mothSheet.connect(), { scene: this });
                    this.entityManager.addEntity(moth);
                    placed = true;
                    break;
                }
                if (!placed) {
                    const sx = playerCenter.x + (Math.random()*60-30);
                    const sy = playerCenter.y - (ts * 3 + Math.random()*40);
                    const sz = Math.max(12, Math.min(32, Math.random() * 20 + 12));
                    const moth = new Moth(this.Draw, new Vector(sx, sy), new Vector(sz, sz), mothSheet.connect(), { scene: this });
                    this.entityManager.addEntity(moth);
                }
            }
        } catch (e) {
            console.warn('Failed to spawn moths', e);
        }
    }

    _spawnBats() {
        try {
            const batSheet = this.SpriteImages.get('bat');
            if (!batSheet) {
                console.warn('No bat spritesheet available; skipping bat spawn.');
                return;
            }

            const spawnCount = 10;
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
                    const sz = Math.max(12, Math.min(24, Math.random() * 10 + 14));
                    const bat = new Bat(this.Draw, new Vector(sx, sy), new Vector(sz, sz), batSheet.connect(), { scene: this });
                    this.entityManager.addEntity(bat);
                    placed = true;
                    break;
                }
                if (!placed) {
                    const sx = playerCenter.x + (Math.random()*60-30);
                    const sy = playerCenter.y - (ts * 3 + Math.random()*40);
                    const sz = Math.max(12, Math.min(24, Math.random() * 10 + 14));
                    const bat = new Bat(this.Draw, new Vector(sx, sy), new Vector(sz, sz), batSheet.connect(), { scene: this });
                    this.entityManager.addEntity(bat);
                }
            }
        } catch (e) {
            console.warn('Failed to spawn bats', e);
        }
    }

    sceneTick(tickDelta) {
        // Update input systems
        this.mouse.update(tickDelta);
        this.keys.update(tickDelta);
        // Reset mouse mask and set default input power for this tick.
        // Per UI input rules: always call setMask(0) and setPower(1) at start of input handling
        // so UI layers can addMask(1) when hovered and the mouse._allowed() check works as
        // "power >= mask" (penetration depth semantics).
        this.mouse.setMask(0);
        this.mouse.setPower(1);

        // Update camera
        this.camera.handleInput(tickDelta);
        this.camera.update(tickDelta);

        // Update player
        this.player.update(tickDelta);

        // Update game systems
        this.collisionSystem.updatePlayer(this.player);
        this.entityManager.update(tickDelta);
        
        // MiningSystem now manages highlighting internally
        this.miningSystem.update(tickDelta);

        // Handle torch placement
        this._handleTorchInput();

        // Update lighting
        this.lightingSystem.update();

        // Generate chunks around player
        const worldX = this.player.pos.x;
        const worldY = this.player.pos.y;
        this.chunkManager.generateChunksAround(worldX, worldY, 1);

        // Update UI
        this.mainUI.update(tickDelta);
        // Update height text
        let htxt = this.mainUI.menu.elements.get('heightText2')
        htxt.useText(Math.round(-this.player.pos.y/this.noiseTileSize))
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

        // Draw highlight and mining progress (handled by MiningSystem)
        if (this.miningSystem && typeof this.miningSystem.draw === 'function') {
            this.miningSystem.draw(this.Draw);
        }

        // Draw entities and player
        if (this.entityManager) {
            this.entityManager.drawEntities();
        }
        if (this.player && typeof this.player.draw === 'function') {
            try {
                if (this.lightingSystem && typeof this.lightingSystem.getBrightnessForWorld === 'function') {
                    const px = this.player.pos.x + this.player.size.x * 0.5;
                    const py = this.player.pos.y + this.player.size.y * 0.5;
                    // Make player slightly brighter than entities so the player is easier to see
                    const rawB = this.lightingSystem.getBrightnessForWorld(px, py, this.noiseTileSize);
                    const b = Math.min(1, rawB * 2);
                    try { this.Draw.setBrightness(b); } catch (e) {}
                    this.player.draw(new Vector(0, 0));
                    try { this.Draw.setBrightness(1); } catch (e) {}
                    // skip default draw
                } else {
                    this.player.draw(new Vector(0, 0));
                }
            } catch (e) {
                // fallback
                this.player.draw(new Vector(0, 0));
            }
        }

        this.camera.popTransform();

        // Draw screen-space UI
        this.UIDraw.clear();
        this.mainUI.draw();
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
                        // If this solid tile contains ore metadata and an ores tilesheet is available,
                        // draw the ore sprite from the tilesheet. Otherwise fall back to a shaded rect.
                        const oreMeta = tile.ore;
                        const oreSheet = this.chunkManager && this.chunkManager.oreTileSheet ? this.chunkManager.oreTileSheet : null;
                        if (oreMeta && oreSheet && oreSheet.sheet) {
                            const tsSlice = oreSheet.slicePx || 16;
                            const tileInfo = oreSheet.getTile(oreMeta.tileKey);
                            if (tileInfo && typeof tileInfo.col !== 'undefined') {
                                // If brightness is below the ore reveal threshold, mask ore as stone
                                const oreThreshold = (this.lightingSystem && typeof this.lightingSystem.oreRevealThreshold === 'number')
                                    ? this.lightingSystem.oreRevealThreshold
                                    : (this.lightingSystem.ambientMin + 0.05);
                                const oreVisible = (brightness >= oreThreshold);
                                if (oreVisible) {
                                    try {
                                        this.Draw.setBrightness(brightness);
                                        this.Draw.tile(oreSheet, pos, new Vector(ts, ts), oreMeta.tileKey, 0, null, 1, false);
                                        continue; // skip default rect draw
                                    } catch (e) {
                                        // fallthrough to rect fallback
                                    } finally {
                                        try { this.Draw.setBrightness(1); } catch (e) {}
                                    }
                                }
                            }
                        }

                        // Draw as stone (mask ore) when ore not visible
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
    // Mining progress drawing moved to MiningSystem.draw
}
