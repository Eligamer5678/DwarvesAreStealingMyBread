import Vector from '../../modules/Vector.js';
import Geometry from '../../modules/Geometry.js';
import Signal from '../../modules/Signal.js';

export default class UISlot {
    /**
     * @param {Vector} pos
     * @param {Vector} size
     * @param {number} layer
     * @param {string} [color='#222']
     * @param {string} [slotType='quick'] - logical slot type (e.g. 'quick' or 'craft')
     * @param {number|null} [slotId=null] - optional identifier within the slotType
     */
    constructor(key="inventory/0", pos, size, layer, color = '#222'){
        this.pos = pos;
        this.size = size;
        this.layer = layer;
        this.color = color;
        this.offset = new Vector(0,0);
        this.visible = true;
        this.mouse = null; // set by Menu when added
        this.passcode = '';

        this.key = "inventory/0" 
        this.data = null; // Given by Inventory manager
    }

    addOffset(offset){ this.offset = offset }


    /**
     * Check assigned elements for center collision with this slot.
     * If any element's center is inside the slot rect, emit `onStore` with
     * the element and the previous stored element.
     */
    collide(el){
        if (!this.visible) return;
        const absPos = this.pos.add(this.offset);
        const elOffset = (el.offset) ? el.offset : new Vector(0,0);
        const elPos = el.pos.add(elOffset);
        const elCenter = elPos.add(el.size.div(2));
        if (Geometry.pointInRect(elCenter, absPos, this.size)){
            return true;
        }
        return false;
    }



    update(delta){
        if (!this.visible) return;
        // mask handling so slot can participate in mouse hit tests if needed
        if (this.mouse){
            const absolutePos = this.pos.add(this.offset);
            if (Geometry.pointInRect(this.mouse.pos, absolutePos, this.size)) this.mouse.addMask(1);
        }
    }

    draw(Draw){
        if (!this.visible) return;
        Draw.rect(this.offset.add(this.pos), this.size, this.color);
    }
}
