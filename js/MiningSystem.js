import Signal from './Signal.js';
import Vector from './Vector.js';

/**
 * MiningSystem handles mining state, progress tracking, and tile removal.
 */
export default class MiningSystem {
    constructor(chunkManager, lightingSystem, keys, options = {}) {
        this.chunkManager = chunkManager;
        this.lightingSystem = lightingSystem;
        this.keys = keys;
        this.player = null;
        this.noiseTileSize = options.noiseTileSize || 8;

        // Mining configuration
        this.baseMiningTime = options.baseMiningTime || 2.0;
        this.miningKey = options.miningKey || ' ';
        this.maxMiningDistance = options.maxMiningDistance || 2.0;

        // Mining state
        this._isActive = false;
        this._prevMiningHeld = false;
        this.miningTarget = null;
        this.miningProgress = 0;

        // Signals
        this.onMiningStarted = new Signal();
        this.onMiningProgress = new Signal();
        this.onMiningComplete = new Signal();
        this.onMiningCancelled = new Signal();
    }

    /**
     * Set the player reference
     * @param {Object} player - Player sprite
     */
    setPlayer(player) {
        this.player = player;
    }

    /**
     * Update mining state
     * @param {number} delta - Time delta in seconds
     * @param {Object|null} highlightTile - Currently highlighted tile {sx, sy}
     */
    update(delta, highlightTile = null) {
        const miningHeld = !!this.keys.held(this.miningKey);

        // Mining input state machine
        if (miningHeld && !this._prevMiningHeld) {
            this._startMining(highlightTile);
        } else if (!miningHeld && this._prevMiningHeld) {
            this._cancelMining();
        }

        this._prevMiningHeld = miningHeld;

        // Process active mining
        if (this._isActive && miningHeld && this.miningTarget && this.player) {
            this._processMining(delta);
        } else if (!miningHeld) {
            this.miningProgress = 0;
        }
    }

    /**
     * Check if currently mining
     * @returns {boolean}
     */
    isActive() {
        return this._isActive;
    }

    /**
     * Get current mining target
     * @returns {Object|null} {sx, sy} or null
     */
    getTarget() {
        return this.miningTarget;
    }

    /**
     * Get mining progress (0..1)
     * @returns {number}
     */
    getProgress() {
        if (!this._isActive || !this.player) return 0;
        const speed = this._getMiningSpeed();
        const required = this.baseMiningTime / Math.max(0.0001, speed);
        return Math.max(0, Math.min(1, this.miningProgress / required));
    }

    // --- Private methods ---

    _startMining(highlightTile) {
        if (!highlightTile) return;

        this._isActive = true;
        this.miningTarget = { sx: highlightTile.sx, sy: highlightTile.sy };
        this.miningProgress = 0;
        this.onMiningStarted.emit(this.miningTarget.sx, this.miningTarget.sy);
        this.player.mining = true;
    }

    _cancelMining() {
        if (this._isActive) {
            this.onMiningCancelled.emit();
        }
        this._isActive = false;
        this.miningTarget = null;
        this.miningProgress = 0;
        this.player.mining = false;
    }

    _processMining(delta) {
        // Validate target still exists
        const tile = this.chunkManager.getTileValue(this.miningTarget.sx, this.miningTarget.sy);
        const targetExists = tile && (tile.type === 'solid' || tile.type === 'ladder');

        if (!targetExists) {
            this._cancelMining();
            return;
        }

        // Check distance to target
        const px = this.player.pos.x + this.player.size.x * 0.5;
        const py = this.player.pos.y + this.player.size.y * 0.5;
        const tx = this.miningTarget.sx * this.noiseTileSize + this.noiseTileSize * 0.5;
        const ty = this.miningTarget.sy * this.noiseTileSize + this.noiseTileSize * 0.5;
        const dist = Math.hypot(px - tx, py - ty) / this.noiseTileSize;

        if (dist > this.maxMiningDistance) {
            this._cancelMining();
            return;
        }

        // Advance progress
        const speed = this._getMiningSpeed();
        const required = this.baseMiningTime / Math.max(0.0001, speed);
        this.miningProgress += delta;
        this.onMiningProgress.emit(this.miningProgress / required);

        // Complete mining
        if (this.miningProgress >= required) {
            this._completeMining();
        }
    }

    _completeMining() {
        if (!this.miningTarget) return;

        const sx = this.miningTarget.sx;
        const sy = this.miningTarget.sy;

        // Remove tile
        this.chunkManager.setTileValue(sx, sy, null);
        this.chunkManager.removeBlock(sx, sy);

        // Remove torch if present
        this.lightingSystem.removeTorch(sx, sy);

        // Emit completion signal
        this.onMiningComplete.emit(sx, sy);

        // Reset state
        this._isActive = false;
        this.miningTarget = null;
        this.miningProgress = 0;
        this.player.mining = false;
    }

    _getMiningSpeed() {
        if (!this.player || !this.player.currentTool) return 1.0;
        return typeof this.player.currentTool.speed === 'number' 
            ? this.player.currentTool.speed 
            : 1.0;
    }
}
