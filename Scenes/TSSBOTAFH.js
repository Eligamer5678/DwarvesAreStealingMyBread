import Scene from './Scene.js';
import Vector from '../js/modules/Vector.js';
import MainUI from '../js/UI/MainUI.js';
import Camera from '../js/modules/Camera.js';
import ChunkManager from '../js/managers/ChunkManager.js';
import Dwarf from '../js/sprites/Dwarf.js';
import CollisionSystem from '../js/systems/CollisionSystem.js';
import LightingSystem from '../js/systems/LightingSystem.js';
import EntityManager from '../js/managers/EntityManager.js';
import PrefabLoader from '../js/utils/PrefabLoader.js';
// The small spherical but oval objects are falling, help
export class TSSBOTAFHScene extends Scene {
    constructor(...args) {
        super('main', ...args);
        this.loaded = 0;
        this.elements = new Map();
        this.isPreloaded = false;
        this.isReady = false;
    }

    /**
     * Preload assets. The new component/asset loader will wire JSON driven assets
     * into this.SpriteImages; keep a permissive loader so we can attach resources
     * from the JSON loader when ready.
     */
    async onPreload(resources = null) {
        try {
            if (!this.SpriteImages) this.SpriteImages = new Map();
            if (resources && resources instanceof Map) {
                for (const [k, v] of resources) this.SpriteImages.set(k, v);
            } else {
                // If no resources provided, try to load textures.json via AssetManager
                try {
                    // lazy import to avoid loading during tests
                    const AM = await import('../js/managers/AssetManager.js');
                    const loaded = await AM.loadTexturesJSON('./data/textures.json');
                    if (loaded && loaded.sprites) {
                        for (const [k, v] of loaded.sprites) this.SpriteImages.set(k, v);
                    }

                } catch (e) {
                    // fail silently; resources can be provided elsewhere
                    console.warn('MainScene: AssetManager load failed', e);
                }
            }



            this.isPreloaded = true;
            return true;
        } catch (err) {
            console.error('MainScene preload failed:', err);
            return false;
        }
    }

    onReady() {
        if (this.isReady) return
        this.eggs = []
        
    }

    sceneTick(tickDelta) {
        // Minimal tick: update input and UI. Full game systems will be added
        // when we wire the new component architecture and JSON loader.
        this.mouse.setMask(0)
        this.mouse.update(tickDelta);
        this.keys.update(tickDelta);
        // Update player
        this.mouse.setPower(0)


    }
    draw() {
        if (!this.isReady) return;

        // Background
        let bgColor = '#42a6d4ff';
        this.Draw.background(bgColor)

        // UI layer
        this.UIDraw.clear();

    }
}


