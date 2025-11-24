import Vector from '../Vector.js';
import Color from '../Color.js';

export default class Inventory {
    constructor(scene) {
        this.scene = scene;
        this.UIDraw = scene.UIDraw;
        this.mouse = scene.mouse;
        this.visible = false;
        this.cols = 6;
        this.rows = 4;
        this.slotSize = 48;
        this.margin = 20;
        // fake items array
    this.items = new Array(this.cols * this.rows).fill(null);
    this.bgColor = new Color(0,0,0,0.85,'rgb');
    this.innerColor = new Color(255,255,255,0.04,'rgb');
    this.slotBg = new Color(255,255,255,0.04,'rgb');
    this.slotOutline = new Color(255,255,255,0.08,'rgb');
    }

    toggle() { this.visible = !this.visible; }

    update(delta) {
        if (!this.visible) return;
        // When inventory overlay is open, add a mask stack to prevent clicks falling through
        try { this.mouse.addMask(1); } catch (e) {}
    }

    draw(UIDraw) {
        if (!this.visible) return;
        try {
            UIDraw.useCtx('UI');
            const ctx = UIDraw.getCtx('UI');
            const w = ctx.canvas.width;
            const h = ctx.canvas.height;
            const panelW = this.cols * (this.slotSize + 8) + 32;
            const panelH = this.rows * (this.slotSize + 8) + 48;
            const px = Math.round((w - panelW) / 2);
            const py = Math.round((h - panelH) / 2);

            UIDraw.rect(new Vector(px, py), new Vector(panelW, panelH), this.bgColor, true);
            UIDraw.rect(new Vector(px + 8, py + 8), new Vector(panelW - 16, panelH - 16), this.innerColor, true);

            // draw slots
            let sx = px + 16;
            let sy = py + 16;
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    UIDraw.rect(new Vector(sx, sy), new Vector(this.slotSize, this.slotSize), this.slotBg, true);
                    UIDraw.rect(new Vector(sx, sy), new Vector(this.slotSize, this.slotSize), this.slotOutline, false, 2);
                    sx += this.slotSize + 8;
                }
                sx = px + 16;
                sy += this.slotSize + 8;
            }
        } catch (e) {}
    }
}
