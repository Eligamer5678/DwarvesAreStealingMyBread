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

        // Highlighted tile (selector)
        this.highlightedTile = null; // { sx, sy }

        // Mining configuration
        this.baseMiningTime = options.baseMiningTime || 2.0;
        this.miningKey = options.miningKey || ' ';
        this.maxMiningDistance = options.maxMiningDistance || 2.0;

        // Mining state
        this._isActive = false;
        this._prevMiningHeld = false;
        this.miningTarget = null;
        this.miningProgress = 0;

        // Building state
        this.buildDirection = new Vector(0,0)

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
     * Update mining state and highlighted tile
     * @param {number} delta - Time delta in seconds
     */
    update(delta) {
        // Update highlighted tile. If we are currently locked to a mining target,
        // pass that as the lockedTarget so the highlight doesn't jump around.
        this._updateHighlightedTile(this.miningTarget);

        const miningHeld = !!this.keys.held(this.miningKey);
        this.placeLogic()
        
        // Mining input state machine
        if (miningHeld && !this._prevMiningHeld) {
            this._startMining(this.highlightedTile);
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
    
    placeLogic(){
        if(!this.keys.held('Shift') || !this.player.onGround) return;

        this.buildDirection.multS(0)
        let canPlace = false;
        if(this.player.input.isHeld('up')) {this.buildDirection.y = -1; canPlace = true;}
        if(this.player.input.isHeld('down')) {this.buildDirection.y = 1; canPlace = true;}
        if(this.player.input.isHeld('right')) {this.buildDirection.x = 1; canPlace = true;}
        if(this.player.input.isHeld('left')) {this.buildDirection.x = -1; canPlace = true;}
        const base = this.getPlayerPos()

        if(!canPlace) return;
        if(!this.keys.held(' ')) return;
        const tile = this.chunkManager.getTileValue(base.x+this.buildDirection.x, base.y+this.buildDirection.y);
        const hasBlock = tile && (tile.type === 'solid' || tile.type === 'ladder');
        if(hasBlock===true) return;
        this.chunkManager.setTileValue(
            base.x + this.buildDirection.x,
            base.y + this.buildDirection.y,
            { type: 'solid' }
        );
      
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

    /**
     * Update the highlighted tile based on player input and position.
     * Preserves highlight if `lockedTarget` is provided.
     * @param {Object|null} lockedTarget - Optional locked mining target {sx, sy}
     */
    _updateHighlightedTile(lockedTarget = null) {
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
     * Return currently highlighted tile (or null)
     */
    getHighlightedTile() {
        return this.highlightedTile;
    }

    getPlayerPos(){
        let base = null;
        if (this.player && this.noiseTileSize) {
            const px = this.player.pos.x + this.player.size.x * 0.5;
            const py = this.player.pos.y + this.player.size.y * 0.5;
            base = new Vector(Math.floor(px / this.noiseTileSize), Math.floor(py / this.noiseTileSize));
        }
        return base
    }

    /**
     * Draw the highlighted tile and mining progress using the provided Draw instance.
     * @param {Object} Draw - drawing helper (Scenes pass `this.Draw`)
     */
    draw(Draw) {
        if (!Draw) return;
        const ts = this.noiseTileSize;
        // If Shift is held, highlight the 8 adjacent tiles in blue.
        const shiftHeld = !!(this.keys && this.keys.held && this.keys.held('Shift'));

        if (shiftHeld) {
                // Determine base tile to surround: prefer highlighted tile, fall back to player's center tile
                const base = this.highlightedTile ? { x: this.highlightedTile.sx, y: this.highlightedTile.sy } : this.getPlayerPos();
                if (!base) return;

                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const tile = this.chunkManager.getTileValue(base.x+dx, base.y+dy);
                    const hasBlock = tile && (tile.type === 'solid' || tile.type === 'ladder');

                    if (hasBlock===true) continue;
                    if (dx === 0 && dy === 0) continue; // skip center
                    const sx = (base.x + dx) * ts;
                    const sy = (base.y + dy) * ts;
                        let color = '#4FA3FF'
                    if (dy === this.buildDirection.y && dx === this.buildDirection.x){
                        color = '#FF0000'
                    }
                    Draw.rect(
                        new Vector(sx, sy),
                        new Vector(ts, ts),
                        'rgba(80,150,255,0.28)',
                        true,
                        true,
                        2,
                        color
                    );

                }
            }
        } else {
            // Draw single yellow highlight as before
            if (this.highlightedTile) {
                const hx = this.highlightedTile.sx * ts;
                const hy = this.highlightedTile.sy * ts;
                Draw.rect(
                    new Vector(hx, hy),
                    new Vector(ts, ts),
                    'rgba(255,255,0,0.25)',
                    true,
                    true,
                    2,
                    '#FFFF00'
                );
            }
        }

        // Draw mining progress if active
        if (!this._isActive || !this.player) return;

        const target = this.miningTarget;
        if (!target) return;

        const sx = target.sx;
        const sy = target.sy;
        const cx = sx * ts + ts * 0.5;
        const cy = sy * ts + ts * 0.5;
        const progress = this.getProgress();

        // Background circle
        Draw.circle(new Vector(cx, cy), ts * 0.4, 'rgba(0,0,0,0.5)', true);
        
        // Progress arc
        const start = -Math.PI / 2;
        const end = start + progress * Math.PI * 2;
        const size = new Vector(ts * 0.8, ts * 0.8);
        Draw.arc(new Vector(cx, cy), size, start, end, 'rgba(255,220,80,0.95)', true, false);
        
        // Outline
        Draw.circle(new Vector(cx, cy), ts * 0.4, 'rgba(255,255,255,0.25)', false, 2);
    }
    _drawMiningHighlight(Draw){

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

    _getFacingDirection(inputX) {
        const holdLeft = inputX < -0.5;
        const holdRight = inputX > 0.5;

        if (holdLeft) return -1;
        if (holdRight) return 1;

        // Fallback to sprite facing
        if (this.player && this.player.invert) {
            if (typeof this.player.invert.x === 'number') return this.player.invert.x;
            if (typeof this.player.invert === 'number') return this.player.invert;
        }

        return 1;
    }
}
