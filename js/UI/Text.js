import Vector from '../Vector.js';

export default class UIText {
    /**
     * @param {string} text
     * @param {Vector} pos
     * @param {number} layer
     * @param {string} color
     * @param {number} fontSize
     * @param {object} options
     */
    constructor(text, pos, layer = 0, color = '#FFFFFF', fontSize = 20, options = {}){
        this.text = String(text == null ? '' : text);
        this.pos = pos;
        this.layer = layer;
        this.color = color;
        this.fontSize = fontSize;
        this.options = options; // pass-through to Draw.text
        this.offset = new Vector(0,0);
        this.visible = true;
    }

    addOffset(offset){
        this.offset = offset;
    }

    setText(t){ this.text = String(t == null ? '' : t); }
    setColor(c){ this.color = c; }
    setFontSize(s){ this.fontSize = s; }
    setOptions(o){ this.options = o; }

    update(delta){
        // no dynamic behaviour by default
    }

    draw(Draw){
        if(!this.visible) return;
        const pos = this.offset.add(this.pos);
        // Draw.text signature: text, pos, color, width, fontSize, options
        const strokeWidth = (this.options && this.options.strokeWidth !== undefined) ? this.options.strokeWidth : 0;
        Draw.text(this.text, pos, this.color, strokeWidth, this.fontSize, this.options);
    }
}
