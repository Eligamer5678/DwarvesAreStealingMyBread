import Saver from "./Saver.js";
import Signal from "../modules/Signal.js";
import UIButton from "../UI/jsElements/Button.js";
import UIRect from "../UI/jsElements/Rect.js";
import UIText from "../UI/jsElements/Text.js";

export default class CraftingManager{
    constructor(){
        // Load the recipes
        Saver.loadJSON("../data/recipes.json",this.setup)
        this.recipes = null;

        this.currentItem = 'null'
        this.onCraft = new Signal()
    }
    setup(json){
        this.recipes = json
    }


    /**
     * Setup the crafting UI (anvil)
     */
    getCraftingUI(menu){

    }
    
}