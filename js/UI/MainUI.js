import Vector from '../Vector.js';
import UIButton from './Button.js';
import Inventory from './Inventory.js';
import Color from '../Color.js';

export default class MainUI {
    constructor(scene) {
        this.scene = scene;
        this.Draw = scene.Draw;
        this.UIDraw = scene.UIDraw;
        this.mouse = scene.mouse;
        this.keys = scene.keys;
        this.visible = true;

        this.margin = 12;
        this.width = 140;
        this.slotSize = 40;

        // Buttons / controls
        this.buttons = new Map();

        // Inventory overlay
        this.inventory = new Inventory(scene);

        // Precompute Color instances (avoid hex/rgba strings)
        this.panelColor = new Color(0, 0, 0, 0.35, 'rgb');
        this.healthColor = new Color(200, 50, 50, 0.9, 'rgb');
        this.healthOutline = new Color(255, 255, 255, 0.15, 'rgb');
        this.slotOutline = new Color(255, 255, 255, 0.08, 'rgb');

        // create simple UI elements (positions will be computed on draw)
        this._makeControls();
    }

    _makeControls() {
        // placeholders; positions updated each frame in layout
        // layer parameter is unused for mask logic; kept for compatibility
        this.btnInventory = new UIButton(this.mouse, this.keys, new Vector(0,0), new Vector(80,26), 1, null, '#333333', '#444444', '#222222');
        this.btnSettings = new UIButton(this.mouse, this.keys, new Vector(0,0), new Vector(80,26), 1, null, '#333333', '#444444', '#222222');

        // toolbar slots (vertical)
        this.slots = [];
        // Predefined tool palette (type, color, speed)
        this.toolPalette = [
            { type: 'pickaxe', color: '#b5651d', speed: 1.2 },
            { type: 'shovel', color: '#c2b280', speed: 1.0 },
            { type: 'hammer', color: '#8888ff', speed: 0.9 },
            { type: 'torch', color: '#ffcc33', speed: 1.0 },
            { type: 'sword', color: '#ff6666', speed: 1.0 }
        ];
        for (let i = 0; i < this.toolPalette.length; i++) {
            const pal = this.toolPalette[i];
            const b = new UIButton(this.mouse, this.keys, new Vector(0,0), new Vector(this.slotSize, this.slotSize), 1, null, pal.color, pal.color, '#111');
            // connect click to change player's tool
            try {
                b.onPressed['left'].connect(() => {
                    try {
                        if (this.scene && this.scene.player) {
                            this.scene.player.currentTool = { type: pal.type, speed: pal.speed };
                        }
                    } catch (e) {}
                });
            } catch (e) {}
            this.slots.push(b);
        }
    }

    update(delta) {
        if (!this.visible) return;

        // Layout based on UI canvas size
        try {
            this.UIDraw.useCtx('UI');
            const ctx = this.UIDraw.getCtx('UI');
            const w = ctx.canvas.width;
            const h = ctx.canvas.height;

            // positions: left-side vertical bar
            const panelX = this.margin;
            let y = this.margin;

            // health bar area (just visual) at top-left
            this.healthPos = new Vector(panelX + 8, y);
            this.healthSize = new Vector(this.width - 16, 18);
            y += 24;

            // inventory button below health
            this.btnInventory.pos = new Vector(panelX + 8, y);
            this.btnInventory.size = new Vector(this.width - 16, 26);
            y += 34;

            // settings button
            this.btnSettings.pos = new Vector(panelX + 8, y);
            this.btnSettings.size = new Vector(this.width - 16, 26);
            y += 40;

            // vertical toolbar along left below buttons
            const toolbarX = panelX + 8;
            let toolbarY = y;
            for (let i = 0; i < this.slots.length; i++) {
                const sx = toolbarX;
                const sy = toolbarY + i * (this.slotSize + 8);
                this.slots[i].pos = new Vector(sx, sy);
                this.slots[i].size = new Vector(this.slotSize, this.slotSize);
                this.slots[i].update(delta);
            }

            // update inventory & buttons
            this.btnInventory.update(delta);
            this.btnSettings.update(delta);

            // Inventory toggle: use onPressed signal from UIButton (simpler: detect press state)
            if (this.btnInventory.pressed && this.btnInventory.pressed.left) {
                this.inventory.toggle();
            }

            // update inventory overlay
            this.inventory.update(delta);
        } catch (e) {
            // If UI ctx not available yet, skip
        }
    }

    draw() {
        if (!this.visible) return;
        try {
            this.UIDraw.useCtx('UI');
            const ctx = this.UIDraw.getCtx('UI');
            const w = ctx.canvas.width;
            const h = ctx.canvas.height;

            // Match layout used in update(): left-side panel at margin
            const panelX = this.margin;
            const panelY = this.margin;

            // Background strip panel on left
            const panelH = Math.max(h - panelY - this.margin, 160);
            this.UIDraw.rect(new Vector(panelX, panelY), new Vector(this.width, panelH), this.panelColor, true);

            // Draw health bar
            this.UIDraw.rect(this.healthPos, this.healthSize, this.healthColor, true);
            this.UIDraw.rect(this.healthPos, this.healthSize, this.healthOutline, false, 2);

            // Draw buttons
            this.btnInventory.draw(this.UIDraw);
            this.btnSettings.draw(this.UIDraw);

            // Draw vertical toolbar slots
            for (let i = 0; i < this.slots.length; i++) {
                const s = this.slots[i];
                // Draw colored background to represent tool color (slot.baseColor is already set)
                this.UIDraw.rect(s.pos, s.size, s.baseColor, true);
                // Draw outline
                this.UIDraw.rect(s.pos, s.size, this.slotOutline, false, 2);
                s.draw(this.UIDraw);
            }

            // Draw inventory overlay (if open)
            this.inventory.draw(this.UIDraw);
        } catch (e) {
            // ignore
        }
    }
}
