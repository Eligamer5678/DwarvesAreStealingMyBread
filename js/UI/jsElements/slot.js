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
    constructor(pos, size, layer, color = '#222', slotType = 'quick', slotId = null){
        this.pos = pos;
        this.size = size;
        this.layer = layer;
        this.color = color;
        this.offset = new Vector(0,0);
        this.visible = true;
        this.mouse = null; // set by Menu when added
        this.passcode = '';
        // last element that was stored here (for swap notifications)
        this._prevStored = null;

        // logical type/id so managers can distinguish quick vs craft slots
        this.slotType = slotType;
        this.slotId = slotId;

        // assigned elements (so the slot can keep track of what elements are registered)
        this._assigned = [];

        // Signal emitted when an element collides with the slot
        // onStore.emit(element, prevElement)
        this.onStore = new Signal();
    }

    addOffset(offset){ this.offset = offset }


    /**
     * Check assigned elements for center collision with this slot.
     * If any element's center is inside the slot rect, emit `onStore` with
     * the element and the previous stored element.
     */
    collide(el,second=false){
        if (!this.visible) return;
        const absPos = this.pos.add(this.offset);
        const elOffset = (el.offset) ? el.offset : new Vector(0,0);
        const elPos = el.pos.add(elOffset);
        const elCenter = elPos.add(el.size.div(2));
        if (Geometry.pointInRect(elCenter, absPos, this.size)){
            if(!second){
                this.onStore.emit(el, this._prevStored);
                if(this._prevStored){
                    this.collide(this._prevStored,true)
                }
                this._prevStored = el;
                el.pos = this.pos.add(new Vector(10,10))
            }else{
                el.pos = this.pos.add(new Vector(210,10))
            }
            return;
        }else if(this._prevStored === el){
            this._prevStored = null;
            this.onStore.emit(this._prevStored)
        }
    }

    /**
     * Register an element with this slot so it can be considered for drops.
     * This is intentionally idempotent.
     * @param {object} el UI element
     */
    assign(el){
        if (!el) return;
        if (!this._assigned.includes(el)) this._assigned.push(el);
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
