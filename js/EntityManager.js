import Vector from './Vector.js';
import Geometry from './Geometry.js';

/**
 * EntityManager handles monster/entity spawning, updates, and collision resolution.
 */
export default class EntityManager {
    constructor(chunkManager, draw, options = {}) {
        this.chunkManager = chunkManager;
        this.draw = draw;
        this.noiseTileSize = options.noiseTileSize || 8;
        this.activeRadius = options.activeRadius || 32; // tiles
        
        this.entities = [];
        this.player = null;
        this.lightingSystem = null;
    }

    /**
     * Set the player reference
     * @param {Object} player - Player sprite
     */
    setPlayer(player) {
        this.player = player;
    }

    /**
     * Add an entity to the manager
     * @param {Object} entity - Entity sprite
     */
    addEntity(entity) {
        this.entities.push(entity);
        // initialize components if present
        if (entity && Array.isArray(entity.components)) {
            for (const c of entity.components) {
                try {
                    if (c && typeof c.init === 'function') c.init(entity, this);
                } catch (e) { console.warn('Entity component init failed', e); }
            }
        }
    }

    /**
     * Set lighting system reference so entity rendering can query nearby torches.
     * @param {LightingSystem} ls
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
        if (index !== -1) {
            // destroy components
            if (entity && Array.isArray(entity.components)) {
                for (const c of entity.components) {
                    try { if (c && typeof c.destroy === 'function') c.destroy(); } catch (e) { /* ignore */ }
                }
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
     * Update all entities
     * @param {number} delta - Time delta in seconds
     */
    update(delta) {
        if (!this.player) return;

        const maxDist = this.noiseTileSize * this.activeRadius;
        const px = this.player.pos.x + this.player.size.x * 0.5;
        const py = this.player.pos.y + this.player.size.y * 0.5;

        for (const entity of this.entities) {
            try {
                const ex = entity.pos.x + entity.size.x * 0.5;
                const ey = entity.pos.y + entity.size.y * 0.5;
                const dist = Math.hypot(px - ex, py - ey);

                // Only update entities within active radius
                if (dist <= maxDist) {
                    // Call the entity's update first (applies friction, animations,
                    // and integrates existing velocity), then run component updates.
                    if (typeof entity.update === 'function') {
                        entity.update(delta);
                    }
                    // update components after entity update so they can set new
                    // velocities and optionally perform immediate one-time
                    // position integration (matching original sprite behavior).
                    if (entity && Array.isArray(entity.components)) {
                        for (const c of entity.components) {
                            try { if (c && typeof c.update === 'function') c.update(delta); } catch (e) { console.warn('Entity component update failed', e); }
                        }
                    }
                    this.resolveCollisions(entity);
                }
            } catch (e) {
                console.warn('Entity update failed', e);
            }
        }
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
