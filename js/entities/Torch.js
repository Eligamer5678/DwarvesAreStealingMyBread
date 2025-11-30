import Vector from '../Vector.js';
import LightComponent from '../components/LightComponent.js';
import SheetComponent from '../components/SheetComponent.js';

/**
 * Torch entity: small entity that carries a LightComponent and draws itself.
 * Designed to be simple and component-driven so later systems can add
 * more components (physics, pickup, flicker, etc.).
 */
export default class Torch {
    constructor(draw, pos, size = new Vector(16,16), opts = {}){
        this.Draw = draw; // Draw helper used for rendering
        this.pos = pos.clone ? pos.clone() : new Vector(pos.x || 0, pos.y || 0);
        this.size = size.clone ? size.clone() : new Vector(size.x || 16, size.y || 16);
        this.vlos = new Vector(0,0);
        this.components = [];
        // Attach a light component by default
        const level = (opts.level !== undefined) ? opts.level : 8;
        const offset = opts.offset || new Vector(0,0);
        this.components.push(new LightComponent({ level, offset }));
        // Attach a sheet component for torch sprite animation (looks up 'torch' sheet)
        const sheetOpts = opts.sheet || { sheetKey: 'torch', animation: 'idle', size: this.size, smoothing: false };
        this._sheetComp = new SheetComponent(sheetOpts);
        this.components.push(this._sheetComp);
    }

    update(dt){
        // EntityManager is responsible for calling component.update on entities.
        // Avoid updating components here to prevent double-updating connected
        // spritesheets (which causes animations to advance twice per frame).
        // Keep this method available for any Torch-specific logic in the future.
        return;
    }

    draw(levelOffset){
        // Prefer drawing via sheet component when available
        try {
            const pos = this.pos.clone ? this.pos.clone() : new Vector(this.pos.x, this.pos.y);
            if (this._sheetComp) {
                this._sheetComp.draw(this.Draw, pos, this.size);
                return;
            }
            // fallback: simple glowing rect
            const color = '#FFD76BFF';
            this.Draw.rect(pos, this.size, color, true);
            this.Draw.rect(pos, this.size, '#00000022', false, true, 1, '#00000022', false);
        } catch (e) {
            console.warn('Torch.draw failed', e);
        }
    }
}
