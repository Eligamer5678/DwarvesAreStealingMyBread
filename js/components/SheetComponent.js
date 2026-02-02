import Vector from "../modules/Vector.js";
import Component from "./Component.js";
import { pickDefaults, mergeObjects} from "../utils/Support.js";
/** Type Imports
 * @typedef {import('../managers/Draw.js').default} DrawType
 * @typedef {import('../modules/Vector.js').default} VectorType
 * @typedef {import('../modules/Spritesheet.js').default} SheetType
 * @typedef {import('../entities/Entity.js').default} EntityType
 * @typedef {import('../components/Component.js').default} ComponentType
 */

/**
 * Component version of Spritesheet
 */
export default class SheetComponent extends Component{
    /**
     * @param {SheetType} entity
     * @param {Object} data 
     * @param {EntityType} entity 
     */
    constructor(entity,data,opts={}){
        const Dependencies = {
            Draw:null,
            baseSheet:null
        }
        const defaults = {
            opacity:1,
            invert:new Vector(1,1),
            rotation:0,
            defaultAnimation:'idle'
        }
        super(entity,Dependencies,data)
        const mergedOpts = mergeObjects(opts,defaults)
        Object.assign(this, mergedOpts)
        if(this.baseSheet){
            this.sheet = this.baseSheet.connect();
            this.sheet.playAnimation(this.defaultAnimation, true);
            this.sheet.onStop.connect(()=>{
                if(this.sheet.currentAnimation.name === 'defeat') this.entity.dead = true;
            })
        }
        this.entity.kill.connect(()=>{
            this.entity.dead = true;
        })
    }
    /**
     * Updates the sheet.
     * @param {number} delta 
     */
    update(delta){
        this.sheet.updateAnimation(delta);
    }

    /**
     * Draw the sheet.
     */
    draw(){
        if(!this.sheet.currentAnimation.name) this.sheet.currentAnimation.name = 'idle'
        this.Draw.sheet(this.sheet,this.entity.pos,this.entity.size,this.sheet.currentAnimation.name,this.sheet.currentFrame,this.invert,this.opacity,false);
    }

    /**
     * Clone this component
     * @param {EntityType} entity The entity to attach the clone onto
     * @returns {SheetComponent}
     */
    clone (entity){
        const defaults = {
            opacity:1,
            invert:new Vector(1,1),
            rotation:0,
            defaultAnimation:'idle',
        }
        const data = pickDefaults(this.Dependencies,this)
        const opts = pickDefaults(defaults,this)
        const cloned = new SheetComponent(entity,data,opts);
        return cloned;
    }
    defeat(){
        try{this.sheet.playAnimation('defeat')}catch{}
    }
}
