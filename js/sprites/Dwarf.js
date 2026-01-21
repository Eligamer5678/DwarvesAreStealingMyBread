import Sprite from './Sprite.js';
import Vector from '../modules/Vector.js';
import Timer from '../modules/Timer.js';
import Color from '../modules/Color.js';
import Signal from '../modules/Signal.js';
import Inventory from '../modules/Inventory.js';
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
        this.chunkManager = inputSettings.chunkManager;
        this.scene = inputSettings.scene;
        // mining state
        this.miningTarget = null; // { sx, sy, worldPos }
        this.miningProgress = 0;
        this.miningRequired = 0.6; // seconds base to mine one tile (scaled by tool)
        this.brightness = 0
        this._lastMiningKey = null;
        // building state
        this.team = "player"
        this._buildModeToggle = true; // toggled state via double-tap
        this._suppressAutoBuildAfterMine = false; // Ensure suppression flag is cleared when leaving build mode
        this.blockPlaced = false;
        this.placeLayer = "base"
        this.blockMined = false;
        
        this.selected = {
            "type":null,
            "rot":0,
            "invert":false,
            "amount":0
        }
        this.selectedSlot = 0;

        this.onEdit = new Signal()
        this.onCraft = new Signal()
        this.onScroll = new Signal()

        // Creative mode: when true, items are unlimited and placement/mining
        // will not modify inventory. Also enables quick cycling with 'o'/'p'.
        this.creative = true;
        // Palette of buildable blocks (used by buildKeys and pickBlock)
        this.buildPalette = [
            'stone',
            'sand',
            'ladder',
            'glass',
            'anvil',
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

        this.inventory = new Inventory()

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
            this.attacking=false;
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
                if (t && t.meta && t.meta.data && typeof t.meta.data.hardness === 'number') {
                    visualRequired = t.meta.data.hardness;
                }
                const frac = Math.max(0, Math.min(1, this.miningProgress / Math.max(1e-6, visualRequired / (this.currentTool?.speed || 1)))) ;
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
        // quick slot keys 1-5 to select palette entries
        if (this.keys.pressed('1')) { this.selectedSlot = 0; this._applySelectedSlot(); }
        if (this.keys.pressed('2')) { this.selectedSlot = 1; this._applySelectedSlot(); }
        if (this.keys.pressed('3')) { this.selectedSlot = 2; this._applySelectedSlot(); }
        if (this.keys.pressed('4')) { this.selectedSlot = 3; this._applySelectedSlot(); }
        if (this.keys.pressed('5')) { this.selectedSlot = 4; this._applySelectedSlot(); }

        // Rotation and flip controls (r = rotate 90°, f = flip horizontally)
        if(this.keys.pressed('r')) {
            this.selected.rot = (this.selected.rot + 90) % 360;
            try {
                // Persist rotation into canonical hotbar entry so it survives _applySelectedSlot
                if (this.inventory && Array.isArray(this.inventory.slots.hotbar)) {
                    const hotbarKey = this.inventory.slots.hotbar[this.selectedSlot];
                    if (hotbarKey && this.inventory.Inventory && this.inventory.Inventory.has(hotbarKey)) {
                        const entry = this.inventory.Inventory.get(hotbarKey);
                        entry.data = entry.data || {};
                        entry.data.rot = this.selected.rot;
                        entry.data.invert = !!this.selected.invert;
                    } else {
                        // create a canonical entry for the selected type if missing
                        const type = this.selected.type || (Array.isArray(this.buildPalette) ? this.buildPalette[0] : null) || 'stone';
                        const amt = this.creative ? 9999 : 1;
                        const placed = this.inventory.addItem(type, `hotbar/${this.selectedSlot}`, true, 'inventory', amt);
                        if (placed) {
                            const newKey = this.inventory.slots.hotbar[this.selectedSlot];
                            if (newKey && this.inventory.Inventory.has(newKey)) {
                                const entry = this.inventory.Inventory.get(newKey);
                                entry.data = entry.data || {};
                                entry.data.rot = this.selected.rot;
                                entry.data.invert = !!this.selected.invert;
                            }
                        }
                    }
                }
            } catch (e) {}
            try { this._applySelectedSlot(); } catch (e) {}
        }
        if(this.keys.pressed('f')) {
            this.selected.invert = !this.selected.invert;
            try {
                if (this.inventory && Array.isArray(this.inventory.slots.hotbar)) {
                    const hotbarKey = this.inventory.slots.hotbar[this.selectedSlot];
                    if (hotbarKey && this.inventory.Inventory && this.inventory.Inventory.has(hotbarKey)) {
                        const entry = this.inventory.Inventory.get(hotbarKey);
                        entry.data = entry.data || {};
                        entry.data.invert = !!this.selected.invert;
                        entry.data.rot = this.selected.rot;
                    } else {
                        const type = this.selected.type || (Array.isArray(this.buildPalette) ? this.buildPalette[0] : null) || 'stone';
                        const amt = this.creative ? 9999 : 1;
                        const placed = this.inventory.addItem(type, `hotbar/${this.selectedSlot}`, true, 'inventory', amt);
                        if (placed) {
                            const newKey = this.inventory.slots.hotbar[this.selectedSlot];
                            if (newKey && this.inventory.Inventory.has(newKey)) {
                                const entry = this.inventory.Inventory.get(newKey);
                                entry.data = entry.data || {};
                                entry.data.invert = !!this.selected.invert;
                                entry.data.rot = this.selected.rot;
                            }
                        }
                    }
                }
            } catch (e) {}
            try { this._applySelectedSlot(); } catch (e) {}
        }
        // Pickblock: copy target block into current selection
        if(this.keys.pressed('c')){
            this.pickBlock();
        }
        // Creative quick-swap: previous/next palette item (use blocks.json keys when creative)
        if (this.keys.pressed('o')  && this.creative|| this.keys.pressed('p') && this.creative) {
            try {
                // Prefer canonical block registry when in creative mode
                let list = null;
                if (this.creative && this.chunkManager && this.chunkManager.blockDefs) {
                    const bd = this.chunkManager.blockDefs;
                    if (bd instanceof Map) list = Array.from(bd.keys());
                    else if (Array.isArray(bd)) list = bd.slice();
                    else if (bd && typeof bd === 'object') list = Object.keys(bd);
                }
                // Fallback to buildPalette if no registry available
                if (!list || list.length === 0) list = this.buildPalette;

                let idx = list.indexOf(this.selected.type);
                if (idx === -1) idx = 0;
                if (this.keys.pressed('o')) idx = (idx - 1 + list.length) % list.length;
                else idx = (idx + 1) % list.length;

                const newType = list[idx];
                this.selected.type = newType;
                // Update canonical hotbar slot via Inventory API when available
                try {
                    const amt = this.creative ? 9999 : 1;
                    if (this.inventory && typeof this.inventory.addItem === 'function') {
                        this.inventory.addItem(newType, `hotbar/${this.selectedSlot}`, true, 'inventory', amt);
                        // Refresh selected from the hotbar canonical entry
                        try { this._applySelectedSlot(); } catch (e) { }
                    } else {
                        const slotObj = Object.assign({}, this.slots[this.selectedSlot] || {});
                        slotObj.type = newType;
                        slotObj.amount = this.creative ? 9999 : (slotObj.amount || 0);
                        slotObj.rot = slotObj.rot || this.selected.rot || 0;
                        slotObj.invert = (typeof slotObj.invert !== 'undefined') ? slotObj.invert : this.selected.invert || false;
                        this.slots[this.selectedSlot] = slotObj;
                    }
                } catch (e) {}
            } catch (e) {}
        }
    }

    /**
     * Apply the current `selectedSlot` into `this.selected` by copying
     * the structured slot object from `this.slots` (which mirrors `player.slots`).
     */
    _applySelectedSlot(){
        try{
            // Resolve the quickslot key from the canonical inventory slots if available,
            // otherwise fall back to any legacy `this.slots` layout.
            let key = null;
            if (this.inventory && this.inventory.slots && Array.isArray(this.inventory.slots.hotbar)) {
                key = this.inventory.slots.hotbar[this.selectedSlot];
            } else if (this.slots && Array.isArray(this.slots)) {
                key = this.slots[this.selectedSlot];
            }
            let entry = null;
            if (key && this.inventory && this.inventory.Inventory && this.inventory.Inventory.has(key)) {
                entry = this.inventory.Inventory.get(key);
            }
            if (entry && entry.data) {
                const id = entry.data.tile || entry.data.coord || entry.data.id || null;
                this.selected = { type: id, rot: entry.data.rot || 0, invert: !!entry.data.invert, amount: entry.data.amount || 0 };
            } else {
                this.selected = { type: null, rot: 0, invert: false, amount: 0 };
            }
        }catch(e){}
    }

    /**
     * Pick the currently targeted block and copy its id/rotation/invert
     * into the dwarf's placement selection (`selectedItem`, `selected.rot`, `selected.invert`).
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
            // Copy id into the currently-selected slot and update selected
            this.selected.type = tile.id;
            // Copy rotation/invert if present, otherwise default
            this.selected.rot = (tile.rot !== undefined) ? tile.rot : 0;
            this.selected.invert = (tile.invert !== undefined) ? tile.invert : false;
            // Canonicalize the hotbar slot via Inventory API (ensures UI updates)
            try {
                const amt = this.creative ? 9999 : 1;
                if (this.inventory && typeof this.inventory.addItem === 'function') {
                    this.inventory.addItem(this.selected.type, `hotbar/${this.selectedSlot}`, true, 'inventory', amt);
                    // After placing, persist rot/invert/amount into the canonical entry
                    const newKey = (this.inventory.slots && Array.isArray(this.inventory.slots.hotbar)) ? this.inventory.slots.hotbar[this.selectedSlot] : null;
                    if (newKey && this.inventory.Inventory && this.inventory.Inventory.has(newKey)) {
                        const entry = this.inventory.Inventory.get(newKey);
                        entry.data = entry.data || {};
                        entry.data.tile = this.selected.type;
                        entry.data.id = this.selected.type;
                        entry.data.rot = this.selected.rot || 0;
                        entry.data.invert = !!this.selected.invert;
                        entry.data.amount = this.creative ? 9999 : (entry.data.amount || 0);
                    }
                } else {
                    // fallback: mutate legacy slots object
                    const slotObj = Object.assign({}, this.slots[this.selectedSlot] || {});
                    slotObj.type = this.selected.type;
                    slotObj.amount = this.creative ? 9999 : (slotObj.amount || 0);
                    slotObj.rot = slotObj.rot || this.selected.rot || 0;
                    slotObj.invert = (typeof slotObj.invert !== 'undefined') ? slotObj.invert : this.selected.invert || false;
                    this.slots[this.selectedSlot] = slotObj;
                }
            } catch (e) {}
            // Ensure selected reflects the stored slot canonical data
            try { this._applySelectedSlot(); } catch (e) {}
            // update placement layer if tile indicates one
            if (tile.layer) this.placeLayer = tile.layer;
            return true;
        }catch(e){ return false; }
    }
    ladder(delta){
        // Ladder climbing: when on a ladder, gravity is suspended and vertical
        // movement is controlled by input.y (this.inputDir.y). Otherwise, apply gravity.
        if (this.onLadder&&this.enablePhysicsUpdate) {
            // prefer environment input for vertical control when on ladder
            const env = this.envInputDir.y;
            // input: -1 up, +1 down
            this.vlos.y = env * this.climbSpeed;
            this.onGround = 0;
            if(this.onLadder === 'water'){
                this.vlos.y += this.gravity * delta 
            }
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
        if (buildModeActive && (this.selected.type === 'ladder'||this.selected.type === 'water')) {
            if (this.keys.held(' ')) {
                if (this._ladderPlaceCooldown === undefined) this._ladderPlaceCooldown = 0;
                this._ladderPlaceCooldown -= delta;
                if (this._ladderPlaceCooldown <= 0 && !this.blockMined) {
                    const cx = this.pos.x + this.size.x * 0.5;
                    const cy = this.pos.y + this.size.y * 0.5;
                    const placed = this.buildAtWorld(cx, cy, this.selected.type, { allowOverlap: true });
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
                const placed = this.buildAtWorld(cx, cy, this.selected.type, { allowOverlap: true });
                if (placed) {
                    this.blockPlaced = true;
                    this.mining = false;
                    this.miningProgress = 0;
                    this._lastMiningKey = null;
                }
            }
        }

        if (buildModeActive && (this.selected.type !== 'ladder' && this.selected.type !== 'water') && this.miningTarget && (this.keys.held(' ') && this.keys.held('Shift') || this.keys.pressed(' ')) && !this.blockMined) {
            let placed = this.buildAtWorld(this.miningTarget.worldPos.x + this.chunkManager.noiseTileSize*0.5, this.miningTarget.worldPos.y + this.chunkManager.noiseTileSize*0.5, this.selected.type);
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
                    const placed = this.buildAtWorld(placeX, placeY, this.selected.type);
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
    // - not hold Alt => 'base'
    // - Otherwise use this.placeLayer (usually 'base')
    _getActivePlaceLayer() {
        try {
            const alt = this.keys.held('Alt');
            const ctrl = this.keys.held('Control');
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
            // In creative mode we do not modify the player's inventory.
            if (cur.id==='water'&&(this.selected.amount <= 0 || (this.selected.type !== 'water_bucket'&&this.selected.type !== 'bucket'))){
                return false;
            }
            if (!this.creative) this.onEdit.emit(this.selectedSlot,1,cur)
            this._applySelectedSlot()
            this.chunkManager.setTileValue(sx, sy, null, layer);
            // optional: notify lighting/chunk updates elsewhere
            this.scene.lighting.markDirty();
            // clear captured mining layer after successful mine
            this._activeMiningLayer = null;
        } catch (e) { this._activeMiningLayer = null; return false; }
        return true;
    }

    /**
     * Copy block at a given world coordinate into the currently-selected slot.
     * This is similar to `pickBlock()` but targets an explicit world position
     * (useful for mouse-driven picks).
     * @param {number} worldX
     * @param {number} worldY
     * @returns {boolean}
     */
    pickBlockAtWorld(worldX, worldY){
        try{
            if(!this.chunkManager) return false;
            const { sx, sy } = this._worldToSample(worldX, worldY);
            const tile = this.chunkManager.getTileValue(sx, sy, 'any');
            if(!tile || !tile.id) return false;
            // Copy id into the currently-selected slot and update selected
            this.selected.type = tile.id;
            this.selected.rot = (tile.rot !== undefined) ? tile.rot : 0;
            this.selected.invert = (tile.invert !== undefined) ? tile.invert : false;
            // update canonical hotbar via Inventory API to ensure UI updates
            try {
                const hotbarKey = (this.inventory && this.inventory.slots && Array.isArray(this.inventory.slots.hotbar)) ? this.inventory.slots.hotbar[this.selectedSlot] : null;
                const amt = this.creative ? 9999 : 1;
                if (this.inventory && typeof this.inventory.addItem === 'function') {
                    this.inventory.addItem(this.selected.type, `hotbar/${this.selectedSlot}`, true, 'inventory', amt);
                    const newKey = (this.inventory.slots && Array.isArray(this.inventory.slots.hotbar)) ? this.inventory.slots.hotbar[this.selectedSlot] : null;
                    if (newKey && this.inventory.Inventory && this.inventory.Inventory.has(newKey)) {
                        const entry = this.inventory.Inventory.get(newKey);
                        entry.data = entry.data || {};
                        entry.data.tile = this.selected.type;
                        entry.data.id = this.selected.type;
                        entry.data.rot = this.selected.rot || 0;
                        entry.data.invert = !!this.selected.invert;
                        entry.data.amount = this.creative ? 9999 : (entry.data.amount || 0);
                    }
                } else if (hotbarKey) {
                    const slotObj = Object.assign({}, this.slots[this.selectedSlot] || {});
                    slotObj.type = this.selected.type;
                    slotObj.amount = this.creative ? 9999 : (slotObj.amount || 0);
                    slotObj.rot = slotObj.rot || this.selected.rot || 0;
                    slotObj.invert = (typeof slotObj.invert !== 'undefined') ? slotObj.invert : this.selected.invert || false;
                    this.slots[this.selectedSlot] = slotObj;
                }
            } catch (e) {}
            try { this._applySelectedSlot(); } catch (e) {}
            if (tile.layer) this.placeLayer = tile.layer;
            return true;
        }catch(e){ return false; }
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
        let name = null;
        if (this.selected.type === 'water_bucket') {tileValue = "water"; name = 'water_bucket';}

        if (this.selected.rot !== 0 || this.selected.invert !== false) {
            tileValue = { id: blockId };
            if (this.selected.rot !== 0) tileValue.rot = this.selected.rot;
            if (this.selected.invert !== false) tileValue.invert = this.selected.invert;
        }

        this.chunkManager.setTileValue(sx, sy, tileValue, layer);
        // In creative mode do not consume items from inventory
        if (!this.creative) this.onEdit.emit(this.selectedSlot,-1,name)
        this._applySelectedSlot()
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
                if (wantsUp||(this.onLadder&&this.selected.type==='ladder')) dir = new Vector(0, -1);
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

                // If player is holding Shift and interacting with a scroll entity,
                // open the scroll popup instead of mining.
                try {
                    const em = this.scene && this.scene.entityManager;
                    if (em && typeof em.getEntitiesAtSample === 'function' && this.keys.held('Shift')) {
                        const ents = em.getEntitiesAtSample(this.miningTarget.sx, this.miningTarget.sy);
                        for (const ent of ents) {
                            if (!ent || typeof ent.getComponent !== 'function') continue;
                            const scroll = ent.getComponent('scroll');
                            if (!scroll) continue;
                            const payload = {
                                key: `${this.miningTarget.sx},${this.miningTarget.sy}`,
                                data: (typeof scroll.getData === 'function') ? scroll.getData() : {
                                    title: scroll.title,
                                    lore: scroll.lore,
                                    recipe: scroll.recipe,
                                    svg: scroll.svg,
                                    icon: scroll.icon,
                                }
                            };
                            try { this.onScroll.emit(payload, ent); } catch (e) {}
                            try { if (this.keys && typeof this.keys.pause === 'function') this.keys.pause(0.18); } catch (e) {}
                            this.miningProgress = 0;
                            this._lastMiningKey = null;
                            this._activeMiningLayer = null;
                            return;
                        }
                    }
                } catch (e) {}

                // capture the active layer at the start of the mining action so
                // subsequent modifier changes don't move the mining to another layer
                const layer = this._getActivePlaceLayer();
                this._activeMiningLayer = layer;
                const maybeTile = this.chunkManager.getTileValue(this.miningTarget.sx, this.miningTarget.sy, layer);
                if (!maybeTile || !maybeTile.id) { this.miningProgress = 0; this._lastMiningKey = null; this._activeMiningLayer = null; return; }
                // If player is holding Shift and interacting with an anvil, emit craft signal instead of mining
                try{
                    if (maybeTile && (maybeTile.id === 'anvil' || maybeTile.id === 'furnace') && this.keys.held('Shift')){
                        try{ this.onCraft.emit(this.miningTarget, maybeTile); }catch(e){}
                        this.miningProgress = 0;
                        this._lastMiningKey = null;
                        this._activeMiningLayer = null;
                        return;
                    }
                }catch(e){}
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
