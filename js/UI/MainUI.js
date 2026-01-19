import Vector from '../modules/Vector.js';
import UIText from './jsElements/Text.js';
import Menu from './jsElements/Menu.js';
import Signal from '../modules/Signal.js';
import Color from '../modules/Color.js';
import UIButton from './jsElements/Button.js'
import UIRect from './jsElements/Rect.js'
import UIImage from './jsElements/Image.js'
import UITile from './jsElements/tile.js'

import InventoryManager from '../managers/InventoryManager.js';
import CraftingManager from '../managers/CraftingManager.js';

/**
 * @typedef {import('../modules/Spritesheet.js').default} SpriteSheetType
 * @typedef {import('../modules/Vector.js').default} VectorType
 * @typedef {import('../modules/Keys.js').default} KeysType
 * @typedef {import('../modules/Mouse.js').default} MouseType
 * @typedef {import('../modules/Draw.js').default} DrawType
 */
export default class MainUI {
    /**
     * @param {DrawType} Draw 
     * @param {MouseType} mouse 
     * @param {KeysType} keys 
     * @param {*} player 
     */
    constructor(Draw,mouse,keys,scene,opts) {
        // General
        this.scene = scene;
        this.player = scene.player;
        this.Draw = Draw;
        this.mouse = mouse;
        this.keys = keys;
        this.opts = opts || {};
        this.visible = true;

        this.colors = {
            'bg': new Color(20,20,20,1,'rgb'),
            'h1': new Color(255,255,255,1,'rgb')
        }
        
        this.recipes = opts.recipes
        this.menu = new Menu(this.mouse,this.keys,new Vector(0,-1),new Vector(0,0),1,this.colors.bg)

        this.createText()
        this.createSlots()
        this.createInventory()
        this.createOther()  

        // Scroll popup (lore/recipe/svg)
        this.scrollMenu = null;
        this._scrollPopupKey = null;
        try {
            const player = this.scene && this.scene.player;
            if (player && player.onScroll) {
                player.onScroll.connect((payload) => {
                    try { this.openScrollPopup(payload); } catch (e) {}
                });
            }
        } catch (e) {}

        
    }

    createText(){
        const heightText = new UIText('Height:',new Vector(20,50),1,this.colors.h1,25)
        const heightText2 = new UIText(0,new Vector(110,50),1,this.colors.h1,25)
        const heightText3 = new UIText("Goal: 5000",new Vector(20,90),1,this.colors.h1,25)
        const itemText = new UIText("Selected:",new Vector(20,120),1,this.colors.h1,25)
        this.menu.addElement('heightText',heightText)
        this.menu.addElement('heightText2',heightText2)
        this.menu.addElement('heightText3',heightText3)
        this.menu.addElement('itemText',itemText)
    }
    createSlots(){
        this.slots = ['','','','','']
        const slotOffset = new Vector(30,230)
        const slotSpacing = 30
        const slotSize = 140
        this._slotElems = []
        // load slot background image once
        try {
            this._slotImg = new Image();
            // Use a relative path so the asset resolves correctly on GitHub Pages
            this._slotImg.src = 'Assets/ui/itemslot.png';
        } catch (e) {
            this._slotImg = null;
        }
        // Add UI background
        let bg = new UIRect(new Vector(0,0),new Vector(200,1080),2,'#2c2c2cAA')
        this.menu.addElement('slot-bg',bg)
        // Create five slot elements inside the menu
        for (let i = 0; i < this.slots.length; i++) {
            const x = slotOffset.x; // place under text area
            const y = slotOffset.y + i * (slotSize + slotSpacing);

            // background image (slot graphic)
            const bg = new UIImage(this._slotImg, new Vector(x, y), new Vector(slotSize, slotSize), 2,false);
            this.menu.addElement(`slotBg${i}`, bg);

            // tile renderer (will be updated each frame)
            // try to use tilesheet via resources when available; default to null
            let sheet = null;
            const tile = new UITile(sheet, new Vector(x + 8, y + 8), new Vector(slotSize - 16, slotSize - 16), 2);
            tile.tile = null;
            this.menu.addElement(`slotTile${i}`, tile);

            // selection border rect (hidden by default)
            const border = new UIRect(new Vector(x + 4, y + 4), new Vector(slotSize -8, slotSize -8), 4, '#FFFFFF44',false,true,8,'#00ff22aa');
            border.visible = false;
            this.menu.addElement(`slotBorder${i}`, border);


            this._slotElems.push({ bg, tile, border, x, y, size: slotSize});
        }
    }
    createInventory(){
        // Inventory signals
        this.onToggleInventory = new Signal()
        
        // Inventory button
        const InventoryButton = new UIButton(this.mouse,this.keys,new Vector(40,40),new Vector(120,120),2,'e')
        InventoryButton.onPressed.left.connect(()=>{
            this.onToggleInventory.emit()
        })
        InventoryButton.passcode = "Inventory"
        this.menu.addElement('inventoryButton',InventoryButton)
        
        
        let InventroyImage = new Image();
        InventroyImage.src = 'Assets/ui/bundle.png';
        const InventoryImageElement = new UIImage(InventroyImage, new Vector(50, 50), new Vector(100, 100), 2,false);
        this.menu.addElement(`inventoryButtonImage`, InventoryImageElement);
        
        const resources = (this.scene && this.scene.SpriteImages) ? this.scene.SpriteImages : (this.opts && this.opts.resources ? this.opts.resources : null);
        this.InventoryManager = new InventoryManager(this, resources)
        // register crafting manager and hook player.onCraft to open expanded inventory
        try{ this.CraftingManager = new CraftingManager(this.recipes); }catch(e){}
        try{ this.InventoryManager.setCraftingManager(this.CraftingManager); }catch(e){}
        // When player uses an anvil (onCraft), open inventory and expand it
        try{
            const player = this.scene.player;
            if (player && player.onCraft) player.onCraft.connect((target,tile)=>{
                try{
                    // open inventory UI in crafting mode; pass meta from recipes if available
                    const meta = { type: (tile && tile.id) ? tile.id : 'anvil', size: [3,3], target };
                    try{ this.InventoryManager.open(meta); }catch(e){}
                }catch(e){}
            })
        }catch(e){}
    }
    // update slot visuals each frame
    _updateSlots() {
        if (!this._slotElems) return;
        const player = this.scene.player;
        for (let i = 0; i < this._slotElems.length; i++) {
            const el = this._slotElems[i];
            // Determine which inventory key is in the hotbar slot and resolve its entry.
            let entry = null;
            try {
                if (player && player.inventory && player.inventory.slots && Array.isArray(player.inventory.slots.hotbar) && i < player.inventory.slots.hotbar.length) {
                    const key = player.inventory.slots.hotbar[i];
                    if (key && player.inventory.Inventory && player.inventory.Inventory.has(key)) {
                        entry = player.inventory.Inventory.get(key);
                    } else if (this.InventoryManager) {
                        // fallback: InventoryManager helper
                        entry = this.InventoryManager.getInventoryEntry ? this.InventoryManager.getInventoryEntry(key) : null;
                    }
                }

            } catch (e) { entry = null; }

            // Apply resolved entry to UITile
            if (entry && entry.sheet) {
                el.tile.sheet = entry.sheet;
                if (entry.data && entry.data.tile) el.tile.tile = entry.data.tile;
                else if (entry.data && entry.data.coord) el.tile.tile = entry.data.coord;
                else el.tile.tile = entry.data && entry.data.id ? entry.data.id : null;
                try { el.tile.data = el.tile.data || {}; el.tile.data.amount = entry.data && entry.data.amount ? entry.data.amount : 0; } catch (e) {}
            } else {
                el.tile.sheet = null; el.tile.tile = null; try { el.tile.data = el.tile.data || {}; el.tile.data.amount = 0; } catch (e) {}
            }

            // highlight currently selected slot (player.selectedIndex)
            if (player.selectedSlot === i) {
                el.border.visible = true;
                el.border.color = '#FFFFFF88';
            } else {
                el.border.visible = false;
            }
        }
    }
    createOther(){
    }

    _describeRecipe(recipe) {
        if (!recipe) return '';
        // allow simple string refs
        if (typeof recipe === 'string') return recipe;
        if (typeof recipe !== 'object') return '';

        const kind = recipe.kind || recipe.type || '';
        const out = [];
        if (kind) out.push(`Recipe: ${kind}`);

        // Inline recipe
        if (recipe.output) out.push(`Output: ${recipe.output}${recipe.amount ? ' x' + recipe.amount : ''}`);

        // Resolve recipe from recipes.json when possible
        try {
            const recipes = this.recipes || {};
            if ((kind === 'crafting' || kind === 'craft') && recipe.size && recipe.output && recipes.crafting && recipes.crafting[recipe.size]) {
                const list = recipes.crafting[recipe.size];
                const found = Array.isArray(list) ? list.find(r => r && r.output === recipe.output) : null;
                if (found && found.input) {
                    out.push(`Grid: ${recipe.size}`);
                    for (const row of found.input) out.push(String(row));
                }
            }
            if ((kind === 'smelting' || kind === 'furnace') && recipe.output && Array.isArray(recipes.smelting)) {
                const found = recipes.smelting.find(r => r && r.output === recipe.output);
                if (found) {
                    if (found.input) out.push(`Input: ${Array.isArray(found.input) ? found.input.join(', ') : String(found.input)}`);
                    if (found.fuel) out.push(`Fuel: ${Array.isArray(found.fuel) ? found.fuel.join(', ') : String(found.fuel)}`);
                }
            }
        } catch (e) {
            // ignore recipe resolution failures
        }

        return out.join('\n');
    }

    _resolveRecipeSpec(recipe) {
        if (!recipe) return null;
        if (typeof recipe === 'string') return { kind: 'text', text: recipe };
        if (typeof recipe !== 'object') return null;

        const kind = recipe.kind || recipe.type || '';
        const outId = recipe.output;
        const outAmount = recipe.amount;

        // Resolve crafting input grid
        try {
            const recipes = this.recipes || {};
            if ((kind === 'crafting' || kind === 'craft') && recipe.size && outId && recipes.crafting && recipes.crafting[recipe.size]) {
                const list = recipes.crafting[recipe.size];
                const found = Array.isArray(list) ? list.find(r => r && r.output === outId) : null;
                if (found && found.input) {
                    return {
                        kind: 'crafting',
                        size: recipe.size,
                        output: outId,
                        amount: (typeof outAmount === 'number' ? outAmount : (found.amount || 1)),
                        input: found.input,
                    };
                }
            }

            // Resolve furnace/smelting recipe
            if ((kind === 'smelting' || kind === 'furnace') && outId && Array.isArray(recipes.smelting)) {
                const found = recipes.smelting.find(r => r && r.output === outId);
                if (found) {
                    return {
                        kind: 'smelting',
                        output: outId,
                        amount: (typeof found.amount === 'number' ? found.amount : 1),
                        input: found.input || [],
                        fuel: found.fuel || [],
                    };
                }
            }
        } catch (e) {}

        // Fallback: keep textual description
        return { kind: 'unknown', text: this._describeRecipe(recipe) };
    }

    openScrollPopup(payload) {
        const key = payload && payload.key ? String(payload.key) : null;
        const data = payload && payload.data ? payload.data : (payload || {});

        if (this.scrollMenu && key && this._scrollPopupKey === key) return;
        this._scrollPopupKey = key;

        // Scroll popup palette (parchment/brown theme)
        const OUTLINE = '#865E3CFF';
        const BG = '#E19D66FF';
        const MID = '#A17049FF';
        // subtle variations
        const BG_DARK = '#D38F5BFF';
        const BG_LIGHT = '#F0B77CFF';
        const OUTLINE_SOFT = '#7A5536FF';
        const FONT = 'lore, serif';

        const w = 720;
        const h = 590;
        const x = 1980 / 2 - w / 2;
        const y = 1080 / 2 - h / 2;
        const menu = new Menu(this.mouse, this.keys, new Vector(x, y), new Vector(w, h), 10, BG, true);
        menu.passcode = 'ScrollPopup';

        // background panel + accents
        menu.addElement('bg', new UIRect(new Vector(0, 0), new Vector(w, h), 10, BG));
        // top band (slightly lighter)
        menu.addElement('bandTop', new UIRect(new Vector(0, 0), new Vector(w, 70), 11, BG_LIGHT));
        // bottom band (slightly darker)
        menu.addElement('bandBottom', new UIRect(new Vector(0, h - 70), new Vector(w, 70), 11, BG_DARK));
        // outline
        menu.addElement('border', new UIRect(new Vector(0, 0), new Vector(w, h), 12, OUTLINE, false, true, 6, OUTLINE));
        // inner outline for a bit more detail
        menu.addElement('borderInner', new UIRect(new Vector(8, 8), new Vector(w - 16, h - 16), 12, OUTLINE_SOFT, false, true, 2, OUTLINE_SOFT));

        // Title
        const title = new UIText(data.title || 'Scroll', new Vector(24, 34), 13, OUTLINE, 52, { baseline: 'middle', font: FONT });
        menu.addElement('title', title);

        // Close button
        const closeBtn = new UIButton(this.mouse, this.keys, new Vector(w - 64, 14), new Vector(50, 50), 13, 'e', BG_DARK, BG_LIGHT, OUTLINE_SOFT);
        closeBtn.passcode = 'ScrollPopup';
        closeBtn.onPressed.left.connect(() => {
            try { this.closeScrollPopup(); } catch (e) {}
            try { this.mouse.pause(0.15); } catch (e) {}
        });
        menu.addElement('closeBtn', closeBtn);
        menu.addElement('closeTxt', new UIText('X', new Vector(w - 39, 40), 14, OUTLINE, 30, { baseline: 'middle', align: 'center', font: FONT }));

        const hasRecipe = !!data.recipe;
        const loreTextRaw = (data.lore || '');
        const loreText = String(loreTextRaw);
        const loreNonEmpty = loreText.trim().length > 0;

        // Layout: if recipe exists, use a true 2-column layout (lore left, recipe right)
        const PAD = 24;
        const COL_GAP = 20;
        const contentW = w - PAD * 2;
        const colW = hasRecipe ? Math.floor((contentW - COL_GAP) / 2) : contentW;
        const leftX = PAD;
        const rightX = PAD + colW + COL_GAP;
        const rightW = contentW - colW - COL_GAP;
        const topY = 80;

        // SVG image (optional) - position depends on layout
        const svgSize = hasRecipe ? Math.min(220, colW) : 220;
        try {
            if (data.svg) {
                const img = new Image();
                img.src = String(data.svg);
                menu.addElement('svg', new UIImage(img, new Vector(leftX, topY), new Vector(svgSize, svgSize), 12, false));
            }
        } catch (e) {}

        // Lore/Description (optional)
        const loreFontSize = 24;
        const loreLineHeight = 1.2;

        // In recipe layout, lore is always in the left column.
        // If an SVG is present, put description below it; otherwise start near the top.
        const svgPresent = !!data.svg;
        const lx = hasRecipe ? leftX : (svgPresent ? (leftX + 240) : leftX);
        const loreHeaderY = hasRecipe ? (svgPresent ? (topY + svgSize + 22) : 84) : 84;
        const loreTop = loreHeaderY + 24;
        const loreWidth = hasRecipe ? colW : ((w - PAD) - lx);
        // For recipe scrolls, keep this short (~3 lines) and rename header to "Description"
        // Two-column layout means the recipe is not below this text anymore, so let it fill the
        // available left-column space (minus the bottom decoration band and padding).
        const bottomLimitY = h - 70 - 24;
        const loreHeight = Math.max(64, bottomLimitY - loreTop);
        const loreHeaderText = hasRecipe ? 'Description' : 'Lore';

        if (loreNonEmpty) {
            menu.addElement('loreHeader', new UIText(loreHeaderText, new Vector(lx, loreHeaderY), 13, OUTLINE, 32, { baseline: 'middle', font: FONT }));
            menu.addElement(
                'loreBody',
                new UIText(
                    loreText,
                    new Vector(lx, loreTop),
                    13,
                    MID,
                    loreFontSize,
                    {
                        baseline: 'top',
                        font: FONT,
                        wrap: 'word',
                        wrapWidth: loreWidth,
                        wrapHeight: loreHeight,
                        lineHeight: loreLineHeight,
                    }
                )
            );
        }

        // Recipe panel (optional)
        const recipeSpec = this._resolveRecipeSpec(data.recipe);
        if (recipeSpec) {
            const gridTop = 108;
            const gridLeft = hasRecipe ? rightX : leftX;
            const gridWidth = hasRecipe ? rightW : (w - PAD * 2);
            const gridHeight = h - gridTop - 26;

            // Decide whether we should show anything for this recipe
            const recipeText = (recipeSpec && (recipeSpec.text !== undefined)) ? String(recipeSpec.text || '') : '';
            const recipeHasContent = (
                recipeSpec.kind === 'crafting' ||
                recipeSpec.kind === 'smelting' ||
                (recipeSpec.kind === 'text' && recipeText.trim().length > 0) ||
                (recipeSpec.kind === 'unknown' && recipeText.trim().length > 0)
            );
            if (!recipeHasContent) {
                this.scrollMenu = menu;
                return;
            }

            // Header sits at top of the recipe column
            const headerY = 84;
            menu.addElement('recipeHeader', new UIText('Recipe', new Vector(gridLeft, headerY), 13, OUTLINE, 32, { baseline: 'middle', font: FONT }));

            // Lightweight draw-only element for the recipe grid
            const self = this;

            // Cache resolved icons/labels so we don't do inventory lookups every frame.
            // This is the main perf win for weaker devices.
            const iconFilter = { sepia: 1, saturate: 1.15, brightness: 0.92, contrast: 1.17 };
            const iconCache = new Map(); // id -> { sheet, tile } | null
            const iconAttempts = new Map(); // id -> number
            const labelCache = new Map(); // id -> string

            const normalizeLabel = (id) => {
                let name = String(id);
                if (name.length > 16) name = name.slice(0, 15) + '…';
                return name;
            };

            const resolveIconNow = (id) => {
                try {
                    const inv = self.scene && self.scene.player && self.scene.player.inventory;
                    if (!inv || typeof inv.getItem !== 'function') return null;
                    const resolved = inv.getItem(id);
                    if (!resolved || !resolved.sheet) return null;
                    const d = resolved.data || {};
                    const tile = (d.tile !== undefined) ? d.tile : ((d.coord !== undefined) ? d.coord : (d.id !== undefined ? d.id : id));
                    return { sheet: resolved.sheet, tile };
                } catch (e) {
                    return null;
                }
            };

            const primeCachesForRecipe = () => {
                try {
                    const ids = [];
                    if (recipeSpec.kind === 'crafting') {
                        const input = Array.isArray(recipeSpec.input) ? recipeSpec.input : [];
                        for (const row of input) {
                            if (!Array.isArray(row)) continue;
                            for (const id of row) if (id) ids.push(id);
                        }
                        if (recipeSpec.output) ids.push(recipeSpec.output);
                    } else if (recipeSpec.kind === 'smelting') {
                        const input = Array.isArray(recipeSpec.input) ? recipeSpec.input : [];
                        for (const id of input) if (id) ids.push(id);
                        const fuel = Array.isArray(recipeSpec.fuel) ? recipeSpec.fuel : [];
                        for (const id of fuel) if (id) ids.push(id);
                        if (recipeSpec.output) ids.push(recipeSpec.output);
                    }

                    const uniq = new Set(ids.map(String));
                    for (const id of uniq) {
                        if (!labelCache.has(id)) labelCache.set(id, normalizeLabel(id));
                        if (!iconCache.has(id)) iconCache.set(id, resolveIconNow(id));
                        if (!iconAttempts.has(id)) iconAttempts.set(id, 1);
                    }
                } catch (e) {}
            };

            primeCachesForRecipe();

            const recipeEl = {
                pos: new Vector(gridLeft, gridTop),
                size: new Vector(gridWidth, gridHeight),
                offset: new Vector(0, 0),
                visible: true,
                addOffset(off) { this.offset = off; },
                update() {},
                draw(Draw) {
                    try {
                        const ox = this.pos.x + this.offset.x;
                        const oy = this.pos.y + this.offset.y;

                        // panel background
                        Draw.rect(new Vector(ox, oy), this.size, BG_LIGHT);
                        Draw.rect(new Vector(ox + 6, oy + 6), new Vector(this.size.x - 12, this.size.y - 12), BG);

                        const drawCell = (cx, cy, cellSize, id) => {
                            // cell bg
                            Draw.rect(new Vector(cx, cy), new Vector(cellSize, cellSize), BG_DARK);
                            Draw.rect(new Vector(cx + 3, cy + 3), new Vector(cellSize - 6, cellSize - 6), BG);

                            if (!id) return;
                            const idKey = String(id);
                            let name = labelCache.get(idKey);
                            if (!name) {
                                name = normalizeLabel(idKey);
                                labelCache.set(idKey, name);
                            }

                            // name
                            Draw.text(name, new Vector(cx + cellSize / 2, cy + 4), OUTLINE_SOFT, 2, 14, { align: 'center', baseline: 'top', font: FONT, wrap: 'none' });

                            // icon
                            let icon = iconCache.get(idKey);
                            // If assets weren't ready when opened, retry a couple of times.
                            if (!icon) {
                                const attempts = iconAttempts.get(idKey) || 0;
                                if (attempts < 3) {
                                    iconAttempts.set(idKey, attempts + 1);
                                    icon = resolveIconNow(idKey);
                                    if (icon) iconCache.set(idKey, icon);
                                }
                            }
                            if (!icon) return;
                            const iconSize = Math.floor(cellSize * 0.62);
                            const ix = cx + Math.floor((cellSize - iconSize) / 2);
                            const iy = cy + 22;
                            try {
                                Draw.tile(icon.sheet, new Vector(ix, iy), new Vector(iconSize, iconSize), icon.tile, 0, null, 1, false, iconFilter);
                            } catch (e) {}
                        };

                        if (recipeSpec.kind === 'crafting') {
                            const sizeKey = recipeSpec.size || '3x3';
                            const n = (sizeKey === '1x1') ? 1 : (sizeKey === '2x2' ? 2 : 3);
                            const gap = 10;
                            const innerW = this.size.x - 36;
                            let cellSize = Math.floor((innerW - (n - 1) * gap) / n);
                            cellSize = Math.max(64, Math.min(cellSize, 112));
                            const gridW = n * cellSize + (n - 1) * gap;
                            const gridH = n * cellSize + (n - 1) * gap;
                            const gridX = ox + 18 + Math.max(0, Math.floor((innerW - gridW) / 2));
                            const gridY = oy + 18;

                            // Draw grid cells
                            const input = Array.isArray(recipeSpec.input) ? recipeSpec.input : [];
                            for (let r = 0; r < n; r++) {
                                const row = Array.isArray(input[r]) ? input[r] : [];
                                for (let c = 0; c < n; c++) {
                                    const id = row[c] || '';
                                    const cx = gridX + c * (cellSize + gap);
                                    const cy = gridY + r * (cellSize + gap);
                                    drawCell(cx, cy, cellSize, id);
                                }
                            }

                            // Output panel below
                            const outY = gridY + gridH + 44;
                            const outX = gridX + Math.floor((gridW - cellSize) / 2);
                            Draw.text('↓', new Vector(gridX + gridW / 2, gridY + gridH + 20), OUTLINE, 2, 44, { align: 'center', baseline: 'middle', font: FONT });
                            drawCell(outX, outY, cellSize, recipeSpec.output);
                            if (recipeSpec.amount && recipeSpec.amount !== 1) {
                                Draw.text(`x${recipeSpec.amount}`, new Vector(outX + cellSize / 2, outY + cellSize + 18), MID, 2, 20, { align: 'center', baseline: 'middle', font: FONT });
                            }
                            return;
                        }

                        if (recipeSpec.kind === 'smelting') {
                            // Furnace recipes: show inputs packed into a 3x3 grid, then fuel row, then output below
                            const gap = 10;
                            const innerW = this.size.x - 36;
                            let cellSize = Math.floor((innerW - 2 * gap) / 3);
                            cellSize = Math.max(60, Math.min(cellSize, 104));
                            const gridX = ox + 18 + Math.max(0, Math.floor((innerW - (3 * cellSize + 2 * gap)) / 2));
                            const gridY = oy + 18;

                            Draw.text('Input', new Vector(gridX, gridY - 10), OUTLINE, 2, 22, { align: 'left', baseline: 'bottom', font: FONT });
                            const ids = Array.isArray(recipeSpec.input) ? recipeSpec.input : [];
                            for (let i = 0; i < 9; i++) {
                                const r = Math.floor(i / 3);
                                const c = i % 3;
                                const cx = gridX + c * (cellSize + gap);
                                const cy = gridY + r * (cellSize + gap);
                                drawCell(cx, cy, cellSize, ids[i] || '');
                            }

                            const fuelY = gridY + 3 * (cellSize + gap) + 34;
                            Draw.text('Fuel', new Vector(gridX, fuelY - 10), OUTLINE, 2, 22, { align: 'left', baseline: 'bottom', font: FONT });
                            const fuels = Array.isArray(recipeSpec.fuel) ? recipeSpec.fuel : [];
                            for (let i = 0; i < Math.min(3, fuels.length); i++) {
                                const cx = gridX + i * (cellSize + gap);
                                drawCell(cx, fuelY, cellSize, fuels[i] || '');
                            }

                            // Output below fuel
                            const outY = fuelY + cellSize + 56;
                            const outX = gridX + Math.floor((3 * cellSize + 2 * gap - cellSize) / 2);
                            Draw.text('↓', new Vector(gridX + (3 * cellSize + 2 * gap) / 2, fuelY + cellSize + 24), OUTLINE, 2, 44, { align: 'center', baseline: 'middle', font: FONT });
                            Draw.text('Output', new Vector(outX + cellSize / 2, outY - 24), OUTLINE, 2, 26, { align: 'center', baseline: 'middle', font: FONT });
                            drawCell(outX, outY, cellSize, recipeSpec.output);
                            if (recipeSpec.amount && recipeSpec.amount !== 1) {
                                Draw.text(`x${recipeSpec.amount}`, new Vector(outX + cellSize / 2, outY + cellSize + 18), MID, 2, 20, { align: 'center', baseline: 'middle', font: FONT });
                            }
                            return;
                        }

                        // Text / unknown recipe fallback
                        const text = (recipeSpec.text !== undefined) ? String(recipeSpec.text) : '';
                        if (text) {
                            Draw.text(text, new Vector(ox + 18, oy + 18), MID, 2, 22, { baseline: 'top', font: FONT, wrap: 'word', wrapWidth: this.size.x - 36, wrapHeight: this.size.y - 36, lineHeight: 1.15 });
                        }
                    } catch (e) {}
                }
            };

            menu.addElement('recipeGrid', recipeEl);
        }

        this.scrollMenu = menu;
    }

    closeScrollPopup() {
        this.scrollMenu = null;
        this._scrollPopupKey = null;
    }

    

    /**
     * Creates a conformation menu
     * (this is a menu example)
     * @param {string} question What's the question?
     * @param {function} yes Function to call when user hits yes
     * @param {function} no Function to call when user hits no (closes by defualt)
     * @param {function} close Function to call instead of closing the conformation menu
    */
    createConformationMenu(question, yes,no,close){   
        const conMenu = new Menu(this.mouse,this.keys,new Vector(1980/2-200,1080/2-100),new Vector(400,200),2,'#2b2b2bff',true)
        
        // Question
        const questionText = new UIText(question?question:"Are you sure?",new Vector(200,40),2,"#FFFFFF",40,{baseline:"middle",align:'center'})
        conMenu.addElement('question',questionText)
        
        // Yes 
        const yesButton = new UIButton(this.mouse,this.keys,new Vector(20,80),new Vector(170,100),3)
        conMenu.addElement('yesButton',yesButton)
        yesButton.onPressed.left.connect(yes?yes:close?close:()=>{
            conMenu.close()
            this.mouse.pause(0.2)
        })
        const yesText = new UIText(question?question:"Yes",new Vector(100,130),2,"#FFFFFF",40,{baseline:"middle",align:'center'})
        conMenu.addElement('yesText',yesText)
        
        // No 
        const noButton = new UIButton(this.mouse,this.keys,new Vector(210,80),new Vector(170,100),3)
        noButton.onPressed.left.connect(no?no:close?close:()=>{
            conMenu.close()
            this.mouse.pause(0.2)
        })
        conMenu.addElement('noButton',noButton)
        const noText = new UIText(question?question:"No",new Vector(300,130),2,"#FFFFFF",40,{baseline:"middle",align:'center'})
        conMenu.addElement('noText',noText)

        return conMenu;
    }


    createAnvilMenu(){
        
    }
    /**
     * Updates the UI
     * @param {number} delta 
     * @returns 
     */
    update(delta) {
        if (!this.visible) return;
        this.InventoryManager.update(delta);
        // keep UI slot visuals in sync with player state
        this.menu.update(delta)
        try {
            if (this.scrollMenu) this.scrollMenu.update(delta);
            // Close popup with Escape even if mouse isn't on the X.
            if (this.scrollMenu && this.keys && this.keys.released && this.keys.released('Escape')) this.closeScrollPopup();
        } catch (e) {}
        // update inventory state first so slot counts are current
        this._updateSlots();
    }
    draw() {
        if (!this.visible) return;
        this.menu.draw(this.Draw)
        this.InventoryManager.draw(this.Draw)
        try { if (this.scrollMenu) this.scrollMenu.draw(this.Draw); } catch (e) {}
    }
}
