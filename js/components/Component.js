import { pickDefaults } from "../utils/Support.js"
/**
 * Components are added to entities to add feutures. 
 * 
 * Feel free to make your own to add custom behaviour to an entity
 * 
 * Built in components:
 * - SheetComponent - Adds a texture from a spritesheet
 * - PathfindComponent - Adds basic pathfinding
 * - AerialPathfindComponent - Adds flight-based pathfinding for bats/moths/birds
 * - LightComponent - Taps into the dyamic lighting & lights up area around the entity
 * 
 * Must haves:
 * - Clone method
 * - State dependancies in an object before calling super()
 */
export default class Component{
    constructor (entity,Dependencies,data){
        this.entity = entity
        this.Dependencies = Dependencies // save reference for cloning later
        Object.assign(this,pickDefaults(Dependencies,data))
    }
    /**
     * Clone this component
     * @returns {Component}
     */
    clone (entity){
        return new Component(entity)
    }
}