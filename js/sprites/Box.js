import Vector from "../Vector.js";
import Signal from "../Signal.js";

// Simple static sprite for editor/runtime entities with a single image
export default class BoxSprite {
    constructor(Draw, pos, size, image){
        this.Draw = Draw;
        this.pos = pos.clone();
        this.size = size.clone();
        this.image = image || null; // HTMLImageElement
        this.destroy = new Signal();
    }
    update(delta){ /* no-op for static sprite */ }
    draw(levelOffset){
        const p = this.pos.add(levelOffset || new Vector(0,0));
        if (this.image) {
            this.Draw.image(this.image, p, this.size, null, 0, 1, false);
        } else {
            // fallback: cyan rect when image missing
            this.Draw.rect(p, this.size, '#00CCFFFF', true, true, 2, '#0066FFFF');
        }
    }
}
