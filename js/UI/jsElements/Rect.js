import Vector from '../../modules/Vector.js';
import Geometry from '../../modules/Geometry.js';
export default class UIRect {
    /**
     * @param {Vector} pos
     * @param {Vector} size
     * @param {number} layer
     * @param {string} color
     * @param {boolean|string} [fill=true] - color or fill mode for Draw.rect
     * @param {boolean} [stroke=false]
     * @param {number} [width=1]
     * @param {string|null} [strokeColor=null]
     * @param {boolean} [erase=false]
     */
    constructor(pos,size,layer,color,fill = true, stroke = false, width = 1, strokeColor = null, erase = false){
        this.pos = pos;
        this.size = size;
        this.color = color;
        this.fill = fill;
        this.mask = false;
        this.mouse = null;
        this.stroke = stroke;
        this.width = width;
        this.strokeColor = strokeColor;
        this.erase = erase;
        this.offset = new Vector(0,0);
        this.visible = true;
        this.layer = layer;
        
    }
    addOffset(offset){
        this.offset = offset
    }
    update(delta){
        if(this.mask){
            const absolutePos = this.pos.add(this.offset);
            if (Geometry.pointInRect(this.mouse.pos, absolutePos, this.size)){
                console.log('masked')
                this.mouse.addMask(1);
            }
        }
    }
    draw(Draw){
        if(!this.visible){
            return;
        }
        Draw.rect(this.offset.add(this.pos), this.size, this.color, this.fill, this.stroke, this.width, this.strokeColor, this.erase);
    }
}