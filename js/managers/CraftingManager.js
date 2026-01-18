import Saver from "./Saver.js";
import Signal from "../modules/Signal.js";
import UIButton from "../UI/jsElements/Button.js";
import UIRect from "../UI/jsElements/Rect.js";
import UIText from "../UI/jsElements/Text.js";
import UITile from "../UI/jsElements/tile.js";
import Menu from "../UI/jsElements/Menu.js";
import Vector from "../modules/Vector.js";
import { v } from "../modules/Vector.js";
import UISlot from "../UI/jsElements/slot.js";

export default class CraftingManager{
    constructor(recipes){
        // Load the recipes
        this.recipes = recipes;
        this.currentItem = 'null';
        this.onCraft = new Signal();
        this.type = 'craft';

        // bound inventory manager reference (set by getMenu)
        this.inv = null;

        // Crafting output tracking (simple flag/state; no signals)
        this._craft = {
            hasItem: false,
            recipe: null,
            match: null, // { recipe, ox, oy }
            outKey: null,
            outAmount: 0,
        };

        // Furnace state (self-contained; no drag hooks)
        this._furnace = {
            active: false,
            recipe: null,
            progress: 0,
            timeNeeded: 0,
            fuelSlotsUsed: [],
            waiting: null, // { timer, target, recipe, outAmount, outKey, placed }
            ui: {
                progressBg: null,
                progressFg: null,
                timerText: null,
            }
        };
    }

    _setMenuElementsVisible(menu, visible){
        try{
            if (!menu || !menu.elements) return;
            for (const el of menu.elements.values()){
                if (el && typeof el.visible === 'boolean') el.visible = !!visible;
            }
        }catch(e){}
    }

    getMenu(meta,inv){
        if(!meta || !meta.type) return;
        // store reference so update() can run standalone
        this.inv = inv;
        const type = meta.type;
        if (type==='furnace'){

            // ensure only one popup menu is interactive at a time
            try{
                if (inv.craftingMenu){
                    inv.craftingMenu.visible = false;
                    this._setMenuElementsVisible(inv.craftingMenu, false);
                }
            }catch(e){}

            // move inventory left so popup fits on the right
            try{ inv.menu.pos.x = 60; inv.menu.pos.y = 180; inv.menu.addOffset(inv.menu.offset); }catch(e){}

            try{
                if (!inv.furnaceMenu){
                    const center = v(60+inv.menu.size.x, 1080/2 - 222);
                    inv.furnaceMenu = new Menu(inv.mouse, inv.keys, center, v(466,582), 3, "#383838ff", true);
                    inv.furnaceMenu.passcode = 'Inventory';
                    const bg = new UIRect(v(10,10), v(446,562), 2, "#222222FF");
                    bg.mouse = inv.mouse; bg.mask = true;
                    inv.furnaceMenu.addElement('bg', bg);

                    const slotSize = 128; const spacing = 10;
                    const gridX = 20; const gridY = 20;
                    inv.furnaceElems = [];
                    for (let r = 0; r < 3; r++){
                        for (let c = 0; c < 3; c++){
                            const idx = r*3 + c;
                            const x = gridX + c * (slotSize + spacing);
                            const y = gridY + r * (slotSize + spacing);
                            const slot = new UISlot(`furnace3x3/${idx}`, new Vector(x, y), new Vector(slotSize, slotSize), 2, "#2a2a2aff");
                            slot.mouse = inv.mouse; slot.passcode = 'Inventory';
                            inv.furnaceMenu.addElement(`furn_slot_${idx}`, slot);
                            const tile = new UITile(null, new Vector(x+10,y+10), new Vector(slotSize-20, slotSize-20), 3);
                            tile.mouse = inv.mouse;
                            inv.furnaceMenu.addElement(`furn_tile_${idx}`, tile);
                            inv.furnaceElems.push({ slot, tile, index: idx });
                        }
                    }

                    // Output slot
                    const outX = 20;
                    const outY = 434;
                    const outOutline = new UIRect(new Vector(outX, outY), new Vector(slotSize, slotSize), 2, "#274e13ff");
                    const outSlot = new UISlot('furnace_output/0', new Vector(outX+7.5, outY+7.5), new Vector(slotSize-15, slotSize-15), 2, "#38761dff");
                    outSlot.mouse = inv.mouse; outSlot.passcode = 'Inventory';
                    inv.furnaceMenu.addElement('furn_output_outline', outOutline);
                    inv.furnaceMenu.addElement('furn_output_slot', outSlot);
                    const outTile = new UITile(null, new Vector(outX+4+7.5, outY+4+7.5), new Vector(slotSize-8-15, slotSize-8-15), 3);
                    outTile.mouse = inv.mouse;
                    inv.furnaceMenu.addElement('furn_output_tile', outTile);

                    // Timer text below the output (for overburn timing)
                    const timerPos = new Vector(158+64, 444+64);
                    const timerText = new UIText("", timerPos, 2, "#b90303ff", 40, {'baseline':'middle','align':'center'});
                    timerText.mouse = inv.mouse;
                    inv.furnaceMenu.addElement('furn_timer_text', timerText);
                    const burnoutText = new UIText("Overburn", timerPos.sub(v(0,40)), 2, "#030101ff", 20, {'baseline':'middle','align':'center'});
                    inv.furnaceMenu.addElement('burnout_text', burnoutText);
                    this._furnace.ui.timerText = timerText;

                    // Progress bar on right (background + foreground)
                    const fX = 434;
                    const pbBg = new UIRect(new Vector(fX, gridY), new Vector(20, 542), 2, '#221100ff'); pbBg.mouse = inv.mouse; pbBg.mask = false;
                    const pbFg = new UIRect(new Vector(fX, gridY + 542), new Vector(20, 0), 2, '#ff3300ff'); pbFg.mouse = inv.mouse; pbFg.mask = false;
                    inv.furnaceMenu.addElement('furn_pb_bg', pbBg);
                    inv.furnaceMenu.addElement('furn_pb_fg', pbFg);
                    this._furnace.ui.progressBg = pbBg;
                    this._furnace.ui.progressFg = pbFg;

                    // register in mainUI menu
                    try{ inv.mainUI.menu.addElement('furnacePopup', inv.furnaceMenu); }catch(e){}

                    // register groups for InventoryManager generic sync
                    if (!inv.slotGroupElems['furnace3x3']) inv.slotGroupElems['furnace3x3'] = [];
                    for (const el of inv.furnaceElems) inv.slotGroupElems['furnace3x3'].push(el);
                    if (!inv.slotGroupElems['furnace_output']) inv.slotGroupElems['furnace_output'] = [];
                    inv.slotGroupElems['furnace_output'].push({ slot: outSlot, tile: outTile, border: null, index: 0 });
                }

                inv.furnaceMenu.visible = true;
                this._setMenuElementsVisible(inv.furnaceMenu, true);
                inv.furnaceMenu.pos.x = 60+inv.menu.size.x;
                inv.furnaceMenu.pos.y = 1080/2 - 222;
                inv.furnaceMenu.addOffset(inv.furnaceMenu.offset);

                // Ensure slot arrays exist
                try{ if (!inv.inventory.slots['furnace3x3']) inv.inventory.slots['furnace3x3'] = new Array(9).fill(""); }catch(e){}
                try{ if (!inv.inventory.slots['furnace_output']) inv.inventory.slots['furnace_output'] = new Array(1).fill(""); }catch(e){}

            }catch(e){}
            return;

        }
        if (type === 'anvil'){
            console.log('hello')

            // ensure only one popup menu is interactive at a time
            try{
                if (inv.furnaceMenu){
                    inv.furnaceMenu.visible = false;
                    this._setMenuElementsVisible(inv.furnaceMenu, false);
                }
            }catch(e){}

            inv.menu.pos.x = 50
            inv.menu.pos.y = 180
            inv.menu.addOffset(inv.menu.offset)
            if (!inv.craftingMenu){
                const center = v(60+inv.menu.size.x, 1080/2 - 222);
                inv.craftingMenu = new Menu(inv.mouse, inv.keys, center, v(582,444), 3, "#383838ff", true);
                inv.craftingMenu.passcode = 'Inventory';
                // background (acts as mask so only edges drag the menu)
                const bg = new UIRect(v(10,10), v(562,424), 2, "#222222FF");
                bg.mouse = inv.mouse;
                bg.mask = true;
                inv.craftingMenu.addElement('bg', bg);
                // build 3x3 grid tiles
                const slotSize = 128; const spacing = 10;
                const gridX = 20; const gridY = 20;
                inv.craftElems = [];
                for (let r = 0; r < 3; r++){
                    for (let c = 0; c < 3; c++){
                        const idx = r*3 + c;
                        const x = gridX + c * (slotSize + spacing);
                        const y = gridY + r * (slotSize + spacing);
                        const slot = new UISlot(`craft3x3/${idx}`, new Vector(x, y), new Vector(slotSize, slotSize), 2, "#2a2a2aff");
                        slot.mouse = inv.mouse; slot.passcode = 'Inventory';
                        inv.craftingMenu.addElement(`craft_slot_${idx}`, slot);
                        const tile = new UITile(null, new Vector(x+10,y+10), new Vector(slotSize-20, slotSize-20), 3);
                        tile.mouse = inv.mouse;
                        inv.craftingMenu.addElement(`craft_tile_${idx}`, tile);
                        inv.craftElems.push({ slot, tile, index: idx });
                    }
                }
                // output tile and craft button
                const outX = gridX + 3*(slotSize + spacing);
                const outY = gridY + slotSize+10;
                // create an output UISlot so users can drag the crafted item out like a normal slot
                const outOutline = new UIRect(new Vector(outX, outY), new Vector(slotSize, slotSize),2,"#274e13ff")
                const outSlot = new UISlot('output/0', new Vector(outX+7.5, outY+7.5), new Vector(slotSize-15, slotSize-15), 2, "#38761dff");
                outSlot.mouse = inv.mouse; outSlot.passcode = 'Inventory';
                inv.craftingMenu.addElement('output_outline', outOutline);
                inv.craftingMenu.addElement('output_slot', outSlot);
                const outTile = new UITile(null, new Vector(outX+4+7.5, outY+4+7.5), new Vector(slotSize-8-15, slotSize-8-15), 3);
                outTile.mouse = inv.mouse;
                inv.craftingMenu.addElement('output_tile', outTile);
                // expose as properties for preview/update
                inv.outputSlot = outSlot;
                inv.outputTile = outTile;
                // Note: drag handling is managed centrally in inv; do not attach UI events here.

                // register in mainUI menu
                inv.mainUI.menu.addElement('craftingPopup', inv.craftingMenu);

                // register these groups so syncSlotsWithPlayer will update them
                if (!inv.slotGroupElems['craft3x3']) inv.slotGroupElems['craft3x3'] = [];
                for (const el of inv.craftElems) inv.slotGroupElems['craft3x3'].push(el);
                if (!inv.slotGroupElems['output']) inv.slotGroupElems['output'] = [];
                // register actual output elem so sync works
                inv.slotGroupElems['output'].push({ slot: outSlot, tile: outTile, border: null, index: 0 });

            }else{
                inv.craftingMenu.visible = true;
            }

            try{ this._setMenuElementsVisible(inv.craftingMenu, true); }catch(e){}
            inv.craftingMenu.pos.x = 60+inv.menu.size.x
            inv.craftingMenu.pos.y = 1080/2 - 222
            inv.craftingMenu.addOffset(inv.craftingMenu.offset)
        }

    }
    close(inv){
        if(inv.craftingMenu){
            inv.craftingMenu.visible = false;
            try{ this._setMenuElementsVisible(inv.craftingMenu, false); }catch(e){}
        }
        if (inv.furnaceMenu){
            inv.furnaceMenu.visible = false;
            try{ this._setMenuElementsVisible(inv.furnaceMenu, false); }catch(e){}
        }
    }

    _countList(arr){
        const m = new Map();
        for (const v of (arr || [])) m.set(v, (m.get(v) || 0) + 1);
        return m;
    }

    _getFuelMap(){
        try{
            if (this.recipes && this.recipes.fuel) return this.recipes.fuel;
        }catch(e){}
        return {};
    }

    _buildFurnaceCounts(inv){
        const nonFuel = new Map();
        const all = new Map();
        const fuelSlots = [];
        const fuelSlotCounts = new Map(); // id -> number of slots containing that fuel
        const fuelMap = this._getFuelMap();
        try{
            const arr = inv.inventory.slots['furnace3x3'] || new Array(9).fill("");
            for (let i = 0; i < 9; i++){
                const key = arr[i];
                if (!key) continue;
                if (!inv.inventory.Inventory || !inv.inventory.Inventory.has(key)) continue;
                const entry = inv.inventory.Inventory.get(key);
                const id = this._entryId(entry);
                if (!id) continue;
                const amt = (entry && entry.data && typeof entry.data.amount === 'number') ? entry.data.amount : 1;
                all.set(id, (all.get(id) || 0) + amt);
                if (fuelMap && fuelMap[id]){
                    fuelSlots.push(i);
                    fuelSlotCounts.set(id, (fuelSlotCounts.get(id) || 0) + 1);
                } else {
                    nonFuel.set(id, (nonFuel.get(id) || 0) + amt);
                }
            }
        }catch(e){}
        return { nonFuel, all, fuelSlots, fuelSlotCounts };
    }

    _findSmeltRecipe(inv){
        try{
            const list = (this.recipes && Array.isArray(this.recipes.smelting)) ? this.recipes.smelting : null;
            if (!list) return null;
            const { nonFuel, fuelSlots, fuelSlotCounts } = this._buildFurnaceCounts(inv);
            for (const r of list){
                const reqIn = this._countList(r.input || []);
                // need at least required counts
                let ok = true;
                for (const [id, need] of reqIn.entries()){
                    if ((nonFuel.get(id) || 0) < need){ ok = false; break; }
                }
                if (!ok) continue;
                // no extraneous non-fuel items
                for (const [haveId, haveAmt] of nonFuel.entries()){
                    if (haveAmt > 0 && !reqIn.has(haveId)) { ok = false; break; }
                }
                if (!ok) continue;

                // verify required fuel ids (slot-based)
                const reqFuelList = Array.isArray(r.fuel) ? r.fuel : [];
                const reqFuelCounts = this._countList(reqFuelList);
                for (const [fid, need] of reqFuelCounts.entries()){
                    if ((fuelSlotCounts.get(fid) || 0) < need){ ok = false; break; }
                }
                if (!ok) continue;

                // also require at least that many fuel slots total
                const reqFuel = Math.max(1, reqFuelList.length || 1);
                if ((fuelSlots || []).length < reqFuel) continue;
                return { recipe: r, fuelSlots };
            }
        }catch(e){}
        return null;
    }

    _consumeFurnaceInputs(inv, recipe){
        try{
            if (!inv || !inv.inventory || !inv.inventory.Inventory) return;
            const consumeBucket = !(recipe && recipe.consume_bucket === false);
            const reqIn = this._countList(recipe.input || []);
            // For each required id, remove that many units from stacks in furnace3x3
            const slots = inv.inventory.slots['furnace3x3'] || [];
            for (const [needId, needCount] of reqIn.entries()){
                if (!consumeBucket && String(needId).includes('bucket')) continue;
                let remaining = needCount;
                for (let i = 0; i < 9 && remaining > 0; i++){
                    const key = slots[i];
                    if (!key || !inv.inventory.Inventory.has(key)) continue;
                    const entry = inv.inventory.Inventory.get(key);
                    const id = this._entryId(entry);
                    if (id !== needId) continue;
                    const amt = (entry && entry.data && typeof entry.data.amount === 'number') ? entry.data.amount : 1;
                    const take = Math.min(amt, remaining);
                    const next = amt - take;
                    if (entry && entry.data) entry.data.amount = next;
                    if (next <= 0) inv.inventory.clearSlot('furnace3x3', i);
                    else inv.inventory.Inventory.get(key).data.amount = next;
                    remaining -= take;
                }
            }
        }catch(e){}
    }

    _consumeFurnaceFuel(inv, fuelSlots){
        try{
            const fuelMap = this._getFuelMap();
            const slots = inv.inventory.slots['furnace3x3'] || [];
            for (const idx of (fuelSlots || [])){
                const key = slots[idx];
                if (!key || !inv.inventory.Inventory || !inv.inventory.Inventory.has(key)) continue;
                const entry = inv.inventory.Inventory.get(key);
                const id = this._entryId(entry);
                if (!id || !fuelMap || !fuelMap[id]) continue;
                const power = Math.max(1, Number(fuelMap[id]) || 1);
                const chance = 1 / power;
                if (Math.random() < chance){
                    const amt = (entry && entry.data && typeof entry.data.amount === 'number') ? entry.data.amount : 1;
                    const next = amt - 1;
                    if (entry && entry.data) entry.data.amount = next;
                    if (next <= 0) inv.inventory.clearSlot('furnace3x3', idx);
                    else inv.inventory.Inventory.get(key).data.amount = next;
                }
            }
        }catch(e){}
    }

    _clearFurnaceOutput(inv){
        try{ inv.inventory.clearSlot('furnace_output', 0); }catch(e){}
    }

    _placeFurnaceOutput(inv, recipe){
        try{
            if (!recipe || !recipe.output) return false;
            const amt = (typeof recipe.amount === 'number') ? recipe.amount : 1;
            // only place if output slot empty
            const outKey = (inv.inventory.slots['furnace_output'] && inv.inventory.slots['furnace_output'][0]) ? inv.inventory.slots['furnace_output'][0] : "";
            if (outKey && outKey !== '') return false;
            return !!inv.inventory.addItem(recipe.output, 'furnace_output/0', false, 'inventory', Math.max(1, amt));
        }catch(e){}
        return false;
    }

    updateFurnace(delta){
        const inv = this.inv;
        try{
            if (!inv || !inv.inventory || !inv.inventory.slots || !inv.inventory.Inventory) return;
            if (!inv.furnaceMenu || !inv.furnaceMenu.visible) return;
            if (!inv.inventory.slots['furnace3x3']) inv.inventory.slots['furnace3x3'] = new Array(9).fill("");
            if (!inv.inventory.slots['furnace_output']) inv.inventory.slots['furnace_output'] = new Array(1).fill("");

            // UI: clear timer text by default
            try{ if (this._furnace.ui.timerText) this._furnace.ui.timerText.text = ''; }catch(e){}

            // Handle waiting window (non-auto recipes)
            if (this._furnace.waiting){
                const w = this._furnace.waiting;
                w.timer += delta;
                const rounded = Math.round(w.timer);
                const target = (typeof w.target === 'number') ? w.target : 0;

                // check if player took output
                try{
                    const outKeyNow = (inv.inventory.slots['furnace_output'] && inv.inventory.slots['furnace_output'][0]) ? inv.inventory.slots['furnace_output'][0] : "";
                    const outEntryNow = (outKeyNow && inv.inventory.Inventory.has(outKeyNow)) ? inv.inventory.Inventory.get(outKeyNow) : null;
                    const outAmtNow = outEntryNow && outEntryNow.data ? (outEntryNow.data.amount || 1) : 0;
                    if (w.placed && (!outKeyNow || outAmtNow <= 0 || (w.outKey && outKeyNow !== w.outKey) || outAmtNow < (w.outAmount || 0))){
                        // treated as taken
                        this._furnace.waiting = null;
                        return;
                    }
                }catch(e){}

                if (rounded < target){
                    // keep output hidden
                    if (w.placed){
                        this._clearFurnaceOutput(inv);
                        w.placed = false; w.outKey = null; w.outAmount = 0;
                    }
                    try{ if (this._furnace.ui.timerText) this._furnace.ui.timerText.text = String(Math.max(0, target - rounded)); }catch(e){}
                } else if (rounded === target){
                    // show output during this rounded second
                    if (!w.placed){
                        const ok = this._placeFurnaceOutput(inv, w.recipe);
                        if (ok){
                            const outKey2 = (inv.inventory.slots['furnace_output'] && inv.inventory.slots['furnace_output'][0]) ? inv.inventory.slots['furnace_output'][0] : "";
                            const outEntry2 = (outKey2 && inv.inventory.Inventory.has(outKey2)) ? inv.inventory.Inventory.get(outKey2) : null;
                            const amt2 = outEntry2 && outEntry2.data ? (outEntry2.data.amount || 1) : (w.recipe.amount || 1);
                            w.placed = true; w.outKey = outKey2; w.outAmount = amt2;
                        }
                    }
                    try{ if (this._furnace.ui.timerText) this._furnace.ui.timerText.text = 'TAKE IT NOW'; }catch(e){}
                } else {
                    // burn
                    if (w.placed) this._clearFurnaceOutput(inv);
                    this._furnace.waiting = null;
                    try{ if (this._furnace.ui.timerText) this._furnace.ui.timerText.text = 'Burned'; }catch(e){}
                }
                return;
            }

            // If actively smelting, advance time
            if (this._furnace.active){
                this._furnace.progress += delta;
                // progress bar
                try{
                    const bg = this._furnace.ui.progressBg;
                    const fg = this._furnace.ui.progressFg;
                    if (bg && fg){
                        const totalH = bg.size ? bg.size.y : 542;
                        const t = Math.min(1, Math.max(0, this._furnace.progress / Math.max(0.00001, this._furnace.timeNeeded || 1)));
                        // fill from bottom up
                        fg.pos = new Vector(bg.pos.x, bg.pos.y + (totalH * (1 - t)));
                        fg.size = new Vector(bg.size ? bg.size.x : 20, Math.max(1, Math.floor(totalH * t)));
                    }
                }catch(e){}

                if (this._furnace.progress >= (this._furnace.timeNeeded || 0)){
                    const recipe = this._furnace.recipe;
                    const usedFuel = (this._furnace.fuelSlotsUsed || []).slice();
                    // reset active
                    this._furnace.active = false;
                    this._furnace.recipe = null;
                    this._furnace.progress = 0;
                    this._furnace.timeNeeded = 0;
                    this._furnace.fuelSlotsUsed = [];
                    try{
                        const bg = this._furnace.ui.progressBg;
                        const fg = this._furnace.ui.progressFg;
                        if (bg && fg){
                            fg.size = new Vector(bg.size ? bg.size.x : 20, 0);
                            fg.pos = new Vector(bg.pos.x, bg.pos.y + (bg.size ? bg.size.y : 542));
                        }
                    }catch(e){}

                    // consume inputs & fuel
                    try{ this._consumeFurnaceInputs(inv, recipe); }catch(e){}
                    try{ this._consumeFurnaceFuel(inv, usedFuel); }catch(e){}

                    // burn chance when over-fueled
                    const used = usedFuel.length;
                    const reqFuel = (recipe && Array.isArray(recipe.fuel)) ? recipe.fuel.length : 1;
                    const burnChance = (used > reqFuel) ? (1 / Math.max(1, used)) : 0;
                    const burned = (burnChance > 0) ? (Math.random() < burnChance) : false;
                    if (burned) return;

                    // output
                    if (recipe){
                        if (recipe.auto){
                            try{ inv.inventory.addItem(recipe.output, 'inventory', false, 'inventory', Math.max(1, recipe.amount || 1), true); }catch(e){}
                        } else {
                            const target = (typeof recipe.overburn === 'number') ? recipe.overburn : 0;
                            this._furnace.waiting = { timer: 0, target, recipe, outAmount: 0, outKey: null, placed: false };
                        }
                    }
                }
                return;
            }

            // Not active and not waiting: update preview + maybe start
            const found = this._findSmeltRecipe(inv);
            // preview uses the furnace output tile itself when the slot is empty
            const preview = (inv.slotGroupElems && inv.slotGroupElems['furnace_output'] && inv.slotGroupElems['furnace_output'][0]) ? inv.slotGroupElems['furnace_output'][0].tile : null;
            if (found && found.recipe){
                // update preview tile
                try{
                    const resolved = inv.inventory.getItem ? inv.inventory.getItem(found.recipe.output) : null;
                    if (preview){
                        preview.sheet = resolved ? resolved.sheet : null;
                        preview.tile = resolved && resolved.data && (resolved.data.tile || resolved.data.id || resolved.data.coord) ? (resolved.data.tile || resolved.data.id || resolved.data.coord) : found.recipe.output;
                        preview.data = preview.data || {}; preview.data.amount = found.recipe.amount || 1;
                    }
                }catch(e){}

                // start only if furnace_output empty
                const outKey = (inv.inventory.slots['furnace_output'] && inv.inventory.slots['furnace_output'][0]) ? inv.inventory.slots['furnace_output'][0] : "";
                if (!outKey || outKey === ''){
                    const recipe = found.recipe;
                    const reqFuel = (recipe && Array.isArray(recipe.fuel)) ? recipe.fuel.length : 1;
                    const used = (found.fuelSlots || []).length;
                    const base = (recipe && typeof recipe.power === 'number') ? recipe.power : 1;
                    const speedMul = Math.max(1, used / Math.max(1, reqFuel));
                    this._furnace.active = true;
                    this._furnace.recipe = recipe;
                    this._furnace.progress = 0;
                    this._furnace.timeNeeded = base / speedMul;
                    this._furnace.fuelSlotsUsed = (found.fuelSlots || []).slice();
                    try{
                        const bg = this._furnace.ui.progressBg;
                        const fg = this._furnace.ui.progressFg;
                        if (bg && fg){
                            fg.size = new Vector(bg.size ? bg.size.x : 20, 0);
                            fg.pos = new Vector(bg.pos.x, bg.pos.y + (bg.size ? bg.size.y : 542));
                        }
                    }catch(e){}
                }
            } else {
                // clear preview tile
                try{ if (preview){ preview.sheet = null; preview.tile = null; preview.data = preview.data || {}; preview.data.amount = 0; } }catch(e){}
            }
        }catch(e){}
    }

    _entryId(entry){
        try{
            return entry && entry.data && (entry.data.tile || entry.data.id || entry.data.coord) ? (entry.data.tile || entry.data.id || entry.data.coord) : null;
        }catch(e){}
        return null;
    }

    _buildGrid(inv){
        const grid = [["","",""] , ["","",""] , ["","",""]];
        try{
            const arr = (inv && inv.inventory && inv.inventory.slots) ? (inv.inventory.slots['craft3x3'] || new Array(9).fill("")) : new Array(9).fill("");
            for (let i = 0; i < 9; i++){
                const r = Math.floor(i/3); const c = i%3;
                const key = arr[i];
                if (key && inv.inventory && inv.inventory.Inventory && inv.inventory.Inventory.has(key)){
                    const entry = inv.inventory.Inventory.get(key);
                    grid[r][c] = this._entryId(entry) || '';
                } else grid[r][c] = '';
            }
        }catch(e){}
        return grid;
    }

    _computeCraftMax(inv, match){
        try{
            if (!inv || !inv.inventory || !match || !match.recipe) return 0;
            const recipe = match.recipe;
            const pattern = recipe.input || [];
            // compute bounding box of non-empty cells
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let y = 0; y < pattern.length; y++){
                const row = pattern[y] || [];
                for (let x = 0; x < row.length; x++){
                    const need = row[x];
                    if (need !== null && typeof need !== 'undefined' && String(need).trim() !== ''){
                        if (x < minX) minX = x;
                        if (y < minY) minY = y;
                        if (x > maxX) maxX = x;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            if (minX === Infinity) return 0;
            const pW = maxX - minX + 1;
            const pH = maxY - minY + 1;
            const ox = match.ox || 0;
            const oy = match.oy || 0;
            let mins = [];
            for (let y = 0; y < pH; y++){
                for (let x = 0; x < pW; x++){
                    const srcX = minX + x; const srcY = minY + y;
                    const need = (pattern[srcY] && typeof pattern[srcY][srcX] !== 'undefined') ? pattern[srcY][srcX] : '';
                    if (!need || String(need).trim() === '') continue;
                    const idx = (oy + y) * 3 + (ox + x);
                    const key = (inv.inventory.slots['craft3x3'] && inv.inventory.slots['craft3x3'][idx]) ? inv.inventory.slots['craft3x3'][idx] : null;
                    if (!key || !inv.inventory.Inventory || !inv.inventory.Inventory.has(key)) return 0;
                    const entry = inv.inventory.Inventory.get(key);
                    const amt = (entry && entry.data && typeof entry.data.amount === 'number') ? entry.data.amount : 1;
                    mins.push(Math.max(0, Math.floor(amt / 1)));
                }
            }
            if (mins.length === 0) return 0;
            return Math.max(0, Math.min(...mins));
        }catch(e){}
        return 0;
    }

    _consumeInputs(inv, match, times = 1){
        try{
            if (!inv || !inv.inventory || !inv.inventory.slots || !inv.inventory.Inventory) return;
            if (!match || !match.recipe) return;
            const recipe = match.recipe;
            const pattern = recipe.input || [];
            // compute bounding box
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let y = 0; y < pattern.length; y++){
                const row = pattern[y] || [];
                for (let x = 0; x < row.length; x++){
                    const need = row[x];
                    if (need !== null && typeof need !== 'undefined' && String(need).trim() !== ''){
                        if (x < minX) minX = x;
                        if (y < minY) minY = y;
                        if (x > maxX) maxX = x;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            if (minX === Infinity) return;
            const pW = maxX - minX + 1;
            const pH = maxY - minY + 1;
            const ox = match.ox || 0;
            const oy = match.oy || 0;
            for (let y = 0; y < pH; y++){
                for (let x = 0; x < pW; x++){
                    const srcX = minX + x; const srcY = minY + y;
                    const need = (pattern[srcY] && typeof pattern[srcY][srcX] !== 'undefined') ? pattern[srcY][srcX] : '';
                    if (!need || String(need).trim() === '') continue;
                    const idx = (oy + y) * 3 + (ox + x);
                    const key = (inv.inventory.slots['craft3x3'] && inv.inventory.slots['craft3x3'][idx]) ? inv.inventory.slots['craft3x3'][idx] : null;
                    if (!key || !inv.inventory.Inventory.has(key)) continue;
                    const entry = inv.inventory.Inventory.get(key);
                    const amt = (entry && entry.data && typeof entry.data.amount === 'number') ? entry.data.amount : 1;
                    const next = amt - times;
                    if (entry && entry.data) entry.data.amount = next;
                    if (next <= 0){
                        inv.inventory.clearSlot('craft3x3', idx);
                    } else {
                        inv.inventory.Inventory.get(key).data.amount = next;
                    }
                }
            }
        }catch(e){}
    }

    _clearOutput(inv){
        try{
            if (!inv || !inv.inventory) return;
            inv.inventory.clearSlot('output', 0);
        }catch(e){}
    }

    _setOutput(inv, itemId, amount){
        try{
            if (!inv || !inv.inventory || !inv.inventory.slots || !inv.inventory.Inventory) return false;
            if (!itemId) return false;
            const outKey = (inv.inventory.slots['output'] && inv.inventory.slots['output'][0]) ? inv.inventory.slots['output'][0] : "";
            if (outKey && inv.inventory.Inventory.has(outKey)){
                const entry = inv.inventory.Inventory.get(outKey);
                const id = this._entryId(entry);
                if (id === itemId){
                    // same output type: just update amount
                    const clamped = Math.max(1, Math.min(64, amount || 1));
                    if (entry && entry.data) entry.data.amount = clamped;
                    inv.inventory.Inventory.get(outKey).data.amount = clamped;
                    return true;
                }
            }
            // different output (or none): clear and re-add
            this._clearOutput(inv);
            const clamped = Math.max(1, Math.min(64, amount || 1));
            return !!inv.inventory.addItem(itemId, 'output/0', false, 'inventory', clamped);
        }catch(e){}
        return false;
    }

    /**
     * Update crafting: scan 3x3, keep output slot in sync, and consume inputs
     * only when the output stack is actually taken.
     */
    updateCrafting(delta){
        const inv = this.inv;
        try{
            if (!inv || !inv.inventory || !inv.inventory.slots || !inv.inventory.Inventory) return;
            if (!inv.craftingMenu || !inv.craftingMenu.visible) return;
            if (!inv.inventory.slots['craft3x3']) inv.inventory.slots['craft3x3'] = new Array(9).fill("");
            if (!inv.inventory.slots['output']) inv.inventory.slots['output'] = new Array(1).fill("");

            // Current output state
            const outKeyNow = (inv.inventory.slots['output'] && inv.inventory.slots['output'][0]) ? inv.inventory.slots['output'][0] : "";
            const outEntryNow = (outKeyNow && inv.inventory.Inventory.has(outKeyNow)) ? inv.inventory.Inventory.get(outKeyNow) : null;
            const outIdNow = this._entryId(outEntryNow);
            const outAmtNow = outEntryNow && outEntryNow.data ? (outEntryNow.data.amount || 1) : 0;

            // If we previously had an output and it changed (taken/partial taken), consume inputs
            if (this._craft.hasItem && this._craft.recipe && this._craft.match){
                const per = (this._craft.recipe && typeof this._craft.recipe.amount === 'number') ? this._craft.recipe.amount : 1;
                const prevAmt = this._craft.outAmount || 0;
                const prevOutKey = this._craft.outKey;
                const sameKey = (prevOutKey && outKeyNow && prevOutKey === outKeyNow);
                const sameType = (outIdNow && this._craft.recipe && outIdNow === this._craft.recipe.output);

                // Output removed entirely OR key/type changed => treat as full take
                if (!outKeyNow || outAmtNow <= 0 || !sameType || (!sameKey && prevAmt > 0)){
                    const craftsTaken = Math.max(0, Math.floor(prevAmt / Math.max(1, per)));
                    if (craftsTaken > 0) this._consumeInputs(inv, this._craft.match, craftsTaken);
                    this._craft.hasItem = false;
                    this._craft.recipe = null;
                    this._craft.match = null;
                    this._craft.outKey = null;
                    this._craft.outAmount = 0;
                } else if (outAmtNow < prevAmt){
                    // Partial take.
                    // If the remaining stack is not a multiple of the recipe output amount,
                    // treat it as taking the full previously-offered craft stack.
                    const removed = prevAmt - outAmtNow;
                    if ((outAmtNow % Math.max(1, per)) !== 0){
                        const craftsTaken = Math.max(0, Math.floor(prevAmt / Math.max(1, per)));
                        if (craftsTaken > 0) this._consumeInputs(inv, this._craft.match, craftsTaken);
                        // We no longer "own" the output; leave the remaining items as a real stack.
                        this._craft.hasItem = false;
                        this._craft.recipe = null;
                        this._craft.match = null;
                        this._craft.outKey = null;
                        this._craft.outAmount = 0;
                    } else {
                        const craftsTaken = Math.max(0, Math.floor(removed / Math.max(1, per)));
                        if (craftsTaken > 0) this._consumeInputs(inv, this._craft.match, craftsTaken);
                    }
                }
            }

            // Compute current recipe match from the grid
            const grid = this._buildGrid(inv);
            const match = this.findMatch(grid, true);

            if (match && match.recipe){
                const craftMax = this._computeCraftMax(inv, match);
                if (craftMax <= 0){
                    // no craft possible; clear any output we were managing
                    if (this._craft.hasItem){
                        this._clearOutput(inv);
                    }
                    this._craft.hasItem = false;
                    this._craft.recipe = null;
                    this._craft.match = null;
                    this._craft.outKey = null;
                    this._craft.outAmount = 0;
                    try{ if (inv.syncSlotsWithPlayer) inv.syncSlotsWithPlayer(); }catch(e){}
                    return;
                }

                const per = (match.recipe && typeof match.recipe.amount === 'number') ? match.recipe.amount : 1;
                const craftsByStack = Math.max(1, Math.floor(64 / Math.max(1, per)));
                const crafts = Math.max(1, Math.min(craftMax, craftsByStack));
                const outAmount = per * crafts;

                // Only materialize/adjust output if we own it OR it's currently empty.
                const canWriteOutput = (!outKeyNow || outKeyNow === '') || (this._craft.hasItem && this._craft.outKey && outKeyNow === this._craft.outKey);
                const placed = canWriteOutput ? this._setOutput(inv, match.recipe.output, outAmount) : false;
                if (placed){
                    // refresh output bookkeeping from actual slot
                    const outKey2 = (inv.inventory.slots['output'] && inv.inventory.slots['output'][0]) ? inv.inventory.slots['output'][0] : "";
                    const outEntry2 = (outKey2 && inv.inventory.Inventory.has(outKey2)) ? inv.inventory.Inventory.get(outKey2) : null;
                    const amt2 = outEntry2 && outEntry2.data ? (outEntry2.data.amount || 1) : outAmount;
                    this._craft.hasItem = true;
                    this._craft.recipe = match.recipe;
                    this._craft.match = match;
                    this._craft.outKey = outKey2;
                    this._craft.outAmount = amt2;
                }
            } else {
                // No recipe matches. If we had an output managed by crafting, clear it.
                if (this._craft.hasItem){
                    this._clearOutput(inv);
                }
                this._craft.hasItem = false;
                this._craft.recipe = null;
                this._craft.match = null;
                this._craft.outKey = null;
                this._craft.outAmount = 0;
            }

            try{ if (inv.syncSlotsWithPlayer) inv.syncSlotsWithPlayer(); }catch(e){}
        }catch(e){}
    }

    /**
     * Given a 3x3 grid (array of arrays) of item ids (or empty strings/null),
     * attempt to match a recipe. Returns the matching recipe object or null.
     * @param {Array<Array<string>>} grid
     */
    matchGrid(grid, strict = false){
        try{
            if (!this.recipes || !this.recipes.crafting) return null;
            // Iterate all recipe groups (1x1, 3x3, etc.) and all recipes within
            for (const sizeKey in this.recipes.crafting){
                const list = this.recipes.crafting[sizeKey] || [];
                for (const r of list){
                    const pattern = r.input || [];
                    // Determine pattern bounding box of non-empty cells
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (let y = 0; y < pattern.length; y++){
                        const row = pattern[y] || [];
                        for (let x = 0; x < row.length; x++){
                            const need = row[x];
                            if (need !== null && typeof need !== 'undefined' && String(need).trim() !== ''){
                                if (x < minX) minX = x;
                                if (y < minY) minY = y;
                                if (x > maxX) maxX = x;
                                if (y > maxY) maxY = y;
                            }
                        }
                    }
                    // If pattern has no non-empty cells, skip it
                    if (minX === Infinity) continue;
                    const pW = maxX - minX + 1;
                    const pH = maxY - minY + 1;
                    // Normalize pattern into a compact array of size pH x pW
                    const norm = [];
                    for (let y = 0; y < pH; y++){
                        norm[y] = [];
                        for (let x = 0; x < pW; x++){
                            const srcY = minY + y; const srcX = minX + x;
                            const srcRow = pattern[srcY] || [];
                            const v = (typeof srcRow[srcX] === 'string' || typeof srcRow[srcX] === 'number') ? String(srcRow[srcX]) : '';
                            norm[y][x] = v || '';
                        }
                    }
                    // Try all translations of the compact pattern within the 3x3 grid
                    const gridW = 3; const gridH = 3;
                    for (let oy = 0; oy <= gridH - pH; oy++){
                        for (let ox = 0; ox <= gridW - pW; ox++){
                            let ok = true;
                            for (let y = 0; y < pH; y++){
                                for (let x = 0; x < pW; x++){
                                    const need = norm[y][x] || '';
                                    const have = (grid[oy+y] && typeof grid[oy+y][ox+x] !== 'undefined') ? (grid[oy+y][ox+x] || '') : '';
                                    if (need === ''){
                                        if (strict){
                                            // strict mode: blank required to be blank
                                            if (have !== ''){ ok = false; break; }
                                        } else {
                                            // permissive mode: ignore blanks in pattern
                                            continue;
                                        }
                                        continue;
                                    }
                                    if (need !== have){ ok = false; break; }
                                }
                                if (!ok) break;
                            }
                            // ensure all cells outside the matched region are empty (only in strict mode)
                            if (ok && strict){
                                for (let gy = 0; gy < 3 && ok; gy++){
                                    for (let gx = 0; gx < 3; gx++){
                                        if (gy >= oy && gy < oy + pH && gx >= ox && gx < ox + pW) continue;
                                        const outsideHave = (grid[gy] && typeof grid[gy][gx] !== 'undefined') ? (grid[gy][gx] || '') : '';
                                        if (outsideHave && String(outsideHave).trim() !== ''){ ok = false; break; }
                                    }
                                }
                            }
                            if (ok) return r;
                        }
                    }
                }
            }
        }catch(e){}
        return null;
    }

    /**
     * Like matchGrid but returns the matching recipe plus the translation offset
     * within the 3x3 grid when a recipe matches. Returns { recipe, ox, oy } or null.
     * @param {Array<Array<string>>} grid
     */
    findMatch(grid, strict = false){
        try{
            if (!this.recipes || !this.recipes.crafting) return null;
            for (const sizeKey in this.recipes.crafting){
                const list = this.recipes.crafting[sizeKey] || [];
                for (const r of list){
                    const pattern = r.input || [];
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (let y = 0; y < pattern.length; y++){
                        const row = pattern[y] || [];
                        for (let x = 0; x < row.length; x++){
                            const need = row[x];
                            if (need !== null && typeof need !== 'undefined' && String(need).trim() !== ''){
                                if (x < minX) minX = x;
                                if (y < minY) minY = y;
                                if (x > maxX) maxX = x;
                                if (y > maxY) maxY = y;
                            }
                        }
                    }
                    if (minX === Infinity) continue;
                    const pW = maxX - minX + 1;
                    const pH = maxY - minY + 1;
                    const norm = [];
                    for (let y = 0; y < pH; y++){
                        norm[y] = [];
                        for (let x = 0; x < pW; x++){
                            const srcY = minY + y; const srcX = minX + x;
                            const srcRow = pattern[srcY] || [];
                            const v = (typeof srcRow[srcX] === 'string' || typeof srcRow[srcX] === 'number') ? String(srcRow[srcX]) : '';
                            norm[y][x] = v || '';
                        }
                    }
                    const gridW = 3; const gridH = 3;
                    for (let oy = 0; oy <= gridH - pH; oy++){
                        for (let ox = 0; ox <= gridW - pW; ox++){
                            let ok = true;
                            for (let y = 0; y < pH; y++){
                                for (let x = 0; x < pW; x++){
                                    const need = norm[y][x] || '';
                                    const have = (grid[oy+y] && typeof grid[oy+y][ox+x] !== 'undefined') ? (grid[oy+y][ox+x] || '') : '';
                                    if (need === ''){
                                        if (strict){
                                            if (have !== ''){ ok = false; break; }
                                        } else {
                                            continue;
                                        }
                                        continue;
                                    }
                                    if (need !== have){ ok = false; break; }
                                }
                                if (!ok) break;
                            }
                            // ensure all cells outside the matched region are empty (only in strict mode)
                            if (ok && strict){
                                for (let gy = 0; gy < 3 && ok; gy++){
                                    for (let gx = 0; gx < 3; gx++){
                                        if (gy >= oy && gy < oy + pH && gx >= ox && gx < ox + pW) continue;
                                        const outsideHave = (grid[gy] && typeof grid[gy][gx] !== 'undefined') ? (grid[gy][gx] || '') : '';
                                        if (outsideHave && String(outsideHave).trim() !== ''){ ok = false; break; }
                                    }
                                }
                            }
                            if (ok) return { recipe: r, ox, oy };
                        }
                    }
                }
            }
        }catch(e){}
        return null;
    }
    
    update(delta){

        try{ this.updateCrafting(delta); }catch(e){}
        try{ this.updateFurnace(delta); }catch(e){}
    }
}