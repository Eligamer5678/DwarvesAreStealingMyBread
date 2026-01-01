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
import { v } from "../modules/Vector.js";

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

        this.mainUI.onToggleInventory.connect(()=>{ this.toggle(); })

        // setup data
        this.selected = {
            "pos":[0,0],
            "type":"",
            "amount":1,
        }

        this.player.onEdit.connect((slotIndex, amount, itemName) => {
            try {
                // PICKUP / MINED: amount > 0
                if (amount > 0) {
                    const name = (itemName && typeof itemName === 'object') ? (itemName.id || itemName.type || null) : itemName;
                    if (!name) return;

                    // If hotbar slot already contains same item, increment amount
                    const existingKey = this.getSlotKey('hotbar', slotIndex);
                    if (existingKey && this.inventory.Inventory && this.inventory.Inventory.has(existingKey)){
                        const existingEntry = this.inventory.Inventory.get(existingKey);
                        const existingName = existingEntry && existingEntry.data && (existingEntry.data.tile || existingEntry.data.id || existingEntry.data.coord);
                        if (existingName === name){
                            existingEntry.data.amount = (existingEntry.data.amount || 0) + amount;
                            return;
                        }
                    }

                    // Try to place into the quickslot (hotbar) first, fall back to inventory
                    const placed = this.inventory.addItem(name, `hotbar/${slotIndex}`, false, 'inventory', amount,true);
                    if (!placed) this.inventory.addItem(name, 'inventory', false, 'inventory', amount,true);
                    return;
                }

                // CONSUME / PLACED: amount < 0
                if (amount < 0) {
                    // Try hotbar slot first
                    const key = this.getSlotKey('hotbar', slotIndex);
                    if (key && this.inventory.Inventory && this.inventory.Inventory.has(key)){
                        const entry = this.inventory.Inventory.get(key);
                        entry.data.amount = (entry.data.amount || 1) + amount; // amount is negative
                        if (entry.data.amount <= 0){
                            // remove inventory entry and clear slot
                            this.inventory.Inventory.delete(key);
                            this.setSlotKey('hotbar', slotIndex, "");
                        }
                        return;
                    }

                    // Fallback: if itemName provided, try to find matching entry anywhere and decrement
                    const targetName = (itemName && typeof itemName === 'object') ? (itemName.id || itemName.type || null) : itemName;
                    if (targetName) {
                        for (const [k, v] of this.inventory.Inventory.entries()){
                            const vname = v && v.data && (v.data.tile || v.data.id || v.data.coord);
                            if (vname === targetName){
                                v.data.amount = (v.data.amount || 1) + amount;
                                if (v.data.amount <= 0){
                                    // clear any slot referencing this key
                                    if (v.slotPath){
                                        const parts = String(v.slotPath).split('/');
                                        const g = parts[0]; const idx = parseInt(parts[1],10);
                                        if (!Number.isNaN(idx)) this.setSlotKey(g, idx, "");
                                    }
                                    this.inventory.Inventory.delete(k);
                                }
                                break;
                            }
                        }
                    }
                }
            } catch (e) { /* swallow inventory update errors */ }
        })
        this.inventory = this.player.inventory;
        this.inventory.startup(this.resources)
        try{ if (!this.inventory.slots['dwarf']) this.inventory.slots['dwarf'] = new Array(1).fill(""); }catch(e){}

        // Drag state
        this.drag = {
            active: false,
            key: null,
            entry: null,
            source: { group: null, index: null },
            amount: 0,
            previewSize: new Vector(48,48),
        };

        // Dwarf converter processor state
        this.dwarfProcessor = {
            active: false,
            key: null,
            recipe: null,
            progress: 0,
            timeNeeded: 0
        };

        // Mouse drag lifecycle hooks: we'll manage grab/release inside update()
        this.mouse.onEndGrab.connect((pos, button) => { try{ this._handleDrop(button, pos); } catch(e){} });
    }

    /** Return an Inventory entry by inventory key (e.g. "stone_1") */
    getInventoryEntry(key){
        if (!key) return null;
        return this.inventory && this.inventory.Inventory ? this.inventory.Inventory.get(key) : null;
    }

    /** Return the inventory key stored at group/index, or empty string */
    getSlotKey(group, index){
        if (!this.inventory || !this.inventory.slots) return "";
        const grp = this.inventory.slots[group];
        if (!grp || !Array.isArray(grp)) return "";
        return grp[index] || "";
    }

    /** Set the inventory key at group/index and update entry.slotPath */
    setSlotKey(group, index, key){
        if (!this.inventory || !this.inventory.slots) return false;
        const grp = this.inventory.slots[group];
        if (!grp || !Array.isArray(grp) || index < 0 || index >= grp.length) return false;
        grp[index] = key || "";
        if (key && this.inventory.Inventory && this.inventory.Inventory.has(key)) this.inventory.Inventory.get(key).slotPath = `${group}/${index}`;
        return true;
    }

    /**
     * Register a CraftingManager instance for extended UI flows
     * @param {CraftingManager} cm
     */
    setCraftingManager(cm){ this.craftingManager = cm }

    /**
     * Enter crafting mode and show the crafting popup (3x3 grid + output)
     * @param {object} meta
     */
    enterCrafting(meta){
        this.menu.pos.x = 50
        this.menu.pos.y = 180
        this.menu.addOffset(this.menu.offset)
        try{
            if (!this.craftingManager) return;
            // Create crafting popup if not already
            if (!this.craftingMenu){
                const center = v(60+this.menu.size.x, 1080/2 - 222);
                this.craftingMenu = new Menu(this.mouse, this.keys, center, v(582,444), 3, "#383838ff", true);
                this.craftingMenu.passcode = 'Inventory';
                // background (acts as mask so only edges drag the menu)
                const bg = new UIRect(v(10,10), v(562,424), 2, "#222222FF");
                bg.mouse = this.mouse;
                bg.mask = true;
                this.craftingMenu.addElement('bg', bg);
                // build 3x3 grid tiles
                const slotSize = 128; const spacing = 10;
                const gridX = 20; const gridY = 20;
                this.craftElems = [];
                for (let r = 0; r < 3; r++){
                    for (let c = 0; c < 3; c++){
                        const idx = r*3 + c;
                        const x = gridX + c * (slotSize + spacing);
                        const y = gridY + r * (slotSize + spacing);
                        const slot = new UISlot(`craft3x3/${idx}`, new Vector(x, y), new Vector(slotSize, slotSize), 2, "#2a2a2aff");
                        slot.mouse = this.mouse; slot.passcode = 'Inventory';
                        this.craftingMenu.addElement(`craft_slot_${idx}`, slot);
                        const tile = new UITile(null, new Vector(x+10,y+10), new Vector(slotSize-20, slotSize-20), 3);
                        tile.mouse = this.mouse;
                        this.craftingMenu.addElement(`craft_tile_${idx}`, tile);
                        this.craftElems.push({ slot, tile, index: idx });
                    }
                }
                // output tile and craft button
                const outX = gridX + 3*(slotSize + spacing);
                const outY = gridY + slotSize+10;
                // create an output UISlot so users can drag the crafted item out like a normal slot
                const outOutline = new UIRect(new Vector(outX, outY), new Vector(slotSize, slotSize),2,"#274e13ff")
                const outSlot = new UISlot('output/0', new Vector(outX+7.5, outY+7.5), new Vector(slotSize-15, slotSize-15), 2, "#38761dff");
                outSlot.mouse = this.mouse; outSlot.passcode = 'Inventory';
                this.craftingMenu.addElement('output_outline', outOutline);
                this.craftingMenu.addElement('output_slot', outSlot);
                const outTile = new UITile(null, new Vector(outX+4+7.5, outY+4+7.5), new Vector(slotSize-8-15, slotSize-8-15), 3);
                outTile.mouse = this.mouse;
                this.craftingMenu.addElement('output_tile', outTile);
                // expose as properties for preview/update
                this.outputSlot = outSlot;
                this.outputTile = outTile;
                // Note: drag handling is managed centrally in InventoryManager; do not attach UI events here.

                // register in mainUI menu
                try{ this.mainUI.menu.addElement('craftingPopup', this.craftingMenu); }catch(e){}

                // register these groups so syncSlotsWithPlayer will update them
                if (!this.slotGroupElems['craft3x3']) this.slotGroupElems['craft3x3'] = [];
                for (const el of this.craftElems) this.slotGroupElems['craft3x3'].push(el);
                if (!this.slotGroupElems['output']) this.slotGroupElems['output'] = [];
                // register actual output elem so sync works
                this.slotGroupElems['output'].push({ slot: outSlot, tile: outTile, border: null, index: 0 });
                // Signal emitted when a materialized crafted output is successfully placed
                // Listener consumes the inputs when appropriate.
                this.onCraftOutputPlaced = new Signal();
                // flag: inputs already consumed for the current created output (to avoid double-consume)
                this._craftInputsConsumed = false;
                this.onCraftOutputPlaced.connect((info) => {
                    try{
                        if (!(this._craftInputsConsumed) && info && info.source && info.source.group === 'output'){
                            try{ this.consumeCurrentRecipeInputs(); this._craftInputsConsumed = true; }catch(e){}
                        }
                    }catch(e){}
                });
                // internal tracker for materialized output items (so we know if output was created at drag-start)
                this._craftMaterialized = null;
            }
            this.craftingMenu.visible = true;
            this.craftingMeta = meta || null;
            // reset craft placement tracking
            this._craftInputsConsumed = false;
            this._craftMaterialized = null;
            // ensure inventory has groups
            if (!this.inventory.slots['craft3x3']) this.inventory.slots['craft3x3'] = new Array(9).fill("");
            if (!this.inventory.slots['output']) this.inventory.slots['output'] = new Array(1).fill("");
            this.updateCraftPreview();
        }catch(e){}
        this.craftingMenu.pos.x = 60+this.menu.size.x
        this.craftingMenu.pos.y = 1080/2 - 222
        this.craftingMenu.addOffset(this.craftingMenu.offset)
    }

    /** Clear all craft3x3 slots and refresh UI */
    clearCraftGrid(){
        try{
            if (!this.inventory || !this.inventory.slots) return;
            const arr = this.inventory.slots['craft3x3'] || [];
            for (let i = 0; i < 9; i++){
                try{ this.inventory.clearSlot('craft3x3', i); }catch(e){}
            }
            try{ this.syncSlotsWithPlayer(); }catch(e){}
            try{ this.updateCraftPreview(); }catch(e){}
        }catch(e){}
    }

    /** Hide crafting popup */
    exitCrafting(){
        try{ if (this.craftingMenu) this.craftingMenu.visible = false; }catch(e){}
        try{ this.craftingMeta = null; this.currentRecipe = null; this._craftInputsConsumed = false; this._craftMaterialized = null; }catch(e){}
    }

    /** Build a 3x3 id grid from inventory craft3x3 slots */
    _buildCraftGrid(){
        const grid = [["","",""] , ["","",""] , ["","",""]];
        try{
            const arr = this.inventory.slots['craft3x3'] || new Array(9).fill("");
            for (let i = 0; i < 9; i++){
                const r = Math.floor(i/3); const c = i%3;
                const key = arr[i];
                if (key && this.inventory.Inventory && this.inventory.Inventory.has(key)){
                    const entry = this.inventory.Inventory.get(key);
                    const id = entry && entry.data && (entry.data.tile || entry.data.id || entry.data.coord) ? (entry.data.tile || entry.data.id || entry.data.coord) : '';
                    grid[r][c] = id || '';
                } else grid[r][c] = '';
            }
        }catch(e){}
        return grid;
    }

    /** Update output preview tile based on current grid */
    updateCraftPreview(){
        try{
            if (!this.craftingManager) return;
            const grid = this._buildCraftGrid();
            const match = this.craftingManager.findMatch(grid,true);
            if (match && match.recipe){
                const out = match.recipe.output;
                const resolved = this.inventory.getItem ? this.inventory.getItem(out) : null;
                if (resolved && resolved.sheet){
                    this.outputTile.sheet = resolved.sheet;
                    this.outputTile.tile = resolved.data && (resolved.data.tile || resolved.data.coord) ? (resolved.data.tile || resolved.data.coord) : (resolved.data && resolved.data.id ? resolved.data.id : out);
                } else {
                    this.outputTile.sheet = resolved ? resolved.sheet : null;
                    this.outputTile.tile = out;
                }
                this.currentRecipe = match.recipe;
                // compute how many times this recipe can be crafted given input slot amounts
                try{
                    // Determine normalized pattern bounding box for the recipe
                    const pattern = match.recipe.input || [];
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (let y = 0; y < pattern.length; y++){
                        const row = pattern[y] || [];
                        for (let x = 0; x < row.length; x++){
                            const need = row[x];
                            if (need !== null && typeof need !== 'undefined' && String(need).trim() !== ''){
                                if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                            }
                        }
                    }
                    let craftMax = 0;
                    if (minX !== Infinity){
                        const pW = maxX - minX + 1; const pH = maxY - minY + 1;
                        const ox = (typeof match.ox === 'number') ? match.ox : 0;
                        const oy = (typeof match.oy === 'number') ? match.oy : 0;
                        // For each required cell, gather available amount and take min
                        let mins = [];
                        for (let ry = 0; ry < pH; ry++){
                            for (let rx = 0; rx < pW; rx++){
                                const need = (pattern[minY + ry] && pattern[minY + ry][minX + rx]) ? pattern[minY + ry][minX + rx] : '';
                                if (!need || String(need).trim() === '') continue;
                                const gridR = oy + ry; const gridC = ox + rx; const idx = gridR * 3 + gridC;
                                const key = (this.inventory.slots['craft3x3'] && this.inventory.slots['craft3x3'][idx]) ? this.inventory.slots['craft3x3'][idx] : null;
                                if (!key || !this.inventory.Inventory || !this.inventory.Inventory.has(key)){
                                    mins.push(0);
                                } else {
                                    const entry = this.inventory.Inventory.get(key);
                                    mins.push(entry.data && entry.data.amount ? entry.data.amount : 0);
                                }
                            }
                        }
                        if (mins.length > 0) craftMax = Math.max(0, Math.min(...mins));
                    }
                    // save craftable count on craftingManager for use during materialize
                    try{ if (this.craftingManager) this.craftingManager.currentCraftMax = craftMax; }catch(e){}
                    // show total output amount on tile preview (number of outputs possible)
                    try{ this.outputTile.data = this.outputTile.data || {}; this.outputTile.data.amount = (this.currentRecipe.amount || 1) * (craftMax || 0); }catch(e){}
                }catch(e){}
            } else {
                this.outputTile.sheet = null; this.outputTile.tile = null; this.currentRecipe = null;
                try{ if (this.craftingManager) this.craftingManager.currentCraftMax = 0; }catch(e){}
            }
        }catch(e){}
    }

    /** Attempt to craft current recipe: place output into `output/0` and consume inputs */
    _attemptCraft(){
        try{
            if (!this.currentRecipe) return;
            // ensure we can place output into output/0
            const placed = this.inventory.addItem(this.currentRecipe.output, 'output/0', false, 'inventory', this.currentRecipe.amount || 1);
            if (!placed) return; // couldn't place output
            // we need to find matched translation to know which slots to consume
            const grid = this._buildCraftGrid();
            const match = this.craftingManager.findMatch(grid,true);
            if (!match || !match.recipe) return;
            const pattern = match.recipe.input || [];
            // compute normalized bounding box same as CraftingManager
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let y = 0; y < pattern.length; y++){
                const row = pattern[y] || [];
                for (let x = 0; x < row.length; x++){
                    const need = row[x];
                    if (need !== null && typeof need !== 'undefined' && String(need).trim() !== ''){
                        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                    }
                }
            }
            if (minX === Infinity) return;
            const pW = maxX - minX + 1; const pH = maxY - minY + 1;
            // consume inputs at matched offsets
            const ox = match.ox; const oy = match.oy;
            for (let y = 0; y < pH; y++){
                for (let x = 0; x < pW; x++){
                    const srcX = minX + x; const srcY = minY + y;
                    const need = (pattern[srcY] && pattern[srcY][srcX]) ? pattern[srcY][srcX] : '';
                    if (!need || String(need).trim() === '') continue;
                    const gridR = oy + y; const gridC = ox + x; const idx = gridR * 3 + gridC;
                    const key = (this.inventory.slots['craft3x3'] && this.inventory.slots['craft3x3'][idx]) ? this.inventory.slots['craft3x3'][idx] : null;
                    if (key && this.inventory.Inventory && this.inventory.Inventory.has(key)){
                        const entry = this.inventory.Inventory.get(key);
                        entry.data.amount = (entry.data.amount || 1) - 1;
                        if (entry.data.amount <= 0){
                            // clear slot and delete entry
                            this.inventory.clearSlot('craft3x3', idx);
                        } else {
                            this.inventory.Inventory.get(key).data.amount = entry.data.amount;
                        }
                    }
                }
            }
            // mark that inputs were consumed for this crafted output so we don't double-consume later
            this._craftInputsConsumed = true;
            // refresh UI
            this.syncSlotsWithPlayer();
            this.updateCraftPreview();
        }catch(e){ console.warn('craft failed', e); }
    }

    /** Consume one unit from each input slot of the current recipe (used when player takes the crafted output) */
    consumeCurrentRecipeInputs(){
        try{
            if (!this.currentRecipe || !this.craftingManager) return;
            // find matched translation for current grid
            const grid = this._buildCraftGrid();
            const match = this.craftingManager.findMatch(grid);
            if (!match || !match.recipe) return;
            const pattern = match.recipe.input || [];
            // compute normalized bounding box same as CraftingManager
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let y = 0; y < pattern.length; y++){
                const row = pattern[y] || [];
                for (let x = 0; x < row.length; x++){
                    const need = row[x];
                    if (need !== null && typeof need !== 'undefined' && String(need).trim() !== ''){
                        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                    }
                }
            }
            if (minX === Infinity) return;
            const pW = maxX - minX + 1; const pH = maxY - minY + 1;
            const ox = match.ox; const oy = match.oy;
            for (let y = 0; y < pH; y++){
                for (let x = 0; x < pW; x++){
                    const srcX = minX + x; const srcY = minY + y;
                    const need = (pattern[srcY] && pattern[srcY][srcX]) ? pattern[srcY][srcX] : '';
                    if (!need || String(need).trim() === '') continue;
                    const gridR = oy + y; const gridC = ox + x; const idx = gridR * 3 + gridC;
                    const key = (this.inventory.slots['craft3x3'] && this.inventory.slots['craft3x3'][idx]) ? this.inventory.slots['craft3x3'][idx] : null;
                    if (key && this.inventory.Inventory && this.inventory.Inventory.has(key)){
                        const entry = this.inventory.Inventory.get(key);
                        entry.data.amount = (entry.data.amount || 1) - 1;
                        if (entry.data.amount <= 0){
                            // clear slot and delete entry
                            this.inventory.clearSlot('craft3x3', idx);
                        } else {
                            this.inventory.Inventory.get(key).data.amount = entry.data.amount;
                        }
                    }
                }
            }
            // refresh UI
            try{ this.syncSlotsWithPlayer(); }catch(e){}
            try{ this.updateCraftPreview(); }catch(e){}
        }catch(e){ console.warn('consume inputs failed', e); }
    }

    /**
     * Open the inventory UI. If `meta` is provided and contains crafting data,
     * enter crafting mode.
     * @param {object} [meta]
     */
    open(meta){
        try{ 
            this.menu.visible = true; 
            this.menu.pos.x = 488
            this.menu.pos.y = 180
            this.menu.addOffset(this.menu.offset)
        }catch(e){}
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
     * Setup the inventory menu
     */
    getInventoryUI(){
        // Create the base menu
        this.menu = new Menu(this.mouse,this.keys,v(488,180),v(944,720),2,"#383838ff",true) // grab data needed from MainUI
        this.menu.passcode = "Inventory"
        this.menu.pos.x = 488
            this.menu.pos.y = 180
        this.menu.visible = false;
        this.itemBounds = {
            "pos":v(220,10),
            "size":v(714,700)
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
        // Dwarf converter slot pinned to the funnyGuy (bottom-right of sprite)
        try{
            const dwarfSlotPos = new Vector(10 + 200 - 63, 10 + 200 - 63);
            const dwarfSlotSize = 66;
            const dwarfSlot = new UISlot("dwarf/0", dwarfSlotPos, new Vector(dwarfSlotSize, dwarfSlotSize), 2, "#2a2a2a00");
            dwarfSlot.mouse = this.mouse;
            dwarfSlot.passcode = "Inventory";
            this.menu.addElement('dwarf_slot_0', dwarfSlot);
            const dwarfTile = new UITile(null, new Vector(dwarfSlotPos.x + 4, dwarfSlotPos.y + 4), new Vector(dwarfSlotSize - 6, dwarfSlotSize - 6), 3);
            dwarfTile.mouse = this.mouse;
            this.menu.addElement('dwarf_slot_tile_0', dwarfTile);
            const dwarfBorder = new UIRect(new Vector(dwarfSlotPos.x + 3, dwarfSlotPos.y + 3), new Vector(dwarfSlotSize - 6, dwarfSlotSize - 6), 4, '#FFFFFF44', false, true, 4, '#494949ff');
            dwarfBorder.visible = false;
            dwarfBorder.mask = true;
            dwarfBorder.mouse = this.mouse;
            this.menu.addElement('dwarf_slot_border_0', dwarfBorder);
            // register in slot groups so generic sync/hit-tests include it
            try{ if (!this.slotItems) this.slotItems = {}; }catch(e){}
            this.slotItems.dwarf = new Array(1).fill(null);
            if (!this.slotGroupElems.dwarf) this.slotGroupElems.dwarf = [];
            this.slotGroupElems.dwarf.push({ slot: dwarfSlot, tile: dwarfTile, border: dwarfBorder, index: 0 });
        }catch(e){}
        
        // Create the slot bg
        this.menu.addElement('slotBg',new UIRect(v(220,10),v(150,700),2,"#181818ff"))
        // create UISlot instances grouped by logical slot groups (object of arrays)
        const hotbar = [
            new UISlot("hotbar/0",v(230,20),v(128,128),2,"#242424ff"),
            new UISlot("hotbar/1",v(230,158),v(128,128),2,"#242424ff"),
            new UISlot("hotbar/2",v(230,296),v(128,128),2,"#242424ff"),
            new UISlot("hotbar/3",v(230,434),v(128,128),2,"#242424ff"),
            new UISlot("hotbar/4",v(230,572),v(128,128),2,"#242424ff"),
        ];
        // track slot-backed keys per group and hotbar elements
        this.slotItems = {};
        this.slotGroupElems = {}; // map groupName -> array of slot element objects
        this.slotItems.hotbar = new Array(hotbar.length).fill(null);
        this.hotbarSlotElems = [];

        for (let i = 0; i < hotbar.length; i++){
            const s = hotbar[i];
            s.mouse = this.mouse;
            s.passcode = "Inventory";
            // wire the store event to a lightweight handler (refactor will replace)
            try{ s.onStore.connect((el, prev) => { try{ this._handleStore && this._handleStore('hotbar', i, el, prev); }catch(e){} }); }catch(e){}
            this.menu.addElement(`slot_hotbar_${i}`, s)

            // Create a tile renderer and border for each hotbar slot (to show item visuals)
            const hx = s.pos.x + 8;
            const hy = s.pos.y + 8;
            const hsize = s.size.x - 16;
            const htile = new UITile(null, new Vector(hx, hy), new Vector(hsize, hsize), 3);
            htile.mouse = this.mouse;
            this.menu.addElement(`hotbar_tile_${i}`, htile);
            const hborder = new UIRect(new Vector(hx - 4, hy - 4), new Vector(hsize + 8, hsize + 8), 4, '#FFFFFF44', false, true, 6, '#00ff22aa');
            hborder.visible = false;
            this.menu.addElement(`hotbar_border_${i}`, hborder);
            this.hotbarSlotElems.push({ slot: s, tile: htile, border: hborder, index: i });
            // register in generic map
            if (!this.slotGroupElems.hotbar) this.slotGroupElems.hotbar = [];
            this.slotGroupElems.hotbar.push({ slot: s, tile: htile, border: hborder, index: i });
        }

        // Inventory grid (5x5) to the right of hotbar
        const gridCols = 4;
        const gridRows = 5;
        const gridSlotSize = 128;
        const gridSpacing = 10;
        const gridX = 230 + 150; // right of hotbar
        const gridY = 20;
        this.slotItems.inventory = new Array(gridCols * gridRows).fill(null);
        this.invSlotElems = [];
        if (!this.slotGroupElems.inventory) this.slotGroupElems.inventory = [];
        for (let r = 0; r < gridRows; r++){
            for (let c = 0; c < gridCols; c++){
                const idx = r * gridCols + c;
                const x = gridX + c * (gridSlotSize + gridSpacing);
                const y = gridY + r * (gridSlotSize + gridSpacing);
                // create a UISlot so inventory slots mirror hotbar structure
                const slot = new UISlot(`inventory/${idx}`, new Vector(x, y), new Vector(gridSlotSize, gridSlotSize), 2, "#2a2a2aff");
                slot.mouse = this.mouse;
                slot.passcode = "Inventory";
                this.menu.addElement(`inv_slot_${idx}`, slot);
                // tile element
                const tile = new UITile(null, new Vector(x + 6, y + 6), new Vector(gridSlotSize - 12, gridSlotSize - 12), 3);
                tile.mouse = this.mouse;
                this.menu.addElement(`inv_slot_tile_${idx}`, tile);
                // border
                const border = new UIRect(new Vector(x + 3, y + 3), new Vector(gridSlotSize - 6, gridSlotSize - 6), 4, '#FFFFFF44', false, true, 6, '#00ff22aa');
                border.visible = false;
                this.menu.addElement(`inv_slot_border_${idx}`, border);

                const elemObj = { slot, bg, tile, border, x, y, size: gridSlotSize };
                this.invSlotElems.push(elemObj);
                this.slotGroupElems.inventory.push(elemObj);
            }
        }

        this.mainUI.menu.addElement('inventory',this.menu)

        // Ensure dwarf slot UI (created earlier) is registered in slotGroupElems/slotItems
        try{
            if (!this.slotGroupElems) this.slotGroupElems = {};
            if (!this.slotItems) this.slotItems = {};
            if (!this.slotGroupElems.dwarf) this.slotGroupElems.dwarf = [];
            if (!this.slotItems.dwarf) this.slotItems.dwarf = new Array(1).fill(null);
            // retrieve elements we previously added to the menu
            try{
                const ds = this.menu.elements.get('dwarf_slot_0');
                const dt = this.menu.elements.get('dwarf_slot_tile_0');
                const db = this.menu.elements.get('dwarf_slot_border_0');
                if (ds && dt) this.slotGroupElems.dwarf.push({ slot: ds, tile: dt, border: db || null, index: 0 });
            }catch(e){}
            // ensure inventory has dwarf group
            try{ if (!this.inventory.slots['dwarf']) this.inventory.slots['dwarf'] = new Array(1).fill(""); }catch(e){}
        }catch(e){}

        // Ensure UI reflects current player slots at creation (no-op during refactor)
        try{ if (typeof this.syncSlotsWithPlayer === 'function') this.syncSlotsWithPlayer(); }catch(e){}
    }

    /**
     * Lightweight placeholder for slot store events. During the refactor this
     * will be replaced by group-aware logic that maps UI drops into the
     * canonical inventory model. For now it is intentionally a no-op.
     */
    _handleStore(groupName, slotIndex, element, prev){
        // placeholder: groupName is a string like 'hotbar', slotIndex is numeric
        return;
    }

    /**
     * Return a UI tile element for the given block `type`.
     * If `this.resources` contains a `blocks` map and the type maps to a
     * texture/tilemap, a `UITile` instance is returned. Otherwise `null`.
     * @param {string} type
     * @param {Vector} [pos]
     * @param {Vector} [size]
     * @param {number} [layer]
     */
    getTile(type, pos = new Vector(0,0), size = new Vector(16,16), layer = 2){
        if (!type) return null;
        const res = this.resources || (this.mainUI && this.mainUI.scene ? this.mainUI.scene.SpriteImages : null);
        if (!res) return null;
        try{
            if (res.has && res.has('blocks')){
                const blocks = res.get('blocks');
                if (blocks && blocks instanceof Map && blocks.has(type)){
                    const meta = blocks.get(type);
                    const tex = meta && meta.texture ? meta.texture : null;
                    if (tex && tex.tilemap && res.has(tex.tilemap)){
                        const sheet = res.get(tex.tilemap);
                        const tile = new UITile(sheet, pos.clone ? pos.clone() : pos, size.clone ? size.clone() : size, layer, 0, new Vector(1,1), 1, false, this.mouse, true);
                        tile.tile = type;
                        tile.data = tile.data || {};
                        tile.data.amount = tile.data.amount || 1;
                        return tile;
                    }
                }
            }
        }catch(e){}
        return null;
    }

    /** Return slot {group,index,elem} under given position or null */
    _slotUnderPos(pos){
        if (!pos) return null;
        // iterate all registered groups and their elements
        for (const groupName of Object.keys(this.slotGroupElems)){
            const arr = this.slotGroupElems[groupName] || [];
            for (let i = 0; i < arr.length; i++){
                const h = arr[i];
                try{
                    // Determine element rect: prefer UISlot, fallback to stored x/y/size, then UITile
                    let rectPos = null; let rectSize = null;
                    if (h.slot && h.slot.pos){
                        rectPos = (h.slot.pos && h.slot.offset && typeof h.slot.pos.add === 'function') ? h.slot.pos.add(h.slot.offset) : h.slot.pos;
                        rectSize = h.slot.size;
                    } else if (typeof h.x === 'number' && typeof h.y === 'number' && typeof h.size === 'number'){
                        rectPos = new Vector(h.x, h.y);
                        rectSize = new Vector(h.size, h.size);
                    } else if (h.tile && h.tile.pos && h.tile.size){
                        rectPos = h.tile.pos;
                        rectSize = h.tile.size;
                    }
                    if (rectPos && rectSize){
                        if (Geometry.pointInRect(this.mouse.pos, rectPos, rectSize)) return { group: groupName, index: i, elem: h };
                    }
                }catch(e){ /* ignore element hit-test errors */ }
            }
        }
        return null;
    }

    /** Attempt to start a drag from the slot under the mouse */
    _tryStartDrag(button = 'left'){
        if (!this.mouse) return;
        const pos = this.mouse.pos;
        const hit = this._slotUnderPos(pos);
        if (!hit) return;
        let key = this.getSlotKey(hit.group, hit.index);
        // If output preview present but no real item, materialize the crafted output so it can be dragged
        if ((!key || key === '') && hit.group === 'output' && this.currentRecipe){
            try{
                // Determine the amount to materialize: recipe output amount * craftable count
                const craftCount = (this.craftingManager && typeof this.craftingManager.currentCraftMax === 'number') ? this.craftingManager.currentCraftMax : 1;
                const amt = (this.currentRecipe.amount || 1) * Math.max(1, craftCount);
                const placed = this.inventory.addItem(this.currentRecipe.output, `output/0`, false, 'inventory', amt);
                if (placed) key = this.getSlotKey(hit.group, hit.index);
            }catch(e){}
        }
        if (!key) return;
        const entry = this.getInventoryEntry(key);
        if (!entry) return;

        // begin drag
        this.drag.active = true;
        this.drag.key = key;
        this.drag.entry = entry;
        this.drag.source.group = hit.group;
        this.drag.source.index = hit.index;
        // if we materialized an output this drag, remember it so drop/cancel logic can act
        if (hit.group === 'output' && (!this._craftMaterialized || this._craftMaterialized.key !== key)){
            this._craftMaterialized = { key: key, group: hit.group, index: hit.index };
            // ensure future placement consumes inputs (this was materialized at drag-start)
            this._craftInputsConsumed = false;
        }
        // if right-button, only drag one item; otherwise drag whole stack
        if (button === 'right') this.drag.amount = 1;
        else this.drag.amount = (entry.data && typeof entry.data.amount === 'number') ? entry.data.amount : 1;
        // do not re-trigger grab here (onGrab already fired)
    }

    /** Handle drop when mouse grab ends or when release detected */
    _handleDrop(button = 'left', pos = null){
        if (!this.drag.active) return;
        pos = pos || (this.mouse ? this.mouse.pos : null);
        const hit = this._slotUnderPos(pos);

        // If no target, just cancel (no movement)
        if (!hit){
            // if we had materialized the output for this drag, undo it (remove created entry)
            try{
                if (this._craftMaterialized && this._craftMaterialized.key === this.drag.key){
                    try{ this.inventory.Inventory.delete(this.drag.key); }catch(e){}
                    try{ this.setSlotKey(this._craftMaterialized.group, this._craftMaterialized.index, ""); }catch(e){}
                    this._craftMaterialized = null;
                }
            }catch(e){}
            this.drag.active = false;
            this.drag.key = null; this.drag.entry = null; this.drag.amount = 0;
            return;
        }

        const srcGroup = this.drag.source.group; const srcIndex = this.drag.source.index;
        const dstGroup = hit.group; const dstIndex = hit.index;
        // Prevent dragging arbitrary items into the crafting output slot.
        // Only allow drops into `output` if the source was also `output` (i.e., internal moves).
        if (dstGroup === 'output' && srcGroup !== 'output'){
            // cancel the drag without modifying inventory
            this.drag.active = false; this.drag.key = null; this.drag.entry = null; this.drag.amount = 0;
            try{ this.mouse.releaseGrab(button); }catch(e){}
            return;
        }
        // Right click: move a single item (split stack if necessary)
        if (button === 'right'){
            const dstKey = this.getSlotKey(dstGroup, dstIndex);
            const srcEntry = this.drag.entry;
            const srcAmt = srcEntry && srcEntry.data ? (srcEntry.data.amount || 1) : 1;
            const srcName = srcEntry && srcEntry.data && (srcEntry.data.tile || srcEntry.data.id || srcEntry.data.coord);

            // If dropping back onto the same slot we started from, do nothing.
            if (dstKey === this.drag.key && srcEntry && this.drag.source && this.drag.source.group === dstGroup && this.drag.source.index === dstIndex){
                this.drag.active = false; this.drag.key = null; this.drag.entry = null; this.drag.amount = 0;
                try{ this.mouse.releaseGrab('right'); }catch(e){}
                return;
            }

            // If destination empty: create a new single-item entry there
            if (!dstKey){
                // prefer using inventory.addItem to create a proper entry
                if (srcName){
                    this.inventory.addItem(srcName, `${dstGroup}/${dstIndex}`, false, 'inventory', 1);
                    // decrement source
                    if (srcEntry.data){
                        srcEntry.data.amount = srcAmt - 1;
                        if (srcEntry.data.amount <= 0){
                            this.inventory.Inventory.delete(this.drag.key);
                            this.setSlotKey(srcGroup, srcIndex, "");
                        } else {
                            if (this.inventory.Inventory.has(this.drag.key)) this.inventory.Inventory.get(this.drag.key).data.amount = srcEntry.data.amount;
                        }
                    }
                    // If the source was a materialized crafted output, emit placement signal
                    try{ if (srcGroup === 'output' && this._craftMaterialized && this._craftMaterialized.key === this.drag.key){ this.onCraftOutputPlaced && this.onCraftOutputPlaced.emit({ source: { group: srcGroup, index: srcIndex }, dest: { group: dstGroup, index: dstIndex } }); this._craftMaterialized = null; } }catch(e){}
                }
                this.drag.active = false; this.drag.key = null; this.drag.entry = null; this.drag.amount = 0;
                return;
            }

            // Destination exists: try stacking if same type
            const dstEntry = this.getInventoryEntry(dstKey);
            const dstName = dstEntry && dstEntry.data && (dstEntry.data.tile || dstEntry.data.id || dstEntry.data.coord);
            if (dstEntry && srcName && dstName && dstName === srcName){
                const dstAmt = dstEntry.data.amount || 0;
                if (dstAmt < 64){
                    // move one (or less if source has <1)
                    const move = Math.min(1, srcAmt);
                    dstEntry.data.amount = dstAmt + move;
                    // decrement source
                    if (srcEntry.data){
                        srcEntry.data.amount = srcAmt - move;
                        if (srcEntry.data.amount <= 0){
                            this.inventory.Inventory.delete(this.drag.key);
                            this.setSlotKey(srcGroup, srcIndex, "");
                        } else {
                            if (this.inventory.Inventory.has(this.drag.key)) this.inventory.Inventory.get(this.drag.key).data.amount = srcEntry.data.amount;
                        }
                    }
                    this.drag.active = false; this.drag.key = null; this.drag.entry = null; this.drag.amount = 0;
                    // If the source was a materialized crafted output, emit placement signal
                    try{ if (srcGroup === 'output' && this._craftMaterialized && this._craftMaterialized.key === this.drag.key){ this.onCraftOutputPlaced && this.onCraftOutputPlaced.emit({ source: { group: srcGroup, index: srcIndex }, dest: { group: dstGroup, index: dstIndex } }); this._craftMaterialized = null; } }catch(e){}
                    return;
                }
                // destination full -> fallthrough to swap
            }

            // fallback: if different item, perform swap (same as left behavior)
        }

        // Left click: move whole stack (swap if needed)
        const dstKey = this.getSlotKey(dstGroup, dstIndex);
        // If destination already contains this same key, do nothing
        if (dstKey === this.drag.key){
            // nothing to do
            this.drag.active = false; this.drag.key = null; this.drag.entry = null; this.drag.amount = 0;
            try{ this.mouse.releaseGrab('left'); }catch(e){}
            return;
        }
        // If destination has an entry and it's a different key, try stacking
        if (dstKey){
            const dstEntry = this.getInventoryEntry(dstKey);
            const srcEntry = this.drag.entry;
            const dstName = dstEntry && dstEntry.data && (dstEntry.data.tile || dstEntry.data.id || dstEntry.data.coord);
            const srcName = srcEntry && srcEntry.data && (srcEntry.data.tile || srcEntry.data.id || srcEntry.data.coord);
            // If they are the same item type, merge up to max stack (64)
            if (dstEntry && srcEntry && dstName && srcName && dstName === srcName){
                const dstAmt = dstEntry.data.amount || 0;
                const srcAmt = srcEntry.data.amount || 0;
                const space = 64 - dstAmt;
                if (space > 0){
                    const move = Math.min(space, srcAmt);
                    dstEntry.data.amount = dstAmt + move;
                    // reduce source
                    srcEntry.data.amount = srcAmt - move;
                    // if source emptied, remove entry and clear its slot
                    if (srcEntry.data.amount <= 0){
                        this.inventory.Inventory.delete(this.drag.key);
                        this.setSlotKey(srcGroup, srcIndex, "");
                    } else {
                        // update map entry amount (slotPath remains the same)
                        if (this.inventory.Inventory.has(this.drag.key)) this.inventory.Inventory.get(this.drag.key).data.amount = srcEntry.data.amount;
                    }
                    // finish drag
                    this.drag.active = false; this.drag.key = null; this.drag.entry = null; this.drag.amount = 0;
                    return;
                }
                // if no space, fallthrough to swap behavior
            }
        }

        // perform swap: place drag.key into dst, put previous dstKey into source slot
        const prev = dstKey;
        // set destination
        this.setSlotKey(dstGroup, dstIndex, this.drag.key);
        // place previous into source (or clear)
        if (prev){
            // move prev into source slot
            this.setSlotKey(srcGroup, srcIndex, prev);
            if (this.inventory.Inventory.has(prev)) this.inventory.Inventory.get(prev).slotPath = `${srcGroup}/${srcIndex}`;
        } else {
            // clear source slot without deleting the Inventory Map entry
            this.setSlotKey(srcGroup, srcIndex, "");
        }

        // If we moved a materialized crafted output from the output slot, emit placement so inputs are consumed
        try{ if (srcGroup === 'output' && this._craftMaterialized && this._craftMaterialized.key === this.drag.key){ this.onCraftOutputPlaced && this.onCraftOutputPlaced.emit({ source: { group: srcGroup, index: srcIndex }, dest: { group: dstGroup, index: dstIndex } }); this._craftMaterialized = null; } }catch(e){}

        this.drag.active = false; this.drag.key = null; this.drag.entry = null; this.drag.amount = 0;
        return;
    }

    /** Sync UI slot elements with player.inventory state */
    syncSlotsWithPlayer(){
        if (!this.inventory || !this.inventory.slots) return;
        // Generic: iterate all slot groups we've created UI elements for
        for (const groupName of Object.keys(this.slotGroupElems || {})){
            const arr = this.slotGroupElems[groupName] || [];
            // capture previous state for change detection (e.g., output slot cleared)
            const prevArray = this.slotItems[groupName] ? Array.from(this.slotItems[groupName]) : new Array(arr.length).fill(null);
            // ensure slotItems entry exists
            if (!this.slotItems[groupName]) this.slotItems[groupName] = new Array(arr.length).fill(null);
            for (let i = 0; i < arr.length; i++){
                const elem = arr[i];
                const key = this.getSlotKey(groupName, i) || (this.inventory.slots[groupName] ? this.inventory.slots[groupName][i] : "");
                this.slotItems[groupName][i] = key || null;
                const entry = this.getInventoryEntry(key);
                if (entry && entry.sheet){
                    elem.tile.sheet = entry.sheet;
                    // determine tile identifier
                    if (entry.data && entry.data.tile) elem.tile.tile = entry.data.tile;
                    else if (entry.data && entry.data.coord) elem.tile.tile = entry.data.coord;
                    else elem.tile.tile = entry.data && entry.data.id ? entry.data.id : null;
                    elem.tile.data = elem.tile.data || {}; elem.tile.data.amount = entry.data && entry.data.amount ? entry.data.amount : 1;
                } else {
                    try{
                        // If this is the crafting output group and we have a preview recipe,
                        // show the preview even when no actual inventory entry is present.
                        if (groupName === 'output' && this.craftingMenu && this.craftingMenu.visible && this.currentRecipe){
                            const out = this.currentRecipe.output;
                            const resolved = this.inventory.getItem ? this.inventory.getItem(out) : null;
                            if (resolved && resolved.sheet){
                                elem.tile.sheet = resolved.sheet;
                                elem.tile.tile = resolved.data && (resolved.data.tile || resolved.data.coord) ? (resolved.data.tile || resolved.data.coord) : (resolved.data && resolved.data.id ? resolved.data.id : out);
                            } else {
                                elem.tile.sheet = resolved ? resolved.sheet : null;
                                elem.tile.tile = out;
                            }
                            elem.tile.data = elem.tile.data || {}; elem.tile.data.amount = this.currentRecipe.amount || 1;
                        } else {
                            elem.tile.sheet = null; elem.tile.tile = null; elem.tile.data = elem.tile.data || {}; elem.tile.data.amount = 0;
                        }
                    }catch(e){}
                }
            }
            // detect if output slot was cleared by a drag (previously had key, now empty)
            try{
                    if (groupName === 'output'){
                    const prevKey = prevArray && prevArray.length > 0 ? prevArray[0] : null;
                    const curKey = this.slotItems['output'] && this.slotItems['output'].length > 0 ? this.slotItems['output'][0] : null;
                    // If output slot transitioned from filled -> empty, consume inputs (subtract one per input)
                    if (prevKey && (!curKey || curKey === null)){
                        try{
                            if (!(this._craftInputsConsumed)) this.consumeCurrentRecipeInputs();
                            // reset materialized marker after consumption
                            this._craftMaterialized = null;
                        }catch(e){}
                    }
                }
            }catch(e){}
        }
        
    }

    /** Process dwarf converter slot over time (converts items via recipes.mine) */
    _processDwarf(delta){
        try{
            if (!this.inventory || !this.inventory.slots || !this.inventory.slots['dwarf']) return;
            const key = this.getSlotKey('dwarf', 0);
            // nothing to process
            if (!key || key === ''){
                this.dwarfProcessor.active = false; this.dwarfProcessor.key = null; this.dwarfProcessor.recipe = null; this.dwarfProcessor.progress = 0; this.dwarfProcessor.timeNeeded = 0;
                // hide border if present
                try{ if (this.slotGroupElems && this.slotGroupElems.dwarf && this.slotGroupElems.dwarf[0] && this.slotGroupElems.dwarf[0].border) this.slotGroupElems.dwarf[0].border.visible = false; }catch(e){}
                return;
            }
            const entry = this.getInventoryEntry(key);
            if (!entry) return;

            // If processor is not active for this key, try to find a matching mine recipe
            if (!this.dwarfProcessor.active || this.dwarfProcessor.key !== key){
                const name = entry.data && (entry.data.tile || entry.data.id || entry.data.coord);
                if (!name) return;
                let mineList = null;
                try{ if (this.craftingManager && this.craftingManager.recipes && this.craftingManager.recipes.mine) mineList = this.craftingManager.recipes.mine; }catch(e){}
                try{ if (!mineList && this.mainUI && this.mainUI.recipes && this.mainUI.recipes.mine) mineList = this.mainUI.recipes.mine; }catch(e){}
                if (!mineList) return;
                let found = null;
                for (const r of mineList){
                    const inputs = r.input || [];
                    for (const inp of inputs){ if (inp === name){ found = r; break; } }
                    if (found) break;
                }
                if (!found){
                    this.dwarfProcessor.active = false; this.dwarfProcessor.key = null; this.dwarfProcessor.recipe = null; this.dwarfProcessor.progress = 0; this.dwarfProcessor.timeNeeded = 0;
                    try{ if (this.slotGroupElems && this.slotGroupElems.dwarf && this.slotGroupElems.dwarf[0] && this.slotGroupElems.dwarf[0].border) this.slotGroupElems.dwarf[0].border.visible = false; }catch(e){}
                    return;
                }
                // initialize processor for this key
                this.dwarfProcessor.active = true;
                this.dwarfProcessor.key = key;
                this.dwarfProcessor.recipe = found;
                const speed = (this.player && this.player.currentTool && typeof this.player.currentTool.speed === 'number') ? this.player.currentTool.speed : 1;
                this.dwarfProcessor.timeNeeded = (found.power || 1) / Math.max(0.00001, speed);
                this.dwarfProcessor.progress = 0;
            }

            // accumulate progress
            this.dwarfProcessor.progress += delta;
            // show progress visually via border visibility
            try{ if (this.slotGroupElems && this.slotGroupElems.dwarf && this.slotGroupElems.dwarf[0] && this.slotGroupElems.dwarf[0].border) this.slotGroupElems.dwarf[0].border.visible = this.dwarfProcessor.active; }catch(e){}

            if (this.dwarfProcessor.progress >= (this.dwarfProcessor.timeNeeded || 0)){
                // produce output
                try{
                    const out = this.dwarfProcessor.recipe && this.dwarfProcessor.recipe.output;
                    if (out){
                        this.inventory.addItem(out, 'inventory', false, 'inventory', 1,true);
                    }
                    // decrement input item
                    if (entry.data){
                        entry.data.amount = (entry.data.amount || 1) - 1;
                        if (entry.data.amount <= 0){
                            // remove the inventory entry and clear dwarf slot
                            this.inventory.Inventory.delete(key);
                            this.setSlotKey('dwarf', 0, "");
                        } else {
                            if (this.inventory.Inventory.has(key)) this.inventory.Inventory.get(key).data.amount = entry.data.amount;
                        }
                    }
                }catch(e){}
                // reset processor so next item (if present) will be detected next frame
                this.dwarfProcessor.active = false; this.dwarfProcessor.key = null; this.dwarfProcessor.recipe = null; this.dwarfProcessor.progress = 0; this.dwarfProcessor.timeNeeded = 0;
                try{ this.syncSlotsWithPlayer(); }catch(e){}
            }
        }catch(e){}
    }

    /**
     * Update inventory manager (handle drop into slots)
     * @param {number} delta
     */
    update(delta){
        // Sync player.inventory.items -> UI elements every frame during refactor.
        if (!this.player) return;
        try{ this._processDwarf(delta); }catch(e){}
        if(!this.menu.visible) return;
        // process dwarf converter slot progress
        this.syncSlotsWithPlayer();
        if (this.craftingMenu && this.craftingMenu.visible) this.updateCraftPreview();
        // Start drag when mouse pressed over a slot (if not already dragging)
        const pass = this.menu.passcode;
        if (this.mouse.pressed('left', pass)){
            this._tryStartDrag('left');
            this.mouse.grab(this.mouse.pos, 'left');
        }
        // right-click starts a single-item drag
        if (this.mouse.pressed('right', pass)){
            this._tryStartDrag('right');
            this.mouse.grab(this.mouse.pos, 'right');
        }
        // If currently dragging, detect release to complete drop
        if (this.drag.active){
            if (this.mouse.released('left', pass)){
                this._handleDrop('left');
                this.mouse.releaseGrab('left');
            }
            if (this.mouse.released('right', pass)){
                this._handleDrop('right');
                this.mouse.releaseGrab('right');
            }
        }
    }
    draw(draw){
        // Draw preview while dragging
        if (this.drag && this.drag.active && this.drag.entry){
            const ms = this.mouse.pos;
            if (ms){
                const half = new Vector(this.drag.previewSize.x / 2, this.drag.previewSize.y / 2);
                const drawPos = ms.sub ? ms.sub(half) : new Vector(ms.x - half.x, ms.y - half.y);
                const tileId = (this.drag.entry.data && (this.drag.entry.data.tile || this.drag.entry.data.coord)) ? (this.drag.entry.data.tile || this.drag.entry.data.coord) : (this.drag.entry.data && this.drag.entry.data.id ? this.drag.entry.data.id : null);
                try{ draw.tile(this.drag.entry.sheet, drawPos, this.drag.previewSize, tileId, 0, null, 1, false); }catch(e){}
            }
        }
    }
}