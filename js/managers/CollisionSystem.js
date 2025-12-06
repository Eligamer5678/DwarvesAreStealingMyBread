import Vector from '../modules/Vector.js';
import Geometry from '../modules/Geometry.js';

/**
 * CollisionSystem handles sprite-to-tile collision resolution and ladder detection.
 */
export default class CollisionSystem {
    constructor(chunkManager, options = {}) {
        this.chunkManager = chunkManager;
        this.noiseTileSize = options.noiseTileSize || 8;
        this.collisionRadius = options.collisionRadius || 3; // tiles to check around sprite
    }

    /**
     * Resolve collisions for a sprite against solid tiles
     * @param {Object} sprite - Sprite with pos, vlos, size properties
     */
    resolveCollisions(sprite) {
        if (!sprite || !sprite.pos) return;

        const prevPos = sprite.pos.clone();
        const size = sprite.size.clone();
        const sampleX = Math.floor(prevPos.x / this.noiseTileSize);
        const sampleY = Math.floor(prevPos.y / this.noiseTileSize);
        const tileSizeVec = new Vector(this.noiseTileSize, this.noiseTileSize);
        let collidedBottom = false;

        // Check tiles around sprite
        for (let dy = -this.collisionRadius; dy <= this.collisionRadius; dy++) {
            for (let dx = -this.collisionRadius; dx <= this.collisionRadius; dx++) {
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
                    sprite.onGround += collidedBottom?1:0;
                }
            }
        }
    }

    /**
     * Detect if sprite is on a ladder
     * @param {Object} sprite - Sprite to check
     * @returns {boolean} True if on ladder
     */
    detectLadder(sprite) {
        if (!sprite || !sprite.pos) return false;

        // Only detect ladders near sprite's horizontal center
        const centerX = sprite.pos.x + sprite.size.x * 0.5;
        const tolerance = this.noiseTileSize * 0.35;
        const minSx = Math.floor((centerX - tolerance) / this.noiseTileSize);
        const maxSx = Math.floor((centerX + tolerance) / this.noiseTileSize);
        const topSample = Math.floor(sprite.pos.y / this.noiseTileSize) - 1;
        const bottomSample = Math.floor((sprite.pos.y + sprite.size.y) / this.noiseTileSize) + 1;
        const tileSizeVec = new Vector(this.noiseTileSize, this.noiseTileSize);

        for (let sy = topSample; sy <= bottomSample; sy++) {
            for (let sx = minSx; sx <= maxSx; sx++) {
                const tile = this.chunkManager.getTileValue(sx, sy);
                if (!tile || tile.type !== 'ladder') continue;

                const tileWorld = new Vector(sx * this.noiseTileSize, sy * this.noiseTileSize);
                const pPos = sprite.pos.clone();
                const pV = sprite.vlos.clone();
                const res = Geometry.spriteToTile(pPos, pV, sprite.size, tileWorld, tileSizeVec, 0);

                if (res && res.collided) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Handle player physics (collisions and ladder detection)
     * @param {Object} player - Player sprite
     */
    updatePlayer(player) {
        if (!player) return;

        // Detect ladder state
        player.onLadder = this.detectLadder(player);

        // Resolve collisions
        this.resolveCollisions(player);
    }

    /**
     * Generic update for any sprite: detect ladders and resolve collisions.
     * This keeps behavior modular so the same system can be applied to
     * non-player entities as well.
     * @param {Object} sprite
     */
    updateSprite(sprite) {
        if (!sprite) return;
        sprite.onLadder = this.detectLadder(sprite);
        this.resolveCollisions(sprite);
    }
}
