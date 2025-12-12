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
 */
export default class Component{
    constructor (entity){
        this.entity = entity
    }
    /**
     * Clone this component
     * @returns {Component}
     */
    clone (entity){
        return new Component(entity)
    }
}