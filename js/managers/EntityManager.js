import Geometry from '../modules/Geometry.js';
import Vector from '../modules/Vector.js';
import Slime from '../entities/Slime.js';
import Bat from '../entities/Bat.js';
import Moth from '../entities/Moth.js';
import Entity from '../entities/Entity.js';

/**
 * @typedef {import('../systems/LightingSystem.js').default} LightingSystemType
 * @typedef {import('../entities/Entity.js').default} EntityType
 * @typedef {import('../components/Component.js').default} ComponentType
 */

/**
 * EntityManager handles monster/entity spawning, updates, and collision resolution.
 *
 * It keeps a list of active entities, performs proximity-based updates, draws
 * entities via the provided Draw helper, and resolves tile collisions.
 */
export default class EntityManager {
    constructor(chunkManager, draw, spriteImages, options = {}) {
        this.chunkManager = chunkManager;
        this.draw = draw;
        this.noiseTileSize = options.noiseTileSize || 8;
        this.activeRadius = options.activeRadius || 100; // tiles
        
        this.entities = [];
        this.spriteImages = spriteImages
        this.player = null;
        this.lightingSystem = null;
        // Spawning controls
        this._spawnAccumulator = 0;
        this._spawnInterval = options.spawnInterval || 1.0; // seconds between spawn attempts
        this._spawnRadius = options.spawnRadius || 30; // tiles
        this._spawnAttempts = options.spawnAttempts || 6; // tries per interval
        this._maxNearbyEntities = options.maxNearbyEntities || 12; // cap nearby

        this.entityTypes = new Map()

    }
    /**
     * Adds an entity type
     * @param {string} name Name of the entity type
     * @param {EntityType} entity The entity
     */
    addEntityType(name,entity){
        this.entityTypes.set(name,entity)
    }
    /**
     * Adds an entity from entity type
     * @param {string} name 
     * @param {EntityType} entity 
     */
    addEntity(name, pos = null, size = null, options = {}){
        const preset = this.entityTypes.get(name);
        if (!preset) return null;

        const newEntity = preset.clone();
        newEntity.pos = pos.clone();
        newEntity.size = size.clone();

        // Ensure each component knows its manager and perform any zero-arg
        // init() calls (used by components that register with systems
        // via this.manager). We avoid calling init with arguments because
        // some components (eg. SheetComponent) expect different init params.
        for (const c of newEntity.getComponents()) {
            try {
                if (c && !c.manager) c.manager = this;
                if (c && typeof c.init === 'function' && c.init.length === 0) {
                    try { c.init(); } catch (e) { /* ignore init errors */ }
                }
            } catch (e) { /* ignore per-component errors */ }
        }

        this.entities.push(newEntity);
        return newEntity;
    }


    /**
     * Set the player reference
     * @param {Object} player - Player sprite
     */
    setPlayer(player) {
        this.player = player;
    }

    /**
     * Set lighting system reference so entity rendering can query nearby torches.
     * @param {LightingSystemType} ls
     */
    setLightingSystem(ls) {
        this.lightingSystem = ls;
        // Re-init components so those that failed to register earlier (because
        // lighting wasn't available) can now register with the lighting system.
        try {
            for (const entity of this.entities) {
                if (!entity || !Array.isArray(entity.components)) continue;
                for (const c of entity.components) {
                    try {
                        if (c && typeof c.init === 'function') c.init(entity, this);
                    } catch (e) { /* ignore per-component init errors */ }
                }
            }
        } catch (e) { /* ignore */ }
    }

    /**
     * Remove an entity from the manager
     * @param {Object} entity - Entity sprite
     */
    removeEntity(entity) {
        const index = this.entities.indexOf(entity);
        if (index !== -1 && entity) {
            // destroy components
            if (entity) {
                entity.getComponents().forEach((c) => {
                    if(typeof c.destroy === 'function') c.destroy();
                });
            }
            this.entities.splice(index, 1);
        }
    }

    /**
     * Get all entities
     * @returns {Array} Entity array
     */
    getEntities() {
        return this.entities;
    }

    /**
     * Get enemy entities within a tile-radius around a sample coordinate.
     * - If `opts.predicate` is provided it is used to test entities.
     * - Otherwise entities are considered enemies when `isEnemy` or `hostile`
     *   is truthy, or when they have a `team` that is not `'player'`.
     *
     * @param {Object} center - Radius Center
     * @param {number} rangeTiles - radius in tiles
     * @param {Function} pred - function to call on entities in range
     * @returns {Array} Filtered list of entities considered enemies
     */
    getEnemiesInRange(center, rangeTiles, pred) {
        const out = [];
        const radiusTiles = Math.max(0, Number(rangeTiles) || 0);
        const maxDist = radiusTiles * this.noiseTileSize;

        // Accept either a Vector-like object or fallback to {x:0,y:0}
        const tx = center.x;
        const ty = center.y;

        for (const e of this.entities) {
            if (!e || !e.pos) continue;
            const ex = (e.pos.x || 0) + ((e.size && e.size.x) ? e.size.x * 0.5 : 0);
            const ey = (e.pos.y || 0) + ((e.size && e.size.y) ? e.size.y * 0.5 : 0);
            const dist = Math.hypot(tx - ex, ty - ey);
            if (dist <= maxDist) out.push(e);
            else continue;
            try {pred(e)} catch (e) {}
            
        }
        
        return out;
    }

    /**
     * Update all entities
     * @param {number} delta - Time delta in seconds
     */
    update(delta) {
        if (!this.player) return;

        const maxDist = this.noiseTileSize * this.activeRadius;
        const px = this.player.pos.x + this.player.size.x * 0.5;
        const py = this.player.pos.y + this.player.size.y * 0.5;

        for (const entity of this.entities) {
            const ex = entity.pos.x + entity.size.x * 0.5;
            const ey = entity.pos.y + entity.size.y * 0.5;
            const dist = Math.hypot(px - ex, py - ey);

            // Only update entities within active radius
            if (dist <= maxDist) {
                entity.update(delta);
                this.resolveCollisions(entity);
            }
        }
        // Clean up dead entities after the update pass so removals don't
        // interfere with the active iteration above.
        this.killEntities();

        // Attempt natural spawning in nearby caves/low-light areas
        //try { this.spawnMonsters(delta); } catch (e) { /* ignore spawn errors */ }
    }

    /**
     * Draw all active entities
     */
    drawEntities() {
        if (!this.player) return;
        
        const maxDist = this.noiseTileSize * this.activeRadius;
        const px = this.player.pos.x + this.player.size.x * 0.5;
        const py = this.player.pos.y + this.player.size.y * 0.5;
        
        for (const entity of this.entities) {
            try {
                const ex = entity.pos.x + entity.size.x * 0.5;
                const ey = entity.pos.y + entity.size.y * 0.5;
                const dist = Math.hypot(px - ex, py - ey);
                
                if (dist <= maxDist && typeof entity.draw === 'function') {
                    // If a lighting system is available, compute per-entity brightness
                    try {
                        if (this.lightingSystem && typeof this.lightingSystem.getBrightnessForWorld === 'function') {
                            const brightness = this.lightingSystem.getBrightnessForWorld(ex, ey, this.noiseTileSize);
                            try { this.draw.setBrightness(brightness); } catch (e) {}
                            entity.draw(new Vector(0, 0));
                            try { this.draw.setBrightness(1); } catch (e) {}
                            continue;
                        }
                    } catch (e) {
                        // fall back to default draw
                    }
                    entity.draw(new Vector(0, 0));
                }
            } catch (e) {
                console.warn('Entity draw failed', e);
            }
        }
    }    /**
     * Resolve collisions for a sprite against the tile world
     * @param {Object} sprite - Sprite to resolve collisions for
     */
    /**
     * Remove entities whose `health` is <= 0. Calls an entity's `destroy`
     * method if present before removing it from the manager.
     */
    killEntities() {
        for (let i = this.entities.length - 1; i >= 0; i--) {
            const e = this.entities[i];
            if (!e) continue;
            const hp = e.health;
            if (hp <= 0) {
                e.defeat();
                if(e.dead){
                    this.entities.splice(i, 1);
                }
            }
        }
    }
    
    /**
     * Attempt to spawn monsters naturally near the player, preferring dark
     * or cave-like tiles. Called periodically from `update`.
     * @param {number} delta - seconds
     */
    spawnMonsters(delta) {
        if (!this.player || !this.chunkManager) return;
        this._spawnAccumulator += delta;
        if (this._spawnAccumulator < this._spawnInterval) return;
        this._spawnAccumulator = 0;

        const ts = this.noiseTileSize || 16;
        // Player sample/tile coordinates
        const px = Math.floor((this.player.pos.x + this.player.size.x * 0.5) / ts);
        const py = Math.floor((this.player.pos.y + this.player.size.y * 0.5) / ts);

        // Count nearby entities to avoid overcrowding
        let nearbyCount = 0;
        for (const e of this.entities) {
            if (!e || !e.pos) continue;
            const ex = Math.floor((e.pos.x + (e.size?e.size.x*0.5:0)) / ts);
            const ey = Math.floor((e.pos.y + (e.size?e.size.y*0.5:0)) / ts);
            const d = Math.hypot((ex - px), (ey - py));
            if (d <= 8) nearbyCount++;
        }
        if (nearbyCount >= this._maxNearbyEntities) return;

        // Try a few candidate tiles and spawn one if suitable
        for (let attempt = 0; attempt < this._spawnAttempts; attempt++) {
            const rx = Math.floor((Math.random() * 2 - 1) * this._spawnRadius) + px;
            const ry = Math.floor((Math.random() * 2 - 1) * this._spawnRadius) + py;

            // Only spawn below a small depth (avoid surface) and within generated area
            if (ry < 4) continue;

            // Tile must be empty (air)
            const tile = this.chunkManager.getTileValue(rx, ry);
            if (tile && tile.id) continue;

            // Prefer locations adjacent to solid tiles (cave edges)
            let adjSolid = 0;
            for (let oy = -1; oy <= 1; oy++) {
                for (let ox = -1; ox <= 1; ox++) {
                    if (ox === 0 && oy === 0) continue;
                    const t = this.chunkManager.getTileValue(rx + ox, ry + oy);
                    if (t && t.type === 'solid') adjSolid++;
                }
            }
            if (adjSolid === 0) continue;

            // If lighting system present, ensure location is dark enough
            if (this.lightingSystem && typeof this.lightingSystem.getBrightnessForWorld === 'function') {
                const wx = rx * ts + ts * 0.5;
                const wy = ry * ts + ts * 0.5;
                const bright = this.lightingSystem.getBrightnessForWorld(wx, wy, ts);
                if (bright > 0.3) continue; // too bright to spawn
            }

            // Ensure no entity already very close
            let collision = false;
            for (const e of this.entities) {
                if (!e || !e.pos) continue;
                const ex = (e.pos.x || 0) + ((e.size && e.size.x) ? e.size.x * 0.5 : 0);
                const ey = (e.pos.y || 0) + ((e.size && e.size.y) ? e.size.y * 0.5 : 0);
                const wx = rx * ts + ts * 0.5;
                const wy = ry * ts + ts * 0.5;
                const dist = Math.hypot(wx - ex, wy - ey);
                if (dist < ts * 0.8) { collision = true; break; }
            }
            if (collision) continue;

            // Choose monster type by simple weighting
            const r = Math.random();
            let ent = null;
            const worldPos = new Vector(rx * ts, ry * ts);
            const size = new Vector(ts, ts);
            try {
                if (r < 0.5) {
                    const sheet = (this.SpriteImages && this.SpriteImages.get) ? this.SpriteImages.get('slime') : null;
                    ent = new Slime(this.draw, worldPos, size, sheet, { scene: this.player && this.player.scene ? this.player.scene : null });
                } else if (r < 0.8) {
                    const sheet = (this.SpriteImages && this.SpriteImages.get) ? this.SpriteImages.get('bat') : null;
                    ent = new Bat(this.draw, worldPos, size, sheet, { scene: this.player && this.player.scene ? this.player.scene : null });
                } else {
                    const sheet = (this.SpriteImages && this.SpriteImages.get) ? this.SpriteImages.get('moth') : null;
                    ent = new Moth(this.draw, worldPos, size, sheet, { scene: this.player && this.player.scene ? this.player.scene : null });
                }
            } catch (e) {
                // If instantiation fails, skip
                continue;
            }

            if (ent) {
                this.addEntity(ent);
                break; // spawn only one per interval
            }
        }
    }
    resolveCollisions(sprite) {
        if (!sprite || !sprite.pos || !this.noiseTileSize) return;

        const prevPos = sprite.pos.clone();
        const size = sprite.size.clone();
        const radius = 3;
        const sampleX = Math.floor(prevPos.x / this.noiseTileSize);
        const sampleY = Math.floor(prevPos.y / this.noiseTileSize);
        const tileSizeVec = new Vector(this.noiseTileSize, this.noiseTileSize);
        let collidedBottom = false;

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const sx = sampleX + dx;
                const sy = sampleY + dy;
                const tile = this.chunkManager.getTileValue(sx, sy);
                const isSolid = tile && tile.type === 'solid';
                
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
}
