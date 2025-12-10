import Vector from '../modules/Vector.js';
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
        this.health = 1000000000000;
        this.team = "17.08 wild buffalos"
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
        return;
    }

    draw(levelOffset){
        // Prefer drawing via sheet component when available
        this._sheetComp.draw(this.Draw, this.pos, this.size);
    }
}
