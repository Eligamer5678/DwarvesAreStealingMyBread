import Saver from "./Saver.js";
import Signal from "../modules/Signal.js";
import UIButton from "../UI/jsElements/Button.js";
import UIRect from "../UI/jsElements/Rect.js";
import UIText from "../UI/jsElements/Text.js";
import UITile from "../UI/jsElements/tile.js";
import Vector from "../modules/Vector.js";
import Menu from "../UI/jsElements/Menu.js";
import UISlot from "../UI/jsElements/slot.js";
import UISpriteSheet from "../UI/jsElements/SpriteSheet.js";
import Geometry from "../modules/Geometry.js";
/**
 * simple shorthand for creating a vector
 */
function v(x,y){
    return new Vector(x,y)
}

export default class InventoryManager{
    /**
     * @param {*} mainUI MainUI 
     * @param {*} player The player dwarf
     */
    constructor(mainUI, resources = null){
        //get basic components
        this.mainUI = mainUI;
        this.player = this.mainUI.player;
        this.mouse = this.mainUI.mouse;
        this.keys = this.mainUI.keys;
        // resource map (Map) containing tilemaps/sprites/blocks etc.
        this.resources = resources || (this.mainUI && this.mainUI.scene ? this.mainUI.scene.SpriteImages : null);

        // generate the menu
        this.getInventoryUI()
        // map of inventory UI items: key -> element
        this.items = new Map();
        this.slotItems = [null,null,null,null,null];

        // previous dragging state for items (key -> bool)
        this._prevDragging = new Map();
        this.mainUI.onToggleInventory.connect(()=>{ this.toggle(); })

        // setup data
        this.selected = {
            "pos":[0,0],
            "type":"",
            "amount":1,
        }
        // connect to player onEdit to update slot counts / UI as player changes
        // onEdit(slot, amount, itemName)
        // amount is treated as a delta (can be negative); itemName is optional
        this.player.onEdit.connect((slot, amount, itemName) => {
            if (!Array.isArray(this.player.slots)) this.player.slots = [null,null,null,null,null];

            const delta = Number(amount) || 0;
            // normalize itemName to id string if an object was passed
            const itemId = (itemName && typeof itemName === 'object' && itemName.id) ? itemName.id : itemName;

            // Only handle positive additions (mining) with stack/slot logic here.
            if (delta > 0 && itemId){
                const MAX_STACK = 64;
                // try preferred slot first
                let placed = false;
                try{
                    const preferred = this.player.slots[slot];
                    if (!preferred){
                        // empty preferred slot -> place here
                        this.player.slots[slot] = { type: itemId, rot: 0, invert: false, amount: 1 };
                        placed = true;
                    } else if (preferred.type === itemId && (preferred.amount || 0) < MAX_STACK){
                        preferred.amount = (preferred.amount || 0) + 1;
                        placed = true;
                    }
                }catch(e){}

                // if not placed, try to find an existing stack with same type and room
                if (!placed){
                    for (let i = 0; i < this.player.slots.length; i++){
                        try{
                            const s = this.player.slots[i];
                            if (s && s.type === itemId && (s.amount || 0) < MAX_STACK){
                                s.amount = (s.amount || 0) + 1;
                                placed = true;
                                break;
                            }
                        }catch(e){}
                    }
                }

                // if still not placed, find first empty slot
                if (!placed){
                    for (let i = 0; i < this.player.slots.length; i++){
                        try{
                            if (!this.player.slots[i]){
                                this.player.slots[i] = { type: itemId, rot: 0, invert: false, amount: 1 };
                                placed = true;
                                break;
                            }
                        }catch(e){}
                    }
                }

                // finally if all slots full, store into player.inventory (spawn item UI)
                if (!placed){
                    try{
                        // place into inventory area visually via spawnItem
                        const bg = this.menu.elements.get('itemBackground');
                        const absStart = this.menu.pos.add(this.itemBounds.pos);
                        const pos = new Vector(absStart.x + 160 - this.menu.pos.x, absStart.y + 20 - this.menu.pos.y);
                        this.spawnItem(pos, itemId, 1, 0, new Vector(64,64));
                    }catch(e){}
                }

                // Update player's selected if needed
                try{
                    if (this.player.selectedSlot != null){
                        const ps = this.player.slots[this.player.selectedSlot];
                        this.player.selected = ps && ps.type ? { type: ps.type, rot: ps.rot || 0, invert: !!ps.invert, amount: ps.amount || 0 } : { type: null, rot: 0, invert: false, amount: 0 };
                    }
                }catch(e){}

                // ensure UI reflects changes
                try{ this.syncSlotsWithPlayer(); }catch(e){}
                return;
            }

            // Otherwise (negative deltas or other edits) fall back to simple delta semantics
            try{
                const cur = this.player.slots[slot];
                if (cur && cur.type){
                    cur.amount = (cur.amount || 0) + delta;
                    if (cur.amount <= 0){
                        this.player.slots[slot] = null;
                    }
                    if (this.player.selectedSlot === slot) {
                        const ps = this.player.slots[slot];
                        this.player.selected = ps && ps.type ? { type: ps.type, rot: ps.rot || 0, invert: !!ps.invert, amount: ps.amount || 0 } : { type: null, rot: 0, invert: false, amount: 0 };
                    }
                } else {
                    if (itemId && delta > 0){
                        this.player.slots[slot] = { type: itemId, rot: 0, invert: false, amount: delta };
                        if (this.player.selectedSlot === slot) {
                            const ps = this.player.slots[slot];
                            this.player.selected = ps && ps.type ? { type: ps.type, rot: ps.rot || 0, invert: !!ps.invert, amount: ps.amount || 0 } : { type: null, rot: 0, invert: false, amount: 0 };
                        }
                    }
                }
            }catch(e){}

            try{ this.syncSlotsWithPlayer(); }catch(e){}
        })
    }

    /**
     * Register a CraftingManager instance for extended UI flows
     * @param {CraftingManager} cm
     */
    setCraftingManager(cm){ this.craftingManager = cm }

    /**
     * Open the inventory UI. If `meta` is provided and contains crafting data,
     * enter crafting mode.
     * @param {object} [meta]
     */
    open(meta){
        try{ this.menu.visible = true; }catch(e){}
        try{ this.keys.focus('Inventory'); this.mouse.focus('Inventory'); }catch(e){}
        // if meta requests crafting, enter crafting, otherwise ensure crafting is off
        try{
            if (meta && meta.type && this.craftingManager) this.enterCrafting(meta);
            else this.exitCrafting();
        }catch(e){}
        
        // Reorder inventory items in the menu so they draw after (on top of) slots
        try{
            for (const [k, el] of this.items){
                try{ this.menu.removeElement(k); }catch(e){}
                try{ this.menu.addElement(k, el); }catch(e){}
            }
        }catch(e){}
    }

    /**
     * Return combined list of all slot instances (quick + craft)
     */
    getAllSlots(){
        return (this.slots || []).concat(this.cslots || []);
    }

    /**
     * Temporary handler for craft-slot drops. For now it only positions the
     * element into the craft slot visually and records a mapping. Craft logic
     * (consuming inputs / outputs) will be implemented separately.
     */
    _handleCraftStore(slotIndex, element, prev){
        try{
            if (!this.craftItems) this.craftItems = {};
            if (!element){ this.craftItems[slotIndex] = null; return; }
            // record reference (prefer inventory key)
            const key = element._invKey || null;
            this.craftItems[slotIndex] = key || element;
            // ensure element snaps into slot visually (UISlot.collide normally does this,
            // but ensure canonical pos is set)
            try{ element.pos = this.cslots[slotIndex].pos.add(new Vector(10,10)); }catch(e){}
            // ensure element is registered with slots so it can be moved back
            try{ for (const s of this.getAllSlots()) s.assign(element); }catch(e){}
            // update canonical player.inventory if present
            try{ if (key && this.player && this.player.inventory && this.player.inventory.items){ const meta = this.player.inventory.items.get(key); if (meta){ meta.pos = element.pos.clone ? element.pos.clone() : { x: element.pos.x, y: element.pos.y }; this.player.inventory.items.set(key, meta); } } }catch(e){}
            // After placing an item into a craft slot, ask the crafting manager to
            // evaluate the current 3x3 grid and create/update an output placeholder.
            try{
                if (this.craftingManager){
                    // build 3x3 grid of item ids
                    const grid = [ ["","",""],["","",""],["","",""] ];
                    for (let i = 0; i < 9; i++){
                        const val = this.craftItems[i];
                        let el = null;
                        if (!val) { grid[Math.floor(i/3)][i%3] = ""; continue; }
                        if (typeof val === 'string') el = this.items.get(val);
                        else el = val;
                        const tid = (el && el.tile) ? el.tile : "";
                        grid[Math.floor(i/3)][i%3] = tid || "";
                    }
                    const recipe = this.craftingManager.matchGrid(grid);
                    // output slot is last (index 9) in this.cslots
                    try{
                        const outSlot = (this.cslots && this.cslots.length > 9) ? this.cslots[9] : null;
                        // remove existing placeholder if recipe doesn't match
                        if (!recipe){
                            try{ if (this.craftOutputKey) { this.removeItem(this.craftOutputKey); this.craftOutputKey = null; } }catch(e){}
                            try{ if (this.craftingManager) this.craftingManager.clearPreview(); }catch(e){}
                        } else {
                            // ensure placeholder exists and shows the recipe output
                            if (!this.craftOutputKey){
                                try{
                                    const elSize = outSlot ? outSlot.size.clone().sub(new Vector(16,16)) : v(112,112);
                                    const topLeft = outSlot ? outSlot.pos.add(outSlot.size.sub(elSize).div(2)) : new Vector(this.menu.pos.x+600,this.menu.pos.y+200);
                                    const placeholder = this.getUISpriteFor(recipe.output, topLeft.clone(), elSize.clone(), 3, true);
                                    if (placeholder){
                                        placeholder.dragBounds = this.itemBounds;
                                        placeholder.passcode = "Inventory";
                                        placeholder.data = placeholder.data || {};
                                        placeholder.data.amount = recipe.amount || 1;
                                        placeholder._isCraftPlaceholder = true;
                                        placeholder._craftRecipe = recipe;
                                        const keyOut = `craft_output`;
                                        placeholder._invKey = keyOut;
                                        // when player releases the placeholder (after dragging), convert into real item
                                        try{ if (!placeholder._craftReleaseAttached){ placeholder.onRelease.connect(()=>{
                                            try{
                                                // guard against double invocation
                                                if (placeholder._consumed) return;
                                                // if still inside output slot, do nothing
                                                const absPos = placeholder.pos.add(placeholder.offset || new Vector(0,0));
                                                const center = absPos.add(placeholder.size.div(2));
                                                if (outSlot && Geometry.pointInRect(center, outSlot.pos.add(outSlot.offset||new Vector(0,0)), outSlot.size)){
                                                    return;
                                                }
                                                // mark consumed and remove placeholder immediately to avoid duplicate spawns
                                                placeholder._consumed = true;
                                                try{ if (this.craftOutputKey){ const keyToRemove = this.craftOutputKey; this.craftOutputKey = null; this.removeItem(keyToRemove); } }catch(e){}
                                                try{ if (this.craftingManager) this.craftingManager.clearPreview(); }catch(e){}
                                                // spawn actual crafted item at current position
                                                try{ this.spawnItem(placeholder.pos.clone(), recipe.output, recipe.amount || 1, 0, placeholder.size.clone()); }catch(e){}
                                                // consume one unit from each input slot specified by recipe
                                                try{
                                                    for (let si = 0; si < 9; si++){
                                                        const ry = Math.floor(si/3); const rx = si%3;
                                                        const need = (recipe.input && recipe.input[ry] && recipe.input[ry][rx]) ? recipe.input[ry][rx] : "";
                                                        if (!need) continue;
                                                        const stored = this.craftItems[si];
                                                        if (!stored) continue;
                                                        let sourceKey = null;
                                                        if (typeof stored === 'string') sourceKey = stored;
                                                        else if (stored && stored._invKey) sourceKey = stored._invKey;
                                                        // if sourceKey maps to a quickslot element
                                                        let handled = false;
                                                        try{
                                                            const oldSlot = this.slotItems.indexOf(sourceKey);
                                                            if (oldSlot !== -1){
                                                                const smeta = this.player.slots[oldSlot];
                                                                if (smeta){
                                                                    smeta.amount = (smeta.amount || 0) - 1;
                                                                    if (smeta.amount <= 0){ this.player.slots[oldSlot] = null; this.slotItems[oldSlot] = null; }
                                                                    handled = true;
                                                                }
                                                            }
                                                        }catch(e){}
                                                        // if not quickslot, try inventory map entries
                                                        if (!handled && sourceKey && this.player.inventory && this.player.inventory.items && this.player.inventory.items.has(sourceKey)){
                                                            try{
                                                                const meta = this.player.inventory.items.get(sourceKey);
                                                                meta.amount = (meta.amount || 0) - 1;
                                                                if (meta.amount <= 0){ this.player.inventory.items.delete(sourceKey); this.removeItem(sourceKey); }
                                                                else { this.player.inventory.items.set(sourceKey, meta); const el = this.items.get(sourceKey); if (el) el.data.amount = meta.amount; }
                                                                handled = true;
                                                            }catch(e){}
                                                        }
                                                        // if still not handled, try to find UI element and decrement or remove
                                                        if (!handled){
                                                            try{
                                                                const el = (typeof stored === 'string') ? this.items.get(stored) : stored;
                                                                if (el){ el.data = el.data || {}; el.data.amount = (el.data.amount || 1) - 1; if (el.data.amount <= 0){ const findKey = Array.from(this.items.entries()).find(([k,v])=>v===el)?.[0]; if (findKey) this.removeItem(findKey); } }
                                                            }catch(e){}
                                                        }
                                                        // clear craft slot
                                                        try{ this.craftItems[si] = null; const cs = this.cslots[si]; if (cs && cs._prevStored) cs._prevStored = null; }catch(e){}
                                                    }
                                                }catch(e){}
                                                // after consuming, refresh UI slots and crafting output
                                                try{ this.syncSlotsWithPlayer(); }catch(e){}
                                                try{ // rebuild grid and re-evaluate
                                                    const newGrid = [["","",""],["","",""],["","",""]];
                                                    for (let ii=0; ii<9; ii++){ const v = this.craftItems[ii]; let el2 = null; if (!v) { newGrid[Math.floor(ii/3)][ii%3] = ""; continue;} if (typeof v === 'string') el2 = this.items.get(v); else el2 = v; newGrid[Math.floor(ii/3)][ii%3] = (el2 && el2.tile) ? el2.tile : ""; }
                                                    const newRec = this.craftingManager.matchGrid(newGrid);
                                                    if (!newRec){ try{ if (this.craftOutputKey){ this.removeItem(this.craftOutputKey); this.craftOutputKey = null; } }catch(e){} }
                                                    else {
                                                        // update placeholder amount if still present
                                                        try{ if (this.craftOutputKey){ const p = this.items.get(this.craftOutputKey); if (p) p.data.amount = newRec.amount || 1; } }catch(e){}
                                                    }
                                                }catch(e){}
                                            }catch(e){}
                                        }); placeholder._craftReleaseAttached = true; } }catch(e){}
                                        try{ this.menu.addElement(keyOut, placeholder); }catch(e){}
                                        this.items.set(keyOut, placeholder);
                                        this.craftOutputKey = keyOut;
                                        try{ if (this.craftingManager) this.craftingManager.setPreview(recipe); }catch(e){}
                                        // ensure assigned to slots
                                        try{ for (const s of this.getAllSlots()) s.assign(placeholder); }catch(e){}
                                    }
                                }catch(e){}
                            } else {
                                // if placeholder exists, update amount
                                try{ const p = this.items.get(this.craftOutputKey); if (p) p.data.amount = recipe.amount || 1; }catch(e){}
                            }
                        }
                    }catch(e){}
                }
            }catch(e){}
        }catch(e){}
    }

    /**
     * Close the inventory UI and exit any crafting mode.
     */
    close(){
        try{ this.menu.visible = false; }catch(e){}
        try{ this.exitCrafting(); }catch(e){}
        try{ this.keys.unfocus(); this.mouse.unfocus(); }catch(e){}
    }

    /**
     * Toggle the inventory UI. If opening and `meta` is provided it will be used.
     * @param {object} [meta]
     */
    toggle(meta){
        try{
            if (this.menu && this.menu.visible) { this.close(); }
            else { this.open(meta); }
        }catch(e){
            // fallback: invert visible
            try{ this.menu.visible = !(this.menu.visible); }catch(e){}
        }
    }

    /**
     * Enter crafting mode: expand the inventory UI to show the crafting area
     * @param {object} meta - meta describing crafting area (e.g. { type:'anvil', size:[3,3], target })
     */
    enterCrafting(meta){
        if (this._crafting) return;
        this._crafting = true;
        this._craftMeta = meta || {};
        // remember original sizes so we can restore
        try{ this._origMenuSize = this.menu.size.clone(); }catch(e){ this._origMenuSize = this.menu.size ? { x: this.menu.size.x, y: this.menu.size.y } : null }
        try{ this._origItemBounds = { pos: this.itemBounds.pos.clone(), size: this.itemBounds.size.clone() }; }catch(e){ this._origItemBounds = { pos: this.itemBounds.pos, size: this.itemBounds.size } }
        // expand menu and item area to the right by 384 pixels (approx 3 slots)
        try{ this.menu.size.x = (this.menu.size.x || 0) + 444; }catch(e){}
        try{ this.itemBounds.size.x = (this.itemBounds.size.x || 0) + 444; }catch(e){}
        // ensure all inventory UI elements have dragBounds updated and are inside bounds
        try{
            for (const [k, el] of this.items){
                try{ el.dragBounds = this.itemBounds; }catch(e){}
                try{
                    // clamp element.pos to itemBounds area (relative to menu)
                    if (el.pos && el.size){
                        const minX = this.itemBounds.pos.x;
                        const minY = this.itemBounds.pos.y;
                        const maxX = this.itemBounds.pos.x + this.itemBounds.size.x - el.size.x;
                        const maxY = this.itemBounds.pos.y + this.itemBounds.size.y - el.size.y;
                        let nx = Math.max(minX, Math.min(maxX, el.pos.x));
                        let ny = Math.max(minY, Math.min(maxY, el.pos.y));
                        el.pos = el.pos.clone ? new Vector(nx, ny) : { x: nx, y: ny };
                    }
                }catch(e){}
            }
        }catch(e){}

        // create crafting slot grid in the expanded area if not already present
        try{
            if (!this.cslots){
                this.cslots = [];
                this.craftItems = {};
                // layout: create a 3x3 crafting input grid + one output slot below (total 10 slots)
                const cols = 3; const gridRows = 3;
                // compute starting position inside the expanded area to the right
                const origWidth = (this._origItemBounds && this._origItemBounds.size && this._origItemBounds.size.x) ? this._origItemBounds.size.x : 750;
                const startX = (this.itemBounds.pos.x || 220) + origWidth + 24; // right of original item area
                const startY = (this.itemBounds.pos.y || 10) + 10;
                const slotSpacingX = 128 + 10;
                const slotSpacingY = 138;
                // crafting input grid (3x3)
                for (let r = 0; r < gridRows; r++){
                    for (let c = 0; c < cols; c++){
                        const idx = r*cols + c; // 0..8
                        const pos = v(startX + c*slotSpacingX, startY + r*slotSpacingY);
                        const s = new UISlot(pos, v(128,128), 2, "#242424ff", 'craft', idx);
                        s.mouse = this.mouse;
                        s.passcode = "Inventory";
                        s.color = '#111111'
                        // wire the store event to a craft handler (non-destructive for now)
                        try{ s.onStore.connect((el, prev) => { this._handleCraftStore(idx, el, prev); }); }catch(e){}
                        this.menu.addElement(`craft_slot_${r}_${c}`, s);
                        this.cslots.push(s);
                    }
                }
                // single output slot centered under the grid two rows below (row index 4)
                try{
                    const outRow = 4;
                    const outCol = 1; // center column
                    const outIdx = gridRows * cols; // 9
                    const outPos = v(startX + outCol*slotSpacingX, startY + outRow*slotSpacingY);
                    const outSlot = new UISlot(outPos, v(128,128), 2, "#2a2a2aff", 'craft_output', outIdx);
                    outSlot.mouse = this.mouse;
                    outSlot.passcode = "Inventory";
                    try{ outSlot.onStore.connect((el, prev) => { this._handleCraftStore(outIdx, el, prev); }); }catch(e){}
                    this.menu.addElement(`craft_output_slot`, outSlot);
                    this.cslots.push(outSlot);
                }catch(e){}
                // register existing items with craft slots as well
                try{ for (const [k, el] of this.items) { try{ for (const s of this.cslots) s.assign(el); }catch(e){} } }catch(e){}
            }
        }catch(e){}
    }

    /**
     * Exit crafting mode and restore inventory UI
     */
    exitCrafting(){
        if (!this._crafting) return;
        this._crafting = false;
        this._craftMeta = null;
        try{
            // restore menu size fully (x and y) if available
            if (this._origMenuSize && this.menu && this.menu.size) {
                try{ this.menu.size.x = this._origMenuSize.x; }catch(e){}
                try{ this.menu.size.y = this._origMenuSize.y; }catch(e){}
            }
            // Restore itemBounds by mutating the existing size object so any UIRect
            // instance that references it will observe the change. If the original
            // sizes were stored as clones, use their numeric components.
            if (this._origItemBounds && this.itemBounds){
                try{
                    if (this.itemBounds.size && this._origItemBounds.size){
                        const ox = this._origItemBounds.size.clone ? this._origItemBounds.size.clone().x : this._origItemBounds.size.x;
                        const oy = this._origItemBounds.size.clone ? this._origItemBounds.size.clone().y : this._origItemBounds.size.y;
                        this.itemBounds.size.x = ox;
                        this.itemBounds.size.y = oy;
                    } else {
                        this.itemBounds.size = this._origItemBounds.size.clone ? this._origItemBounds.size.clone() : this._origItemBounds.size;
                    }
                    if (this.itemBounds.pos && this._origItemBounds.pos){
                        const px = this._origItemBounds.pos.clone ? this._origItemBounds.pos.clone().x : this._origItemBounds.pos.x;
                        const py = this._origItemBounds.pos.clone ? this._origItemBounds.pos.clone().y : this._origItemBounds.pos.y;
                        this.itemBounds.pos.x = px;
                        this.itemBounds.pos.y = py;
                    }
                }catch(e){}
                // also update the actual UIRect element if present so its visual size matches
                try{
                    const bg = this.menu.elements.get('itemBackground');
                    if (bg && bg.size){ bg.size.x = this.itemBounds.size.x; bg.size.y = this.itemBounds.size.y; }
                }catch(e){}
            }
        }catch(e){}
        // update drag bounds back to normal
        try{ 
            for (const [k, el] of this.items){ 
                try{ 
                    // ensure element drag bounds are reset
                    el.dragBounds = this.itemBounds; 
                }catch(e){}
                try{
                    // clamp element position into the itemBounds AABB so no element remains outside
                    if (el && el.pos && el.size){
                        const minX = this.itemBounds.pos.x;
                        const minY = this.itemBounds.pos.y;
                        const maxX = this.itemBounds.pos.x + this.itemBounds.size.x - el.size.x;
                        const maxY = this.itemBounds.pos.y + this.itemBounds.size.y - el.size.y;
                        const nx = Math.max(minX, Math.min(maxX, el.pos.x));
                        const ny = Math.max(minY, Math.min(maxY, el.pos.y));
                        // only update if changed
                        if (nx !== el.pos.x || ny !== el.pos.y){
                            try{ el.pos = el.pos.clone ? new Vector(nx, ny) : { x: nx, y: ny }; }catch(e){}
                            // update canonical store if this element is tracked
                            try{ if (el._invKey && this.player && this.player.inventory && this.player.inventory.items){ const meta = this.player.inventory.items.get(el._invKey); if (meta){ meta.pos = el.pos.clone ? el.pos.clone() : { x: el.pos.x, y: el.pos.y }; this.player.inventory.items.set(el._invKey, meta); } } }catch(e){}
                        }
                    }
                }catch(e){}
            } 
        }catch(e){}
    }

    /**
     * Helper to handle when a UISlot reports an element being dropped into it.
     * @param {number} slotIndex
     * @param {object} element UI element instance
     * @param {object|null} prev previously stored element (may be null)
     */
    _handleStore(slotIndex, element){
        if (!element) {
            this.player.slots[slotIndex] = null;
            return;
        }

        const MAX_STACK = 64;
        // find inventory key for element (if any)
        const key = element._invKey || Array.from(this.items.entries()).find(([k,v])=>v===element)?.[0];

        // determine source slot (if element represented a slot item)
        const oldSlot = this.slotItems.indexOf(key);

        const incomingType = element.tile;
        const incomingAmount = (element.data && typeof element.data.amount === 'number') ? element.data.amount : 1;

        // destination existing slot meta
        const dest = (this.player.slots && this.player.slots[slotIndex]) ? this.player.slots[slotIndex] : null;

        // If destination has same type, attempt to merge
        if (dest && dest.type === incomingType){
            const destAmt = dest.amount || 0;
            const space = Math.max(0, MAX_STACK - destAmt);
            if (space > 0){
                const toMove = Math.min(space, incomingAmount);
                dest.amount = destAmt + toMove;

                const remaining = incomingAmount - toMove;

                // If the incoming element was backed by an inventory entry (key), update or remove it
                if (key && this.player.inventory && this.player.inventory.items && this.player.inventory.items.has(key)){
                    if (remaining > 0){
                        // update the UI element and canonical meta with remaining amount
                        try{ element.data.amount = remaining; }catch(e){}
                        try{ const meta = this.player.inventory.items.get(key); if (meta) { meta.amount = remaining; this.player.inventory.items.set(key, meta); } }catch(e){}
                    } else {
                        // consumed fully: remove UI element and canonical entry
                        try{ this.removeItem(key); }catch(e){}
                        try{ this.player.inventory.items.delete(key); }catch(e){}
                    }
                } else if (oldSlot !== -1){
                    // incoming element came from another quickslot (oldSlot)
                    try{
                        const oldMeta = this.player.slots[oldSlot];
                        if (oldMeta){
                            const oldAmt = oldMeta.amount || 0;
                            const newOldAmt = Math.max(0, oldAmt - toMove);
                            if (newOldAmt > 0){
                                oldMeta.amount = newOldAmt;
                                this.player.slots[oldSlot] = oldMeta;
                            } else {
                                this.player.slots[oldSlot] = null;
                            }
                        }
                    }catch(e){}
                }

                // If the incoming element originated from a quickslot UI element, update or remove that element
                if (oldSlot !== -1){
                    try{
                        const sourceKey = this.slotItems[oldSlot];
                        const sourceEl = sourceKey ? this.items.get(sourceKey) : null;
                        if (sourceEl){
                            if (remaining > 0){
                                // update displayed amount on the source element
                                try{ sourceEl.data = sourceEl.data || {}; sourceEl.data.amount = remaining; }catch(e){}
                            } else {
                                // fully consumed: remove the source UI element
                                try{ if (sourceKey) this.removeItem(sourceKey); else this.removeItem(Array.from(this.items.entries()).find(([k,v])=>v===sourceEl)?.[0]); }catch(e){}
                                try{ this.slotItems[oldSlot] = null; }catch(e){}
                            }
                        }
                    }catch(e){}
                }

                // ensure selected slot reflects changes
                if (this.player.selectedSlot === slotIndex){
                    const ps = this.player.slots[slotIndex];
                    this.player.selected = ps && ps.type ? { type: ps.type, rot: ps.rot || 0, invert: !!ps.invert, amount: ps.amount || 0 } : { type: null, rot: 0, invert: false, amount: 0 };
                }

                // if there is leftover (remaining > 0) and it wasn't already left as element, ensure it's present in inventory
                if (remaining > 0){
                    // if element still exists as a UI inventory item (key present), we've already updated it; otherwise spawn a new inventory element
                    if (!(key && this.player.inventory && this.player.inventory.items && this.player.inventory.items.has(key))){
                        // spawn a new item representing the remainder at the element's current position
                        try{
                            const pos = element.pos ? element.pos.clone() : null;
                            this.spawnItem(pos || new Vector(this.menu.pos.x+200,this.menu.pos.y+20), incomingType, remaining, element.rot || 0, element.size ? element.size.clone() : new Vector(64,64));
                        }catch(e){}
                    }
                }

                // sync UI
                // ensure a UI element exists for the destination slot (some flows left player data updated but no slot element)
                try{
                    if (!this.slotItems[slotIndex]){
                        const slotEl = this.slots[slotIndex];
                        const elSize = slotEl.size.clone().sub(new Vector(16,16));
                        const topLeft = slotEl.pos.add(slotEl.size.sub(elSize).div(2));
                        const newEl = this.getUISpriteFor(incomingType, topLeft.clone(), elSize.clone(), 3, true);
                        if (newEl){
                            newEl.dragBounds = this.itemBounds;
                            newEl.passcode = "Inventory";
                            newEl.data = newEl.data || {};
                            newEl.data.amount = (this.player.slots && this.player.slots[slotIndex]) ? (this.player.slots[slotIndex].amount || 0) : (incomingAmount || 0);
                            try{ newEl.rot = (this.player.slots && this.player.slots[slotIndex]) ? (this.player.slots[slotIndex].rot || 0) : (element.rot || 0); }catch(e){}
                            try{ newEl.invert = (this.player.slots && this.player.slots[slotIndex]) ? (this.player.slots[slotIndex].invert ? new Vector(-1,1) : new Vector(1,1)) : (element.invert || new Vector(1,1)); }catch(e){}
                            const key = `slotItem_${slotIndex}`;
                            try{ newEl._invKey = key; }catch(e){}
                            try{ if (!newEl._slotReleaseAttached) { newEl.onRelease.connect(()=>{ this.getAllSlots().forEach((s)=>{ try{ s.collide(newEl) }catch(e){} }) }); newEl._slotReleaseAttached = true; } }catch(e){}
                                        try{ this.menu.addElement(key, newEl); }catch(e){}
                            this.items.set(key, newEl);
                                        try{ for (const s of this.getAllSlots()) s.assign(newEl); }catch(e){}
                            this.slotItems[slotIndex] = key;
                            // remove any canonical inventory entry for this key (shouldn't exist)
                            try{ if (this.player && this.player.inventory && this.player.inventory.items) this.player.inventory.items.delete(key); }catch(e){}
                        }
                    }
                }catch(e){}
                try{ this.syncSlotsWithPlayer(); }catch(e){}
                return;
            }
            // if space === 0, can't merge — fall through to replace behavior
        }

        // At this point, either dest is null or different type, or dest is full.
        // If the slot currently had an element (different type), move it back into inventory
        if (this.slotItems[slotIndex]){
            const prevKey = this.slotItems[slotIndex];
            const prevEl = this.items.get(prevKey);
            if (prevEl) {
                // restore previous element into inventory area
                try{ this._restoreInventoryEntry(prevKey, prevEl); }catch(e){}
            }
            this.slotItems[slotIndex] = null;
            this.player.slots[slotIndex] = null;
        }

        // Now place incoming element into the slot: if it had a key, remove canonical inventory entry
        if (key){
            this.slotItems[slotIndex] = key;
            try{ this._removeInventoryEntryByKey(key); }catch(e){}
            try{ this.player.inventory.items.delete(key); }catch(e){}
        }

        // write structured slot object to player.slots
        this.player.slots[slotIndex] = { type: incomingType, rot: element.rot, invert: element.invert, amount: incomingAmount };
        // if this slot is currently selected by the player, update player's selected (normalized)
        if (this.player.selectedSlot === slotIndex){
            const ps = this.player.slots[slotIndex];
            this.player.selected = ps && ps.type ? { type: ps.type, rot: ps.rot || 0, invert: !!ps.invert, amount: ps.amount || 0 } : { type: null, rot: 0, invert: false, amount: 0 };
        }

        // if the element came from another slot, clear that old slot now
        if (oldSlot !== -1 && oldSlot !== slotIndex){
            try{ this.slotItems[oldSlot] = null; }catch(e){}
            try{ this.player.slots[oldSlot] = null; }catch(e){}
        }

        // ensure UI elements are synced
        try{ this.syncSlotsWithPlayer(); }catch(e){}
    }
    /**
     * Setup the inventory menu
     */
    getInventoryUI(){
        // Create the base menu
        this.menu = new Menu(this.mouse,this.keys,v(20,180),v(980,720),2,"#383838ff",true) // grab data needed from MainUI
        this.menu.passcode = "Inventory"
        this.menu.visible = false;
        this.itemBounds = {
            "pos":v(220,10),
            "size":v(750,700)
        }
        // Create the background for the item display
        const itemBackground = new UIRect(this.itemBounds.pos,this.itemBounds.size,2,"#222222FF")
        itemBackground.mouse = this.mouse;
        itemBackground.mask = true;
        this.menu.addElement('itemBackground',itemBackground)
        
        // Display the player on the UI
        const spriteRect = new UIRect(v(10,10),v(200,200),3,"#000000")
        this.menu.addElement('spriteRect',spriteRect)
        const funnyGuy = new UISpriteSheet(this.player.baseSheet,v(10,10),v(200,200),4,'mine')
        this.menu.addElement('funnyGuy',funnyGuy)
        
        // Create the slot bg
        this.menu.addElement('slotBg',new UIRect(v(220,10),v(150,700),2,"#181818ff"))
        // create UISlot instances instead of plain rects so they can accept drops
        this.slots = [
            new UISlot(v(230,20),v(128,128),2,"#242424ff"),
            new UISlot(v(230,158),v(128,128),2,"#242424ff"),
            new UISlot(v(230,296),v(128,128),2,"#242424ff"),
            new UISlot(v(230,434),v(128,128),2,"#242424ff"),
            new UISlot(v(230,572),v(128,128),2,"#242424ff"),
        ]
        for (let i = 0; i < this.slots.length; i++){
            const s = this.slots[i];
            s.mouse = this.mouse;
            s.passcode = "Inventory";
            // wire the store event
            try{ s.onStore.connect((el, prev) => { this._handleStore(i, el, prev); }); }catch(e){}
            this.menu.addElement(`slot${i}`, s)
        }

        this.mainUI.menu.addElement('inventory',this.menu)

        // Ensure UI reflects current player slots at creation
        try{ this.syncSlotsWithPlayer(); }catch(e){}
    }




    /**
     * Ensure UI slot elements match `this.player.slots`.
     * - If the player has an item in a slot but UI doesn't, create one.
     * - If the UI has an item but the player doesn't, remove it.
     * - If the UI item exists but with a different tile, replace it.
     */
    syncSlotsWithPlayer(){
        if (!this.slots || !this.player) return;
        for (let i = 0; i < this.slots.length; i++){
            // player.slots entries are now either null or objects: {type,rot,invert,amount}
            const desiredSlot = (this.player.slots && this.player.slots[i]) ? this.player.slots[i] : null;
            const existingKey = this.slotItems[i];
            let existingEl = existingKey ? this.items.get(existingKey) : null;

            if (desiredSlot && desiredSlot.type){
                // Need a UI element for this tile
                // If slot references an existing element by key, prefer that element
                if (desiredSlot.key && this.items.has(desiredSlot.key)){
                    existingEl = this.items.get(desiredSlot.key);
                    // ensure it's positioned in the slot
                    try{ const topLeft = this.slots[i].pos.add(this.slots[i].size.sub(existingEl.size).div(2)); existingEl.pos = topLeft.clone(); }catch(e){}
                    this.slotItems[i] = desiredSlot.key;
                }
                if (existingEl && existingEl.tile === desiredSlot.type){
                    // already correct, but ensure amount is synced
                    try{ existingEl.data = existingEl.data || {}; existingEl.data.amount = desiredSlot.amount || 0; }catch(e){}
                    continue;
                }

                // remove existing mismatched element
                if (existingKey){
                    this.removeItem(existingKey);
                    this.slotItems[i] = null;
                }

                // create a new UI element sized to fit the slot
                const slot = this.slots[i];
                const elSize = slot.size.clone().sub(new Vector(16,16));
                const topLeft = slot.pos.add(slot.size.sub(elSize).div(2));
                const element = this.getUISpriteFor(desiredSlot.type, topLeft.clone(), elSize.clone(), 3, true);
                if (!element) continue;
                element.dragBounds = this.itemBounds;
                element.passcode = "Inventory";
                // attach amount data from player slot
                element.data = element.data || {};
                element.data.amount = desiredSlot.amount || 0;
                // apply rotation and invert from slot meta (invert stored as boolean)
                try{
                    element.rot = desiredSlot.rot || 0;
                    element.invert = (desiredSlot.invert) ? new Vector(-1,1) : new Vector(1,1);
                }catch(e){}
                // ensure the element will trigger slot collision checks when released (attach once)
                try{ if (!element._slotReleaseAttached) { element.onRelease.connect(()=>{ this.getAllSlots().forEach((s)=>{ try{ s.collide(element) }catch(e){} }) }); element._slotReleaseAttached = true; } }catch(e){}
                // If the player-side slot references a specific UI key, use it
                const key = desiredSlot.key ? desiredSlot.key : `slotItem_${i}`;
                this.menu.addElement(key, element);
                try{ element._invKey = key; }catch(e){}
                this.items.set(key, element);
                // if this was a slot-associated element, remove from player.inventory
                try{ this._removeInventoryEntryByKey(key); }catch(e){}
                // register this slot element with all UISlots so it can be dragged between them
                try{ for (const s of this.slots) s.assign(element); }catch(e){}
                this.spawnedItems = (this.spawnedItems||[]).filter(s=>s.key!==key);
                this.slotItems[i] = key;
            } else {
                // player has no item in this slot -> remove any UI element
                if (existingKey){
                    // move the element back into inventory rather than deleting
                    const el = this.items.get(existingKey);
                    if (el) this._restoreInventoryEntry(existingKey, el);
                    this.slotItems[i] = null;
                }
            }
        }
    }

    /**
     * Create a UI element for the given item/block name.
     * - If the name corresponds to a block in `this.resources.get('blocks')`, returns a `UITile`
     * - Otherwise if a spritesheet resource exists for the name, returns a `UISpriteSheet`
     * @param {string} name
     * @param {Vector} [pos]
     * @param {Vector} [size]
     * @param {number} [layer]
     * @returns {object|null} UI element (UITile or UISpriteSheet) or null if not found
     */
    getUISpriteFor(name, pos = new Vector(0,0), size = new Vector(16,16), layer = 2, draggable = true){
        const res = this.resources || (this.mainUI && this.mainUI.scene ? this.mainUI.scene.SpriteImages : null);
        if (!res) return null;
        if (res.has && res.has('blocks')){
            const blocks = res.get('blocks');
            if (blocks && blocks instanceof Map && blocks.has(name)){
                const meta = blocks.get(name);
                const tex = meta.texture;
                if (tex && tex.tilemap && res.has(tex.tilemap)){
                    const sheet = res.get(tex.tilemap);
                    const t = new UITile(sheet, pos.clone(), size.clone(), layer, 0, new Vector(1,1), 1, false, this.mouse, draggable);
                    t.tile = name;
                    t.data = t.data || {};
                    t.data.amount = t.data.amount || 1;
                    return t;
                }
            }
        }
        return null;
    }

    /**
     * Spawn a number of random items inside the item background area.
     * Spawned items will be clamped to the itemBackground rect.
     * @param {number} count
     * @param {Vector} [itemSize]
     */
    spawnRandomItems(count = 8, itemSize = new Vector(64,64)){
        const bg = this.menu.elements.get('itemBackground');
        if (!bg) return;
        // absolute bounds of background. Prefer `this.itemBounds` when available.
        let absStart, absSize;
        if (this.itemBounds && this.itemBounds.pos && this.itemBounds.size){
            try{ absStart = this.menu.pos.add(this.itemBounds.pos); }catch(e){ absStart = bg.offset.add(bg.pos); }
            absSize = this.itemBounds.size;
        } else {
            absStart = bg.offset.add(bg.pos);
            absSize = bg.size;
        }

        // build candidate list: block ids and sprite keys
        const res = this.resources || (this.mainUI && this.mainUI.scene ? this.mainUI.scene.SpriteImages : null);
        if (!res) return;
        const candidates = [];
        try{
            if (res.has && res.has('blocks')){
                const blocks = res.get('blocks');
                if (blocks && blocks instanceof Map){
                    for (const k of blocks.keys()) candidates.push({ type: 'block', key: k });
                }
            }
        }catch(e){}

        if (candidates.length === 0) return;

        this.spawnedItems = this.spawnedItems || [];
        for (let i = 0; i < count; i++){
            const pick = candidates[Math.floor(Math.random()*candidates.length)];
            // random position within bounds (absolute)
            // avoid spawning over slots by leaving a left margin
            const leftMargin = absStart.x + 148;
            const minX = Math.max(absStart.x, leftMargin);
            const maxX = Math.max(minX, absStart.x + absSize.x - itemSize.x);
            const minY = absStart.y;
            const maxY = Math.max(minY, absStart.y + absSize.y - itemSize.y);
            const rx = minX + Math.floor(Math.random() * Math.max(1, (maxX - minX + 1)));
            const ry = minY + Math.floor(Math.random() * Math.max(1, (maxY - minY + 1)));
            // convert to position relative to menu
            const relX = rx - this.menu.pos.x;
            const relY = ry - this.menu.pos.y;
            const pos = new Vector(relX, relY);

            try{ this.spawnItem(pos, pick.key, 1, 0, itemSize); }catch(e){}
        }
    }

    /**
     * Spawn a single inventory item into the UI and canonical player.inventory.
     * @param {Vector} pos position relative to menu
     * @param {string} type block/sprite id
     * @param {number} [amount]
     * @param {number} [rot]
     * @param {Vector} [size]
     * @returns {string|null} key of spawned element or null
     */
    spawnItem(pos, type, amount = 1, rot = 0, size = new Vector(64,64)){
        try{
            if (!pos || !type) return null;
            const element = this.getUISpriteFor(type, pos, size.clone(), 3, true);
            if (!element) return null;
            element.dragBounds = this.itemBounds;
            element.passcode = "Inventory";
            element.data = element.data || {};
            element.data.amount = amount || 1;
            element.rot = rot || 0;
            try{ if (!element._slotReleaseAttached) { element.onRelease.connect(()=>{ this.getAllSlots().forEach((slot)=>{ try{ slot.collide(element) }catch(e){} }) }); element._slotReleaseAttached = true; } }catch(e){}
            const key = `spawnItem_${Date.now()}_${Math.floor(Math.random()*100000)}`;
            this.menu.addElement(key, element);
            this.items.set(key, element);
            // canonical store
            try{
                if (this.player && this.player.inventory && this.player.inventory.items){
                    const meta = { key, type, pos: element.pos ? element.pos.clone() : null, size: size.clone(), rot: rot || 0, invert: !!element.invert, amount: amount || 1 };
                    this.player.inventory.items.set(key, meta);
                }
            }catch(e){}
            // register element with slots
            try{ for (const s of this.getAllSlots()) s.assign(element); }catch(e){}
            return key;
        }catch(e){ return null; }
    }

    

    /**
     * Update inventory manager (handle drop into slots)
     * @param {number} delta
     */
    update(delta){
        if (!this.slots || this.slots.length === 0) return;
        // If we have no items yet, attempt to spawn once (helps if resources loaded after ctor)
        if ((this.items && this.items.size === 0) && !this._spawnedOnce){
            this.spawnRandomItems(8, v(112,112));
            this._spawnedOnce = true;
        }
        // Keep UI slots in sync with the player's inventory
        this.syncSlotsWithPlayer();

    }

    /**
     * Return array of all tracked inventory UI elements
     */
    getAllItems(){
        return Array.from(this.items.values());
    }

    /**
     * Iterate over all inventory UI elements
     * @param {function(string, object)} fn (key, element)
     */
    forEachItem(fn){
        for (const [k,v] of this.items) {
            try{ fn(k,v); }catch(e){}
        }
    }

    /**
     * Remove an inventory UI element by key
     */
    removeItem(key){
        try{
            const el = this.items.get(key);
            if (el && el.onRemove) try{ el.onRemove.emit(); }catch(e){}
            this.items.delete(key);
            try{ this.menu.removeElement(key); }catch(e){}
        }catch(e){}
    }

    /**
     * Remove an entry from the spawnedItems list by key (does not remove the UI element)
     * @param {string} key
     */
    _removeInventoryEntryByKey(key){
        try{
            // also remove from player.inventory if present
            try{ if (this.player && this.player.inventory && this.player.inventory.items) this.player.inventory.items.delete(key); }catch(e){}
        }catch(e){}
    }

    /**
     * Add an existing UI element back into the inventory area (spawnedItems) so it's draggable
     * and registered with slots. This does not duplicate the element if it's already present.
     * @param {string} key
     * @param {object} element
     */
    _addInventoryEntry(key, element){
        try{
            if (!key || !element) return;
            // ensure items map contains it
            if (!this.items.has(key)){
                this.items.set(key, element);
            }
            // ensure menu contains it
            try{
                if (!this.menu.elements.has(key)) this.menu.addElement(key, element);
            }catch(e){}
            // tag and settings
            try{ element._invKey = key; }catch(e){}
            element.passcode = element.passcode || "Inventory";
            element.dragBounds = element.dragBounds || this.itemBounds;
            try{ if (!element._slotReleaseAttached) { element.onRelease.connect(()=>{ this.getAllSlots().forEach((s)=>{ try{ s.collide(element) }catch(e){} }) }); element._slotReleaseAttached = true; } }catch(e){}

            // position element somewhere inside itemBackground bounds (relative to menu)
            try{
                const absStart = this.menu.pos.add(this.itemBounds.pos);
                const absSize = this.itemBounds.size;
                const leftMargin = absStart.x + 148;
                const minX = Math.max(absStart.x, leftMargin);
                const maxX = Math.max(minX, absStart.x + absSize.x - element.size.x);
                const minY = absStart.y;
                const maxY = Math.max(minY, absStart.y + absSize.y - element.size.y);
                const rx = minX + Math.floor(Math.random() * Math.max(1, (maxX - minX + 1)));
                const ry = minY + Math.floor(Math.random() * Math.max(1, (maxY - minY + 1)));
                element.pos = new Vector(rx - this.menu.pos.x, ry - this.menu.pos.y);
            }catch(e){}

            // register element with all slots so it can be dragged into them
            try{ for (const s of this.getAllSlots()) s.assign(element); }catch(e){}
            // update player.inventory canonical store
            try{
                if (this.player && this.player.inventory && this.player.inventory.items){
                    const meta = { key, type: element.tile || null, pos: element.pos ? element.pos.clone() : null, size: element.size ? element.size.clone() : null, rot: element.rot || 0, invert: !!element.invert, amount: (element.data && element.data.amount) ? element.data.amount : 1 };
                    this.player.inventory.items.set(key, meta);
                }
            }catch(e){}
        }catch(e){}
    }

    /**
     * Restore an existing UI element back into the inventory area without changing its current position.
     * Unlike `_addInventoryEntry`, this preserves `element.pos` (useful for returning an item after drag).
     * @param {string} key
     * @param {object} element
     */
    _restoreInventoryEntry(key, element){
        try{
            if (!key || !element) return;
            if (!this.items.has(key)) this.items.set(key, element);
            try{ if (!this.menu.elements.has(key)) this.menu.addElement(key, element); }catch(e){}
            try{ element._invKey = key; }catch(e){}
            element.passcode = element.passcode || "Inventory";
            element.dragBounds = element.dragBounds || this.itemBounds;

            // ensure slot collision checks run when this element is released (attach once)
            try{ if (!element._slotReleaseAttached) { element.onRelease.connect(()=>{ this.slots.forEach((s)=>{ try{ s.collide(element) }catch(e){} }) }); element._slotReleaseAttached = true; } }catch(e){}

            // ensure element has a position; if not, place it dropped near the background
            try{
                if (!element.pos){
                    const absStart = this.menu.pos.add(this.itemBounds.pos);
                    element.pos = new Vector(absStart.x + 160 - this.menu.pos.x, absStart.y - this.menu.pos.y + 20);
                }
            }catch(e){}

            // register element with all slots so it can be dragged into them
            try{ for (const s of this.getAllSlots()) s.assign(element); }catch(e){}

            // update player.inventory canonical store with current element position
            try{
                if (this.player && this.player.inventory && this.player.inventory.items){
                    const meta = { key, type: element.tile || null, pos: element.pos ? element.pos.clone() : null, size: element.size ? element.size.clone() : null, rot: element.rot || 0, invert: !!element.invert, amount: (element.data && element.data.amount) ? element.data.amount : 1 };
                    this.player.inventory.items.set(key, meta);
                }
            }catch(e){}
        }catch(e){}
    }
}