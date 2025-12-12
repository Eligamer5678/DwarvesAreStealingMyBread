import Vector from "../modules/Vector.js";
import Component from "./Component.js";
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
     * @param {SheetType} sheet 
     * @param {DrawType} Draw 
     * @param {EntityType} entity 
     */
    constructor(sheet,Draw,entity){
        super(entity)
        this.baseSheet = sheet;
        this.sheet = sheet.connect();
        // Ensure a default animation is active to avoid null access during draw
        this.sheet.playAnimation('idle', false);
        this.Draw = Draw;
        this.rotation = 0;
        this.invert = new Vector(1,1);
        this.opacity = 1;
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
        const cloned = new SheetComponent(this.baseSheet,this.Draw,entity);
        cloned.Draw = this.Draw;
        cloned.rotation = this.rotation;
        cloned.invert = this.invert.clone();
        cloned.opacity = this.opacity;
        return cloned;
    }
}
