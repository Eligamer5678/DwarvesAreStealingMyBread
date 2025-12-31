import Vector from "../modules/Vector.js";
import Signal from "../modules/Signal.js";
/** Type Imports
 * @typedef {import('../modules/Draw.js').default} DrawType
 * @typedef {import('../modules/Vector.js').default} VectorType
 * @typedef {import('../components/Component.js').default} ComponentType
 */

/**
 * Standard entity class.
 * 
 * Create & add components to add features.
 */
export default class Entity {
    /**
     * @param {VectorType} pos Basic position in pixels
     * @param {VectorType} size Basic size in pixels
     */
    constructor(pos,size=new Vector(16,16)){
        this.pos = pos;
        this.vlos = new Vector(0,0)
        this.size = size;
        this.team = 'none';
        this.health = 1000000000; // big number (:
        this.components = new Map();
        this.kill = new Signal()
        this.dead = false;
    }
    /**
     * Updates the sprite
     * @param {number} delta 
     */
    update(delta){
        this.components.forEach((component)=>{
            if(typeof component.update === 'function') component.update(delta)
        })
    }
    /**
     * Draws the sprite (requires a valid display component, eg. SheetComponent)
     * @param {number} delta 
     */
    draw(){
        this.components.forEach((component)=>{
            if(typeof component.draw === 'function') component.draw()
        })
    }

    // Component logic
    /**
     * Adds a component & returns it.
     * @param {string} name 
     * @param {ComponentType} component
     * @returns {ComponentType} 
     */
    setComponent(name,component){
        this.components.set(name,component)
        return component
    }
    /**
     * Gets a component, if it doesn't exist returns undefined.
     * @param {string} name 
     * @param {ComponentType} component 
     * @returns {ComponentType|undefined}
    */
    getComponent(name){
        return this.components.get(name)
    }
    getComponents(){
        // Return an array of component instances for safe iteration/callbacks
        return Array.from(this.components.values());
    }
    /**
     * Gets a component, if it doesn't exist add it.
     * @param {string} name 
     * @param {ComponentType} component 
     * @returns {ComponentType}
     */
    getOrAddComponent(name,component){
        const existingComponent = this.components.get(name)
        if(existingComponent !== undefined) return existingComponent
        else {this.setComponent(name,component); return component}
    }
    /**
     * Remove a component. Returns component deleted, or if already deleted, undefined.
     * @param {string} name
     * @returns {ComponentType|undefined} 
     */
    removeComponent(name,component){
        if(this.components.delete(name)) return component
        return undefined
    }
    /**
     * Clones this entity
     */
    clone(){
        const cloned = new Entity(this.pos,this.size)
        this.components.forEach((component,key)=>{
            const clonedComp = component.clone(cloned)
            cloned.setComponent(key,clonedComp)
        })
        cloned.team = this.team;
        cloned.health = this.health;
        return cloned
    }
    /**
     * Defeat is not killing. 
     * if a component has a defeat() method, it will be called instead.
     */
    defeat(){
        let i = 0;
        this.getComponents().forEach((comp)=>{
            if(typeof comp.defeat === 'function') {
                comp.defeat()
                i+=1;
            }
        })
        if(i===0)this.dead = true;
    }
}