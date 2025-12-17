import Sprite from './Sprite.js';
import Vector from '../modules/Vector.js';
import Timer from '../modules/Timer.js';
import Color from '../modules/Color.js';
/**
 * @typedef {Object} DwarfInputSettings
 * @property {string} [type] - Input controller type (e.g. 'platformer').
 * @property {boolean} [normalizeDiagonal] - Normalize diagonal movement.
 * @property {string[]} [jumpKeys] - Keys used for jump actions.
 * @property {number} [deadzone] - Deadzone for analog inputs.
 */

/**
 * @typedef {import('../modules/Spritesheet.js').default} SpriteSheetType
 * @typedef {import('../modules/Vector.js').default} VectorType
 * @typedef {import('../modules/Keys.js').default} KeysType
 * @typedef {import('../modules/Draw.js').default} DrawType
 * @typedef {import('../managers/EntityManager.js').default} EntityManager
 */

/** Dwarf sprite */
export default class Dwarf extends Sprite {
    /**
     * Create a Dwarf player sprite.
     * @param {KeysType} keys - Keys helper instance (optional; pass null to skip input controller)
     * @param {DrawType} Draw - Draw helper used for rendering
     * @param {VectorType} pos - Top-left world position for the sprite
     * @param {VectorType} [size=new Vector(48,48)] - Draw size (in world pixels)
     * @param {SpriteSheetType|null} [spriteSheet=null] - Animation Spritesheet 
     * @param {DwarfInputSettings|Object} [inputSettings={type:'platformer'}] - Input settings or an Input instance
     */
    constructor(keys, Draw, pos, size = new Vector(48,48), spriteSheet = null, inputSettings = { type: 'platformer' }){
        super(keys, Draw, pos, size, spriteSheet, inputSettings);
        this.speed = 7;
        this.friction = 0.001;

        // Platformer physics
        this.gravity = 5; // px/s^2 downward
        this.terminal = 100; // max fall speed (px/s)
        this.jumpSpeed = 1.6; // initial jump impulse (px/s)
        this.onGround = 0; // set by scene collision resolution
        this.onLadder = false; // set by scene when overlapping ladder
        this.climbSpeed = 1; // px/s climb speed when on ladder (slower)
        this.mining = false;
        // Tool state (can be changed at runtime). `speed` scales mining time (1.0 = normal).
        this.currentTool = { type: 'pickaxe', speed: 1.0 };

        // Optional external systems passed via constructor options
        this.chunkManager = (inputSettings && inputSettings.chunkManager) ? inputSettings.chunkManager : null;
        this.scene = (inputSettings && inputSettings.scene) ? inputSettings.scene : null;
        // mining state
        this.miningTarget = null; // { sx, sy, worldPos }
        this.miningProgress = 0;
        this.miningRequired = 0.6; // seconds base to mine one tile (scaled by tool)
        this.brightness = 0
        this._lastMiningKey = null;
        // building state
        this.selectedItem = 'stone';
        this.selectedIndex = 0;
        this.team = "player"
        this._buildModeToggle = true; // toggled state via double-tap
        this._suppressAutoBuildAfterMine = false; // Ensure suppression flag is cleared when leaving build mode
        this.blockPlaced = false;
        this.placeLayer = "base"
        this.blockMined = false;
        this.placementRotation = 0; // rotation for placed blocks (0, 90, 180, 270)
        this.placementInvert = false; // flip state for placed blocks

        // Palette of buildable blocks (used by buildKeys and pickBlock)
        this.buildPalette = [
            'stone',
            'sand',
            'ladder',
            'sandstone',
            'polished_sandstone',
            'pillar_sandstone',
            'red_sand',
            'red_sandstone',
            'red_pillar_sandstone',
            'red_polished_sandstone',
            'deadbush',
            'cobblestone',
            'rotirock',
            'briocheoid',
            'pumpernickel',
            'breadstone',
            'salt',
            'coal',
            'pretzelstick',
            'cobblestone_wall',
            'cobblestone_slab',
            'cobblestone_stair',
            'polished_stone_window',
            'polished_cobblestone',
            'polished_cobblestone_wall',
            'polished_cobblestone_pillar',
            'polished_cobblestone_slab',
            'polished_cobblestone_stair',
            'polished_stone',
            'polished_stone_wall',
            'polished_stone_pillar',
            'polished_stone_slab',
            'polished_stone_stair',
            'polished_cobblestone_window',
            'polished_stone_door_top',
            'polished_stone_door_bottom',
            'polished_cobblestone_door_top',
            'polished_cobblestone_door_bottom',
            'cobblestone',
        ];

        // Wire jump input (Input.onJump emits when jump key pressed)
        this.input.onJump.connect((k) => {
            if (this.onGround&&!this.keys.held('Shift')) {
                this.vlos.y = -this.jumpSpeed;
                this.onGround = 0;
            }
        });

        this.atkCooldown = 0;
        this.maxAtkCooldown = 0.1;
        this.attacking = false;
        this.sheet.onSwap.connect((name,name2)=>{
            if(name==='attack') this.attacking=false;
        })
    }

    // --- Mining / Building helpers (high-level, Dwarf-centric logic) ---
    _worldToSample(worldX, worldY) {
        const ts = this.chunkManager.noiseTileSize;
        return { sx: Math.floor(worldX / ts), sy: Math.floor(worldY / ts), tilePx: ts };
    }

    

    

    update(delta){
        // base sprite update handles horizontal input and friction
        if(!this.enablePhysicsUpdate) this.enablePhysicsUpdate = true;
        if(this.keys.held('Shift')){
            if(this.vlos.y<0 && this.onGround) {
                this.vlos.y = 0;
                this.vlos.x = 0;
            }
            this.enablePhysicsUpdate = false; // stops super.update from updating position
            this.pos.addS(this.vlos)
        }
        super.update(delta);
        
        this.buildKeys()
        this.ladder(delta)
        
        this.updateAnimation()
        
        this.mineInput(delta)
        this.attackInput(delta)
    }

    draw(levelOffset){
        // draw the dwarf itself
        super.draw(levelOffset);

        // draw the mining target highlight (if any)
        try {
            if (this.miningTarget && this.Draw) {
                const ts = this.chunkManager.noiseTileSize;
                const topLeft = new Vector(this.miningTarget.sx * ts, this.miningTarget.sy * ts).add(levelOffset || new Vector(0,0));
                // outline (yellow for mining, green for build mode)
                const buildActive = (this.keys.held('Control')&&!this.keys.held('Control')) || this._buildModeToggle;
                const col = buildActive ? new Color(0,200,0,Math.min(this.brightness,1),'rgb') : new Color(255,255,0,Math.min(this.brightness,1),'rgb');
                this.Draw.rect(topLeft, new Vector(ts, ts), '#00000000', false, true, 1, col);
                // progress bar (bottom of tile)
                // Determine required time from the block's hardness (fallback to this.miningRequired)
                let visualRequired = this.miningRequired;
                const t = this.chunkManager.getTileValue(this.miningTarget.sx, this.miningTarget.sy, this._getActivePlaceLayer());
                if (t) t.meta.data.hardness;
                const frac = Math.max(0, Math.min(1, this.miningProgress / Math.max(1e-6, visualRequired / (this.currentTool?.speed || 1))));
                if (frac > 0) {
                    const barH = Math.max(2, Math.floor(ts * 0.12));
                    const barW = Math.max(2, Math.floor(ts * frac));
                    const barPos = topLeft.add(new Vector(0, ts - barH));
                    this.Draw.rect(barPos, new Vector(barW, barH), '#FFFF0099', true, false);
                }
            }
        } catch (e) { /* ignore draw errors */ }
    }

    buildKeys(){
        const blocks = this.buildPalette;
        if(this.keys.pressed('o')) this.selectedIndex = (this.selectedIndex+blocks.length-1)%blocks.length
        if(this.keys.pressed('p')) this.selectedIndex = (this.selectedIndex+1)%blocks.length
        this.selectedItem = blocks[this.selectedIndex]

        // Rotation and flip controls (r = rotate 90°, f = flip horizontally)
        if(this.keys.pressed('r')) {
            this.placementRotation = (this.placementRotation + 90) % 360;
        }
        if(this.keys.pressed('f')) {
            this.placementInvert = !this.placementInvert;
        }
        // Pickblock: copy target block into current selection
        if(this.keys.pressed('c')){
            this.pickBlock();
        }
    }

    /**
     * Pick the currently targeted block and copy its id/rotation/invert
     * into the dwarf's placement selection (`selectedItem`, `placementRotation`, `placementInvert`).
     * Returns true if a block was picked.
     */
    pickBlock(){
        try{
            if(!this.chunkManager) return false;
            // Ensure we have an up-to-date target
            if(!this.miningTarget) this._updateTarget();
            if(!this.miningTarget) return false;
            const sx = this.miningTarget.sx;
            const sy = this.miningTarget.sy;
            // Query the tile; use 'any' to get top-most tile at target
            const tile = this.chunkManager.getTileValue(sx, sy, 'any');
            if(!tile || !tile.id) return false;
            // Copy id into selectedItem
            this.selectedItem = tile.id;
            // Copy rotation/invert if present, otherwise default
            this.placementRotation = (typeof tile.rot === 'number') ? tile.rot : 0;
            this.placementInvert = (typeof tile.invert === 'boolean') ? tile.invert : false;
            // Also set the place layer to the tile's layer so subsequent placements
            // default to placing into the same layer the block was picked from.
            if(tile.layer) this.placeLayer = tile.layer;
            // Update selectedIndex if the picked id exists in the buildPalette
            const idx = this.buildPalette.indexOf(tile.id);
            if(idx >= 0) this.selectedIndex = idx;
            return true;
        }catch(e){ return false; }
    }
    ladder(delta){
        // Ladder climbing: when on a ladder, gravity is suspended and vertical
        // movement is controlled by input.y (this.inputDir.y). Otherwise, apply gravity.
        if (this.onLadder&&this.enablePhysicsUpdate) {
            // prefer environment input for vertical control when on ladder
            const env = (this.envInputDir && typeof this.envInputDir.y === 'number') ? this.envInputDir.y : (this.inputDir && typeof this.inputDir.y === 'number' ? this.inputDir.y : 0);
            // input: -1 up, +1 down
            this.vlos.y = env * this.climbSpeed;
            this.onGround = 0;
        } else {
            // apply gravity (downwards positive)
            this.vlos.y += this.gravity * delta;
            if (this.vlos.y > this.terminal) this.vlos.y = this.terminal;
        }
        this.vlos.x *= this.friction ** delta;

    }
    mineInput(delta){
        // handle mining input/targeting each tick
        this.handleMiningInput(delta);

        // Build mode activation: hold Control OR double-tap Shift toggles build mode
        let buildModeActive = false;
        try {
            if (this.keys.held('Control')) buildModeActive = true;
            // double-tap Shift toggles persistent build mode
            if (this.keys.doubleTapped('Shift')) {
                this._buildModeToggle = !this._buildModeToggle;
            }
            buildModeActive = buildModeActive || this._buildModeToggle;
        } catch (e) { /* ignore */ }

        // If in build mode and space was pressed, place the selected item at target
        // Special-case: when placing ladders, place at the dwarf's position
        // and allow holding space to repeat placements.
        if (buildModeActive && this.selectedItem === 'ladder') {
            if (this.keys.held(' ')) {
                if (this._ladderPlaceCooldown === undefined) this._ladderPlaceCooldown = 0;
                this._ladderPlaceCooldown -= delta;
                if (this._ladderPlaceCooldown <= 0 && !this.blockMined) {
                    const cx = this.pos.x + this.size.x * 0.5;
                    const cy = this.pos.y + this.size.y * 0.5;
                    const placed = this.buildAtWorld(cx, cy, 'ladder', { allowOverlap: true });
                    if (this.keys.pressed(' ')) this.blockPlaced = placed;
                    if (placed) {
                        this.blockPlaced = true;
                        this.mining = false;
                        this.miningProgress = 0;
                        this._lastMiningKey = null;
                        this._ladderPlaceCooldown = 0.12;
                    } else {
                        this._ladderPlaceCooldown = 0.08;
                    }
                }
            } else {
                this._ladderPlaceCooldown = 0;
            }
            // also respond to single-press immediately
            if (this.keys.pressed(' ') && !this.blockMined) {
                const cx = this.pos.x + this.size.x * 0.5;
                const cy = this.pos.y + this.size.y * 0.5;
                const placed = this.buildAtWorld(cx, cy, 'ladder', { allowOverlap: true });
                if (placed) {
                    this.blockPlaced = true;
                    this.mining = false;
                    this.miningProgress = 0;
                    this._lastMiningKey = null;
                }
            }
        }

        if (buildModeActive && this.selectedItem !== 'ladder' && this.miningTarget && (this.keys.held(' ') && this.keys.held('Shift') || this.keys.pressed(' ')) && !this.blockMined) {
            let placed = this.buildAtWorld(this.miningTarget.worldPos.x + this.chunkManager.noiseTileSize*0.5, this.miningTarget.worldPos.y + this.chunkManager.noiseTileSize*0.5, this.selectedItem);
            if(this.keys.pressed(' ')) {
                this.blockPlaced = placed;
                // record whether the initial press started with a downward input
                const startedDown = (this.envInputDir.y > 0) || this.input.isHeld('down') || this.keys.held('ArrowDown') || this.keys.held('s');
                this._autoPlaceStartedDown = !!startedDown;
            }
            if (this.blockPlaced) {
                // Prevent immediately mining the block we just placed: reset mining state and
                // suppress mining until the player releases the keys.
                this.mining = false;
                this.miningProgress = 0;
                this._lastMiningKey = null;
            }
        }

        // QoL: while holding space in build mode, continuously attempt to place blocks
        // downward (for quick 'towering'). Use a small cooldown so placement repeats
        // at a reasonable rate rather than every frame.
        if (buildModeActive && this.keys.held(' ') && !this.blockMined && this._autoPlaceStartedDown) {
            if (this._autoPlaceCooldown === undefined) this._autoPlaceCooldown = 0;
            this._autoPlaceCooldown -= delta;
            if (this._autoPlaceCooldown <= 0) {
                // target one tile below the player's center
                if (this.chunkManager) {
                    const ts = this.chunkManager.noiseTileSize;
                    const cx = this.pos.x + this.size.x * 0.5;
                    const cy = this.pos.y + this.size.y * 0.5;
                    const placeX = cx;
                    const placeY = cy + ts; // one tile down
                    const placed = this.buildAtWorld(placeX, placeY, this.selectedItem);
                    if (placed) {
                        this.blockPlaced = true;
                        this.mining = false;
                        this.miningProgress = 0;
                        this._lastMiningKey = null;
                        this._autoPlaceCooldown = 0.12; // seconds between placements
                    } else {
                        // try again a bit sooner if placement failed (tile occupied)
                        this._autoPlaceCooldown = 0.08;
                    }
                } else {
                    this._autoPlaceCooldown = 0.12;
                }
            }
        } else {
            // reset cooldown and clear start flag when not holding
            this._autoPlaceCooldown = 0;
            this._autoPlaceStartedDown = false;
        }
    }

    attackInput(delta){
        this.atkCooldown -= delta;
        /**
         * @type EntityManager
        */
        const entityMan = this.scene.entityManager
        entityMan.getEnemiesInRange(this.pos,2,(entity)=>{
            if(entity.team==="player") return;
            if(this.keys.pressed(" ") && this.atkCooldown < 0){
                this.attacking = true;
                this.atkCooldown = this.maxAtkCooldown;
                try {entity.vlos.x = this.invert.x * 2} catch(e){}
                try {entity.sheet.playAnimation('hit')} catch(e){}
                try {entity.health -=1 } catch(e){}
            }
        })


    }
    /**
     * Get the player position
     * @returns {VectorType} Player position in tiles
     */
    getTilePos(){
        const ts = this.chunkManager.noiseTileSize;
        const center = this.pos.add(this.size.mult(0.5));
        return center.div(ts).floorS();
    }

    // Determine the effective layer to place/mine into based on modifier keys.
    // - Hold Alt => 'back'
    // - Hold Alt + Control => 'overlays'
    // - Otherwise use this.placeLayer (usually 'base')
    _getActivePlaceLayer() {
        try {
            const alt = this.keys && this.keys.held && this.keys.held('Alt');
            const ctrl = this.keys && this.keys.held && this.keys.held('Control');
            if (alt) return (ctrl ? 'overlays' : 'back');
        } catch (e) { /* ignore key errors */ }
        return this.placeLayer;
    }



    // Mining code
    mineAtWorld(worldX, worldY) {
        const { sx, sy } = this._worldToSample(worldX, worldY);
        const layer = this._activeMiningLayer || this._getActivePlaceLayer();
        const cur = this.chunkManager.getTileValue(sx, sy, layer);
        if (!cur || !cur.id) return false; // nothing to mine
        try {
            // remove tile (set to null / air)
            this.chunkManager.setTileValue(sx, sy, null, layer);
            // optional: notify lighting/chunk updates elsewhere
            this.scene.lighting.markDirty();
            // clear captured mining layer after successful mine
            this._activeMiningLayer = null;
        } catch (e) { this._activeMiningLayer = null; return false; }
        return true;
    }

    buildAtWorld(worldX, worldY, blockId, opts = {}) {
        const { sx, sy } = this._worldToSample(worldX, worldY);

        // Prevent placing a block in any tile overlapped by the dwarf's bounding box
        const ts = this.chunkManager.noiseTileSize;
        const left = this.pos.x + 4;
        const right = this.pos.x + this.size.x - 4;
        const top = this.pos.y + 4;
        const bottom = this.pos.y + this.size.y - 4;
        const sx0 = Math.floor(left / ts);
        const sx1 = Math.floor((right - 1) / ts);
        const sy0 = Math.floor(top / ts);
        const sy1 = Math.floor((bottom - 1) / ts);
        // Normally prevent placing a block in any tile overlapped by the dwarf's
        // bounding box. Allow an override for cases like ladder placement where
        // placing at the player's tile is desired.
        if (!opts.allowOverlap && sx >= sx0 && sx <= sx1 && sy >= sy0 && sy <= sy1) return false;

        const layer = opts.layer || this._getActivePlaceLayer();
        const existing = this.chunkManager.getTileValue(sx, sy, layer);
        if (existing && existing.id) return false; // occupied

        // Build tile value with rotation and invert if they are non-default
        let tileValue = blockId;
        if (this.placementRotation !== 0 || this.placementInvert !== false) {
            tileValue = { id: blockId };
            if (this.placementRotation !== 0) tileValue.rot = this.placementRotation;
            if (this.placementInvert !== false) tileValue.invert = this.placementInvert;
        }

        this.chunkManager.setTileValue(sx, sy, tileValue, layer);
        this.scene.lighting.markDirty();

        return true;
    }

    mineUnderPlayer() {
        const cx = this.pos.x + this.size.x * 0.5;
        const cy = this.pos.y + this.size.y * 0.5;
        return this.mineAtWorld(cx, cy);
    }

    buildUnderPlayer(blockId) {
        const cx = this.pos.x + this.size.x * 0.5;
        const cy = this.pos.y + this.size.y * 0.5;
        return this.buildAtWorld(cx, cy, blockId);
    }

    // determine the tile being pointed to
    _updateTarget() {
        // Prefer precise directional input from envInputDir (arrow keys/wasd), fall back to facing direction
        const fx = this.invert.x;
        const shiftHeld = this.keys.held('Shift');

        // Determine whether player is attempting Up/Down input
        let wantsUp = this.envInputDir.y < 0 || this.input.isHeld('up') || this.keys.held('ArrowUp') || this.keys.held('w');
        let wantsDown = this.envInputDir.y > 0 || this.input.isHeld('down') || this.keys.held('ArrowDown') || this.keys.held('s');

        // Default to facing direction
        let dir = new Vector(fx, 0);

        // Allow directional input if Shift held, or if pressing Down, or if pressing Up
        // and there is a solid tile above. This prevents diagonal-up without Shift.
        let allowInputDir = shiftHeld || wantsDown;
        if (wantsUp) {
            const tsCheck = this.chunkManager.noiseTileSize;
            const center = this.pos.add(this.size.mult(0.5));
            const sampleAbove = this._worldToSample(center.x, center.y - tsCheck);
            const aboveTile = this.chunkManager.getTileValue(sampleAbove.sx, sampleAbove.sy, this._getActivePlaceLayer());
            if (aboveTile && aboveTile.id) allowInputDir = true;
        }

        if (allowInputDir) {
            dir = this.envInputDir.clone();
            // Prevent diagonal upward aiming unless Shift is held.
            if (dir.y < 0 && (!shiftHeld)) {
                if (wantsUp||(this.onLadder&&this.selectedItem==='ladder')) dir = new Vector(0, -1);
                else dir = new Vector(fx, 0);
            }
        }
        dir = dir.normalize();

        const ts = this.chunkManager.noiseTileSize;
        const center = this.pos.add(this.size.mult(0.5));
        // target world position is one tile away in direction
        const targetWorld = center.add(dir.mult(ts));
        const sample = this._worldToSample(targetWorld.x, targetWorld.y);
        // ensure we don't target the tile we're standing on
        const selfSample = this._worldToSample(center.x, center.y);
        if ((sample.sx === selfSample.sx && sample.sy === selfSample.sy)&&!this.onLadder) {
            this.miningTarget = null;
            return;
        }
        this.miningTarget = { sx: sample.sx, sy: sample.sy, worldPos: new Vector(sample.sx * ts, sample.sy * ts) };
    }

    // Attempt to progress mining when space is held. Call from scene update loop.
    handleMiningInput(delta) {
        // Check whether space is being held before changing target
        const heldTime = this.keys.held(' ', true)
        if(heldTime === 0) this.blockMined = false;
        if(heldTime === 0) this.blockPlaced = false;

        // If we're not currently mining and space is not held, update the target normally
        if ((!this.mining && !heldTime) || this.blockPlaced) {
            this._updateTarget();
        }

        // If space is being held and we've not yet begun mining, lock on the
        // current target so transient changes (blocks above/below) don't steal context.
        if (heldTime && !this.mining && !this.blockPlaced) {
            // capture a fresh target when user begins holding space
            this._updateTarget();
            // If the captured target is air, abort starting mining
            try {
                if (!this.miningTarget) { this.miningProgress = 0; this._lastMiningKey = null; return; }
                // capture the active layer at the start of the mining action so
                // subsequent modifier changes don't move the mining to another layer
                const layer = this._getActivePlaceLayer();
                this._activeMiningLayer = layer;
                const maybeTile = this.chunkManager.getTileValue(this.miningTarget.sx, this.miningTarget.sy, layer);
                if (!maybeTile || !maybeTile.id) { this.miningProgress = 0; this._lastMiningKey = null; this._activeMiningLayer = null; return; }
                // initialize last key for this mining action
                this._lastMiningKey = `${this.miningTarget.sx},${this.miningTarget.sy}`;
            } catch (e) { this._lastMiningKey = null; this._activeMiningLayer = null; return; }
        }
        if (!this.miningTarget) { this.miningProgress = 0; this._lastMiningKey = null; return; }

        // If we're currently mining (space was held previously), DO NOT update the target
        // This preserves the mining context even if nearby tiles change.
        if (!this.mining && !this.miningTarget) { this.miningProgress = 0; this._lastMiningKey = null; return; }

        // Reset progress if the targeted tile changed (only possible when not locked)
        try {
            const curKey = this.miningTarget ? `${this.miningTarget.sx},${this.miningTarget.sy}` : null;
            if (curKey && this._lastMiningKey !== null && this._lastMiningKey !== curKey && !this.mining) {
                this.miningProgress = 0;
                this._lastMiningKey = curKey;
            }
        } catch (e) { /* ignore */ }

        if (heldTime && !this.blockPlaced) {
            this.mining = true;
            const toolSpeed = this.currentTool.speed;
            // Determine required time from the block's hardness (if present), otherwise fall back
            let requiredBase = this.miningRequired;
            if (this.miningTarget) {
                const t = this.chunkManager.getTileValue(this.miningTarget.sx, this.miningTarget.sy, this._activeMiningLayer || this._getActivePlaceLayer());
                // if tile became air while mining, abort the mining action
                if (!t || !t.id) { this.miningProgress = 0; this.mining = false; this._lastMiningKey = null; this._activeMiningLayer = null; return; }
                if (t && t.meta && t.meta.data && typeof t.meta.data.hardness === 'number') requiredBase = t.meta.data.hardness;
            }
            const required = requiredBase / toolSpeed;
            if(!this.blockPlaced){
                this.miningProgress += delta;
            }
            // play mining animation
            this.sheet.playAnimation('mine'); 
            if (this.miningProgress >= required) {
                // perform mining on the target tile
                const ts = this.chunkManager.noiseTileSize;
                const wx = this.miningTarget.worldPos.x + ts * 0.5;
                const wy = this.miningTarget.worldPos.y + ts * 0.5;
                this.mineAtWorld(wx, wy);
                this.miningProgress = 0;
                this.mining = false;
                this.blockMined = true;
                this._lastMiningKey = null;
            }
        } else if (heldTime && this.blockPlaced) {
            // Space is held but we just placed a block: do not start mining.
            this.mining = false;
            // keep miningProgress at zero while blockPlaced is true
            this.miningProgress = 0;
            // Do not clear _lastMiningKey here; preserve context until user releases
        } else {
            // when space released, clear mining state
            this.miningProgress = 0;
            this.mining = false;
            this._lastMiningKey = null;
        }
    }

    updateAnimation(){
        // Animation & facing: switch to 'walk' when moving horizontally,
        // otherwise 'idle'. Reset frame when animation changes.
        const moveSpeed = Math.abs(this.vlos.x || 0);
        const walkThreshold = 0.1; // px/s threshold to consider 'walking'
        const shiftHeld = this.keys.held('Shift');
        const buildActive = ((this.keys.held('Control')) || this._buildModeToggle);
        if(this.attacking) {this.sheet.playAnimation('attack'); return;}
        // Facing: set invert to -1 when moving left, 1 when moving right.
        if ((this.vlos.x || 0) < -0.01) this.invert.x = -1;
        else if ((this.vlos.x || 0) > 0.01) this.invert.x = 1;
        if (this.mining) {this.sheet.playAnimation('mine'); return;}
        
        if (shiftHeld && buildActive) {this.sheet.playAnimation('point'); return;}
        if (shiftHeld&&!buildActive) {this.sheet.playAnimation('hold_pick'); return;}
        if (moveSpeed > walkThreshold) {
            if(this.keys.held(' ')) {
                if(this.input.isHeld('up')) {this.sheet.playAnimation('walk_and_hold_pick'); return;}
                this.sheet.playAnimation('walk_and_hold_pick_as_sheild');
                return;
            }
            this.sheet.playAnimation('walk');
            return;
        }
        this.sheet.playAnimation('idle');

        
    }
}
