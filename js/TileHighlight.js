import Vector from './Vector.js';

/**
 * TileHighlight manages cursor/selector position based on player state and input.
 */
export default class TileHighlight {
    constructor(chunkManager, keys, options = {}) {
        this.chunkManager = chunkManager;
        this.keys = keys;
        this.player = null;
        this.noiseTileSize = options.noiseTileSize || 8;
        
        this.highlightedTile = null; // { sx, sy }
    }

    /**
     * Set the player reference
     * @param {Object} player - Player sprite
     */
    setPlayer(player) {
        this.player = player;
    }

    /**
     * Update highlighted tile based on player position and input
     * @param {Object|null} lockedTarget - Optional locked mining target {sx, sy}
     */
    update(lockedTarget = null) {
        // If mining is locked, keep that tile highlighted
        if (lockedTarget) {
            this.highlightedTile = { sx: lockedTarget.sx, sy: lockedTarget.sy };
            return;
        }

        if (!this.player || !this.noiseTileSize) {
            this.highlightedTile = null;
            return;
        }

        const input = this.player.inputDir || new Vector(0, 0);
        const ix = input.x || 0;
        const iy = input.y || 0;
        const holdUp = (iy < -0.5) || this.keys.held('ArrowUp');

        let sx, sy;

        if (holdUp) {
            // Highlight tile above player's head
            const centerX = this.player.pos.x + this.player.size.x * 0.5;
            const headY = this.player.pos.y - 10;
            sx = Math.floor(centerX / this.noiseTileSize);
            sy = Math.floor(headY / this.noiseTileSize);
        } else {
            // Highlight tile in front of player (horizontal)
            const centerY = this.player.pos.y + this.player.size.y * 0.5;
            const dir = this._getFacingDirection(ix);
            const frontX = this.player.pos.x + this.player.size.x * 0.5 + dir * (this.player.size.x * 0.6);
            sx = Math.floor(frontX / this.noiseTileSize);
            sy = Math.floor(centerY / this.noiseTileSize);
        }

        // Only highlight if there's actually a block
        const tile = this.chunkManager.getTileValue(sx, sy);
        const hasBlock = tile && (tile.type === 'solid' || tile.type === 'ladder');

        this.highlightedTile = hasBlock ? { sx, sy } : null;
    }

    /**
     * Get currently highlighted tile
     * @returns {Object|null} {sx, sy} or null
     */
    getTile() {
        return this.highlightedTile;
    }

    // --- Private methods ---

    _getFacingDirection(inputX) {
        const holdLeft = inputX < -0.5;
        const holdRight = inputX > 0.5;

        if (holdLeft) return -1;
        if (holdRight) return 1;

        // Fallback to sprite facing
        if (this.player.invert) {
            if (typeof this.player.invert.x === 'number') return this.player.invert.x;
            if (typeof this.player.invert === 'number') return this.player.invert;
        }

        return 1;
    }
}
