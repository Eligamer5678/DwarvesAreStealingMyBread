import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import MainUI from '../js/UI/MainUI.js';
import Camera from '../js/Camera.js';
import ChunkManager from '../js/ChunkManager.js';
import Dwarf from '../js/sprites/Dwarf.js';
import CollisionSystem from '../js/CollisionSystem.js';
import LightingSystem from '../js/LightingSystem.js';
import EntityManager from '../js/EntityManager.js';
import Torch from '../js/entities/Torch.js';
import Slime from '../js/entities/Slime.js';
import Bat from '../js/entities/Bat.js';
import Moth from '../js/entities/Moth.js';

export class MainScene extends Scene {
    constructor(...args) {
        super('main', ...args);
        this.loaded = 0;
        this.elements = new Map();
        this.isPreloaded = false;
        this.isReady = false;
    }

    /**
     * Preload assets. The new component/asset loader will wire JSON driven assets
     * into this.SpriteImages; keep a permissive loader so we can attach resources
     * from the JSON loader when ready.
     */
    async onPreload(resources = null) {
        try {
            if (!this.SpriteImages) this.SpriteImages = new Map();
            if (resources && resources instanceof Map) {
                for (const [k, v] of resources) this.SpriteImages.set(k, v);
            } else {
                // If no resources provided, try to load textures.json via AssetManager
                try {
                    // lazy import to avoid loading during tests
                    const AM = await import('../js/AssetManager.js');
                    const loaded = await AM.loadTexturesJSON('/data/textures.json');
                    if (loaded && loaded.tilemaps) {
                        for (const [k, v] of loaded.tilemaps) this.SpriteImages.set(k, v);
                    }
                    if (loaded && loaded.sprites) {
                        for (const [k, v] of loaded.sprites) this.SpriteImages.set(k, v);
                    }
                    if (loaded && loaded.blocks) {
                        // expose block registry for downstream systems
                        this.SpriteImages.set('blocks', loaded.blocks);
                    }
                } catch (e) {
                    // fail silently; resources can be provided elsewhere
                    console.warn('MainScene: AssetManager load failed', e);
                }
            }

            // Initialize chunk manager and load generation/chunk/block definitions
            try {
                this.chunkManager = new ChunkManager();
                await this.chunkManager.loadDefinitions('/data');
                
                // If AssetManager provided a blocks map, prefer that as blockDefs
                try {
                    if (this.SpriteImages && this.SpriteImages.has && this.SpriteImages.has('blocks')) {
                        const bmap = this.SpriteImages.get('blocks');
                        if (bmap && bmap instanceof Map) this.chunkManager.blockDefs = bmap;
                    }
                } catch (e) { /* ignore */ }
            } catch (e) {
                console.warn('MainScene: chunk manager init failed', e);
            }

            // Defer player/entity initialization to the new component system
            this.isPreloaded = true;
            return true;
        } catch (err) {
            console.error('MainScene preload failed:', err);
            return false;
        }
    }

    onReady() {
        if (this.isReady) return;

        // Initialize minimal UI. Subsystems (entities, blocks, rendering)
        // will be registered by the new component-based engine.
        this.mainUI = new MainUI(this.Draw, this.mouse, this.keys, null);

        // Create a camera for world rendering
        this.camera = new Camera(this.Draw, this.mouse);

        // Prime initial chunks around origin
        if (this.chunkManager) this.chunkManager.generateChunksAround(0, 0, 2);

        // Create player and attach to camera
        try {
            const dwarfSheet = (this.SpriteImages && this.SpriteImages.get) ? this.SpriteImages.get('dwarf') : null;
            const tilePx = (this.chunkManager && this.chunkManager.noiseTileSize) ? this.chunkManager.noiseTileSize : 16;
            const startPos = new Vector(tilePx * 2, tilePx * 2);
            const size = new Vector(tilePx, tilePx);
            this.player = new Dwarf(this.keys, this.Draw, startPos, size, dwarfSheet, { type: 'platformer', chunkManager: this.chunkManager, scene: this });
            // simple fallback so player remains visible while collisions aren't implemented
            this.player.onGround = 1;
            if (this.camera && typeof this.camera.track === 'function') this.camera.track(this.player, { offset: new Vector(0,0) });

            // ensure generation around player's start position
            if (this.chunkManager && typeof this.chunkManager.generateChunksAround === 'function') {
                this.chunkManager.generateChunksAround(this.player.pos.x, this.player.pos.y, 3);
            }

            
            // Create collision system and wire it to use the chunk manager's tile size
            try {
                this.collision = new CollisionSystem(this.chunkManager, { noiseTileSize: this.chunkManager.noiseTileSize });
            } catch (e) { console.warn('Failed to create CollisionSystem', e); }
            // Create entity manager and wire lighting
            try {
                this.entityManager = new EntityManager(this.chunkManager, this.Draw, { noiseTileSize: this.chunkManager.noiseTileSize });
                this.entityManager.setPlayer(this.player);
                if (this.lighting) this.entityManager.setLightingSystem(this.lighting);
                // expose loaded sprite images so components can resolve sheets
                try { this.entityManager.SpriteImages = this.SpriteImages; } catch (e) {}
                // debug list for spawned torches
                this._debugTorches = [];
                
            } catch (e) { console.warn('Failed to create EntityManager', e); }
            // Create lighting system and set initial options
            try {
                this.lighting = new LightingSystem(this.chunkManager, {});
                // Force initial compute
                this.lighting.markDirty();
                this.lighting.update();
                // If an entity manager already exists, wire it to the lighting system
                if (this.entityManager) this.entityManager.setLightingSystem(this.lighting);
                // Connect chunk modifications to lighting so edits (mine/build) mark lighting dirty
                try {
                    if (this.chunkManager && this.chunkManager.onTileModified && typeof this.chunkManager.onTileModified.connect === 'function') {
                        this.chunkManager.onTileModified.connect((sx, sy, val) => { try { if (this.lighting && typeof this.lighting.markDirty === 'function') this.lighting.markDirty(); } catch (e) {} });
                    }
                } catch (e) { /* ignore */ }
                
            } catch (e) { console.warn('Failed to create LightingSystem', e); }
            // Zoom in camera a bunch for close-up view
            try {
                if (this.camera) {
                    // immediate zoom to 3x for clarity
                    this.camera.zoom.x = 10; 
                    this.camera.zoom.y = 10;
                    this.camera.targetZoom.x = 10; 
                    this.camera.targetZoom.y = 10;
                    this.camera.targetOffset = this.camera.targetOffset;
                }
            } catch (e) { /* ignore zoom errors */ }
            // Debug helpers: enable path debug drawing by default for development
            this.debugBatPaths = true;
            this.debugMothPaths = true;
        } catch (e) { console.warn('Failed to create player', e); }

        this.isReady = true;
    }

    sceneTick(tickDelta) {
        // Minimal tick: update input and UI. Full game systems will be added
        // when we wire the new component architecture and JSON loader.
        this.mouse && this.mouse.update && this.mouse.update(tickDelta);
        this.keys && this.keys.update && this.keys.update(tickDelta);
        if (this.mainUI && typeof this.mainUI.update === 'function') this.mainUI.update(tickDelta);
        // Update player
        if (this.player && typeof this.player.update === 'function') this.player.update(tickDelta);
        // Debug: press 't' to spawn an extra torch at the player's tile (multiple allowed)
        try {
            if (this.keys && typeof this.keys.released === 'function' && this.keys.released('t')) {
                try {
                    const px = Math.floor((this.player.pos.x + this.player.size.x * 0.5));
                    const py = Math.floor((this.player.pos.y + this.player.size.y * 0.5));
                    const tileSize = (this.chunkManager && this.chunkManager.noiseTileSize) ? this.chunkManager.noiseTileSize : 16;
                    const sx = Math.floor(px / tileSize);
                    const sy = Math.floor(py / tileSize);
                    const pos = new Vector(sx * tileSize, sy * tileSize);

                    // If a torch already exists at this tile, remove it (toggle behavior)
                    const ls = this.lighting;
                    if (ls && ls.torches && ls.torches.has(`${sx},${sy}`)) {
                        // Remove torch from lighting system
                        try { ls.removeTorch(sx, sy); } catch (e) { /* ignore */ }
                        // Also remove any entity at this tile managed by entityManager
                        try {
                            if (this.entityManager) {
                                const ents = this.entityManager.getEntities();
                                for (let i = ents.length - 1; i >= 0; i--) {
                                    const e = ents[i];
                                    if (!e || !e.pos || !e.size) continue;
                                    const ex = Math.floor((e.pos.x + e.size.x * 0.5) / tileSize);
                                    const ey = Math.floor((e.pos.y + e.size.y * 0.5) / tileSize);
                                    if (ex === sx && ey === sy) {
                                        this.entityManager.removeEntity(e);
                                        // remove from debug list if present
                                        if (this._debugTorches) {
                                            const idx = this._debugTorches.indexOf(e);
                                            if (idx !== -1) this._debugTorches.splice(idx, 1);
                                        }
                                    }
                                }
                            }
                        } catch (e) { /* ignore */ }
                        if (this.lighting && typeof this.lighting.markDirty === 'function') this.lighting.markDirty();
                    } else {
                        // Otherwise spawn a new torch entity
                        const torch = new Torch(this.Draw, pos, new Vector(tileSize, tileSize));
                        if (this.entityManager) this.entityManager.addEntity(torch);
                        if (!this._debugTorches) this._debugTorches = [];
                        this._debugTorches.push(torch);
                        if (this.lighting && typeof this.lighting.markDirty === 'function') this.lighting.markDirty();
                    }
                } catch (e) { console.warn('Torch spawn failed', e); }
            }
        } catch (e) { /* ignore input errors */ }
        // Apply collision resolution (modular, works for any sprite)
        if (this.collision && this.player) {
            try { this.collision.updateSprite(this.player); } catch (e) { console.warn('Collision update failed', e); }
        }
        // Spawn monsters: 1 = Slime, 2 = Bat, 3 = Moth
        try {
            const tileSize = (this.chunkManager && this.chunkManager.noiseTileSize) ? this.chunkManager.noiseTileSize : 16;
            // Slime (1)
            if (this.keys && typeof this.keys.released === 'function' && this.keys.released('1')) {
                try {
                    const sheet = (this.SpriteImages && this.SpriteImages.get) ? this.SpriteImages.get('slime') : null;
                    const pos = new Vector(this.player.pos.x + tileSize * 2, this.player.pos.y);
                    const size = new Vector(tileSize, tileSize);
                    const slime = new Slime(this.Draw, pos, size, sheet, { scene: this });
                    if (this.entityManager) this.entityManager.addEntity(slime);
                } catch (e) { console.warn('Spawn slime failed', e); }
            }
            // Bat (2)
            if (this.keys && typeof this.keys.released === 'function' && this.keys.released('2')) {
                try {
                    const sheet = (this.SpriteImages && this.SpriteImages.get) ? this.SpriteImages.get('bat') : null;
                    const pos = new Vector(this.player.pos.x + tileSize * 2, this.player.pos.y - tileSize);
                    const size = new Vector(tileSize, tileSize);
                    const bat = new Bat(this.Draw, pos, size, sheet, { scene: this });
                    if (this.entityManager) this.entityManager.addEntity(bat);
                } catch (e) { console.warn('Spawn bat failed', e); }
            }
            // Moth (3)
            if (this.keys && typeof this.keys.released === 'function' && this.keys.released('3')) {
                try {
                    const sheet = (this.SpriteImages && this.SpriteImages.get) ? this.SpriteImages.get('moth') : null;
                    const pos = new Vector(this.player.pos.x + tileSize * 2, this.player.pos.y - tileSize);
                    const size = new Vector(tileSize, tileSize);
                    const moth = new Moth(this.Draw, pos, size, sheet, { scene: this });
                    if (this.entityManager) this.entityManager.addEntity(moth);
                } catch (e) { console.warn('Spawn moth failed', e); }
            }
        } catch (e) { /* ignore */ }
        // Toggle debug path drawing with 'b' (bats) and 'm' (moths)
        try {
            if (this.keys && typeof this.keys.released === 'function' && this.keys.released('b')) this.debugBatPaths = !this.debugBatPaths;
            if (this.keys && typeof this.keys.released === 'function' && this.keys.released('m')) this.debugMothPaths = !this.debugMothPaths;
        } catch (e) { /* ignore */ }
        // Update lighting
        if (this.lighting && typeof this.lighting.update === 'function') {
            try { this.lighting.update(); } catch (e) { console.warn('Lighting update failed', e); }
        }
        // Update entities
        if (this.entityManager && typeof this.entityManager.update === 'function') {
            try { this.entityManager.update(tickDelta); } catch (e) { console.warn('EntityManager update failed', e); }
        }
        // Update camera smoothing/keyframes
        if (this.camera && typeof this.camera.update === 'function') this.camera.update(tickDelta);
    }

    draw() {
        if (!this.isReady) return;
        this.Draw && this.Draw.background && this.Draw.background('#000000');
        try {
            this.Draw && this.Draw.useCtx && this.Draw.useCtx('base');

            // World draw: apply camera transform, render chunks, then pop
            if (this.camera && typeof this.camera.applyTransform === 'function') this.camera.applyTransform();
            if (this.chunkManager) this.chunkManager.draw(this.Draw, this.camera, this.SpriteImages, { lighting: this.lighting });
            if (this.camera && typeof this.camera.popTransform === 'function') this.camera.popTransform();
        } catch (e) {
            console.error('MainScene: world draw failed', e);
        }

        // Draw player in world space (after world draw but still under UI)
        if (this.player && typeof this.player.draw === 'function') {
            try {
                if (this.camera && typeof this.camera.applyTransform === 'function') this.camera.applyTransform();

                // If lighting is available, compute brightness at player's world position
                try {
                    if (this.lighting && typeof this.lighting.getBrightnessForWorld === 'function' && this.Draw && typeof this.Draw.setBrightness === 'function') {
                        const px = this.player.pos.x + this.player.size.x * 0.5;
                        const py = this.player.pos.y + this.player.size.y * 0.5;
                        const tileSize = (this.chunkManager && this.chunkManager.noiseTileSize) ? this.chunkManager.noiseTileSize : 16;
                        const brightness = this.lighting.getBrightnessForWorld(px, py, tileSize);
                        // expose brightness to the player for sprite logic
                        try { this.player.brightness = brightness; } catch (e) {}
                        try { this.Draw.setBrightness(brightness*3); } catch (e) { /* ignore */ }
                        this.player.draw(new Vector(0,0));
                        try { this.Draw.setBrightness(1); } catch (e) { /* ignore */ }
                    } else {
                        this.player.draw(new Vector(0,0));
                    }
                } catch (e) {
                    // fallback to default draw on any error
                    this.player.draw(new Vector(0,0));
                }

                // draw entities managed by EntityManager
                if (this.entityManager && typeof this.entityManager.drawEntities === 'function') {
                    try { this.entityManager.drawEntities(); } catch (e) { console.warn('EntityManager draw failed', e); }
                }
                if (this.camera && typeof this.camera.popTransform === 'function') this.camera.popTransform();
            } catch (e) { console.error('MainScene: player draw failed', e); }
        }

        // UI layer
        this.UIDraw && this.UIDraw.clear && this.UIDraw.clear();
        if (this.mainUI && typeof this.mainUI.draw === 'function') this.mainUI.draw();
    }
}


