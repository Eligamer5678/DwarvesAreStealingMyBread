import Scene from './Scene.js';
import Vector from '../js/modules/Vector.js';
import MainUI from '../js/UI/MainUI.js';
import Camera from '../js/modules/Camera.js';
import ChunkManager from '../js/managers/ChunkManager.js';
import Dwarf from '../js/sprites/Dwarf.js';
import CollisionSystem from '../js/systems/CollisionSystem.js';
import LightingSystem from '../js/systems/LightingSystem.js';
import Color from '../js/modules/Color.js';
import EntityManager from '../js/managers/EntityManager.js';
import Torch from '../js/entities/Torch.js';
import Slime from '../js/entities/Slime.js';
import Bat from '../js/entities/Bat.js';
import Moth from '../js/entities/Moth.js';

import Entity from '../js/entities/Entity.js';
import SheetComponent from '../js/components/SheetComponent.js';
import SpriteSheet from '../js/modules/Spritesheet.js';
import PathfindComponent from '../js/components/PathfindComponent.js';
import AerialPathfindComponent from '../js/components/AerialPathfindComponent.js';
import LightComponent from '../js/components/LightComponent.js';

export class MainScene extends Scene {
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
                    if (loaded && loaded.tilemaps) {
                        for (const [k, v] of loaded.tilemaps) this.SpriteImages.set(k, v);
                    }
                    if (loaded && loaded.sprites) {
                        for (const [k, v] of loaded.sprites) this.SpriteImages.set(k, v);
                    }
                    if (loaded && loaded.blocks) {
                        // expose block registry for downstream systems
                        this.SpriteImages.set('blocks', loaded.blocks);
                    }
                } catch (e) {
                    // fail silently; resources can be provided elsewhere
                    console.warn('MainScene: AssetManager load failed', e);
                }
            }

            // Initialize chunk manager and load generation/chunk/block definitions
            this.chunkManager = new ChunkManager();
            await this.chunkManager.loadDefinitions('./data');

            this.isPreloaded = true;
            return true;
        } catch (err) {
            console.error('MainScene preload failed:', err);
            return false;
        }
    }

    onReady() {
        if (this.isReady) return;

        // Initialize minimal UI. Subsystems (entities, blocks, rendering)
        // will be registered by the new component-based engine.
        this.mainUI = new MainUI(this.Draw, this.mouse, this.keys, null);

        // Create a camera for world rendering
        this.camera = new Camera(this.Draw, this.mouse);

        // Prime initial chunks around origin
        if (this.chunkManager) this.chunkManager.generateChunksAround(0, 0, 2);

        // Some debug commands
        window.Debug.createSignal('logPos',()=>{
            console.log('Player coordnates')
            console.log('- Tile')
            console.log("x:",Math.floor(this.player.pos.x/this.chunkManager.noiseTileSize)," y:",Math.floor(this.player.pos.y/this.chunkManager.noiseTileSize))
            console.log('- Real')
            console.log("x:",this.player.pos.x," y:",this.player.pos.y)
        })
        window.Debug.createSignal('setBlock',(x,y,block)=>{
            this.chunkManager.setTileValue(x,y,block)
        })

        // Create player and attach to camera
        try {
            const dwarfSheet = (this.SpriteImages && this.SpriteImages.get) ? this.SpriteImages.get('dwarf') : null;
            const tilePx = (this.chunkManager && this.chunkManager.noiseTileSize) ? this.chunkManager.noiseTileSize : 16;
            const startPos = new Vector(tilePx * 2, tilePx * 2-128);
            const size = new Vector(tilePx, tilePx);
            this.player = new Dwarf(this.keys, this.Draw, startPos, size, dwarfSheet, { type: 'platformer', chunkManager: this.chunkManager, scene: this });
            // simple fallback so player remains visible while collisions aren't implemented
            this.player.onGround = 1;
            this.camera.track(this.player, { offset: new Vector(0,0) });            
            // Zoom in camera a bunch
            try {
                if (this.camera) {
                    // immediate zoom to 3x for clarity
                    this.camera.zoom.x = 10; 
                    this.camera.zoom.y = 10;
                    this.camera.targetZoom.x = 10; 
                    this.camera.targetZoom.y = 10;
                    this.camera.targetOffset = this.camera.targetOffset;
                }
            } catch (e) { /* ignore zoom errors */ }
        } catch (e) { console.warn('Failed to create player', e); }

            
        this.createManagers()
        this.chunkManager.generateChunksAround(this.player.pos.x, this.player.pos.y, 3);

        this.addSlimePrefab()
        this.addBatPrefab()
        this.addMothPrefab()
        this.addTorchPrefab()
        this.isReady = true;
    }
    createManagers(){
        // collision system
        this.collision = new CollisionSystem(this.chunkManager, { noiseTileSize: this.chunkManager.noiseTileSize });
        // lighting system
        this.lighting = new LightingSystem(this.chunkManager, {});
        this.chunkManager.lightingSystem = this.lighting

        // entity manager
        this.entityManager = new EntityManager(this.chunkManager, this.Draw, this.SpriteImages, { noiseTileSize: this.chunkManager.noiseTileSize });
        this.entityManager.setPlayer(this.player);
        this.entityManager.setLightingSystem(this.lighting);                
        this.lighting.markDirty();
        this.lighting.update();
        this.entityManager.setLightingSystem(this.lighting);
        this.chunkManager.onTileModified.connect((sx, sy, val) => {this.lighting.markDirty()});
    }
    addSlimePrefab(){
        const slime = new Entity(new Vector(0,-16),new Vector(16,16))
        const sheet = this.SpriteImages.get('slime');
        const sheetComponent = new SheetComponent(sheet,this.Draw,slime)
        slime.setComponent("sheet",sheetComponent)
        const pathFindingComponent = new PathfindComponent(slime,this.player,this.chunkManager)
        slime.setComponent("AI",pathFindingComponent)
        this.entityManager.addEntityType("slime",slime)
    }
    addBatPrefab(){
        const bat = new Entity(new Vector(0,-16),new Vector(16,16))
        const sheet = this.SpriteImages.get('bat');
        const sheetComponent = new SheetComponent(sheet,this.Draw,bat)
        bat.setComponent("sheet",sheetComponent)
        const pathFindingComponent = new AerialPathfindComponent(bat,this.player,this.chunkManager)
        bat.setComponent("AI",pathFindingComponent)
        this.entityManager.addEntityType("bat",bat)
    }
    addMothPrefab(){
        const moth = new Entity(new Vector(0,-16),new Vector(16,16))
        const sheet = this.SpriteImages.get('moth');
        const sheetComponent = new SheetComponent(sheet,this.Draw,moth)
        moth.setComponent("sheet",sheetComponent)
        const pathFindingComponent = new AerialPathfindComponent(moth,this.player,this.chunkManager)
        moth.setComponent("AI",pathFindingComponent)
        this.entityManager.addEntityType("moth",moth)
    }
    addTorchPrefab(){
        const torch = new Entity(new Vector(0,-16),new Vector(16,16))
        const sheet = this.SpriteImages.get('torch');
        const sheetComponent = new SheetComponent(sheet,this.Draw,torch)
        torch.setComponent("sheet",sheetComponent)
        const LightComp = new LightComponent(torch,this.chunkManager)
        torch.setComponent("light",LightComp)
        torch.team = 'light'

        this.entityManager.addEntityType("torch",torch)
    }

    sceneTick(tickDelta) {
        // Minimal tick: update input and UI. Full game systems will be added
        // when we wire the new component architecture and JSON loader.
        this.mouse.update(tickDelta);
        this.keys.update(tickDelta);
        this.mainUI.update(tickDelta);
        // Update player
        this.player.update(tickDelta);
        this.mainUI.menu.elements.get("heightText2").setText(Math.round((this.player.pos.y/this.chunkManager.noiseTileSize)*-1*10-1)/10)
        this.mainUI.menu.elements.get("itemText").setText("Item: "+ this.player.selectedItem)
        // Debug: press 't' to spawn an extra torch at the player's tile (multiple allowed)

        if (this.keys.released('t')) {
            const tileSize = this.chunkManager.noiseTileSize;
            const px = Math.floor((this.player.pos.x + this.player.size.x * 0.5));
            const py = Math.floor((this.player.pos.y + this.player.size.y * 0.5));
            const sx = Math.floor(px / tileSize);
            const sy = Math.floor(py / tileSize);
            const pos = new Vector(sx * tileSize, sy * tileSize);

            // If a torch already exists at this tile, remove it (toggle behavior)
            const ls = this.lighting;
            if (ls.torches.has(`${sx},${sy}`)) {
                // Remove torch from lighting system
                try { ls.removeTorch(sx, sy); } catch (e) {}
                // Also remove any entity at this tile managed by entityManager
                this.entityManager.getEnemiesInRange(pos,1,(torch)=>{
                    this.entityManager.removeEntity(torch)
                })
                this.lighting.markDirty();
            } else {
                if (this.entityManager) this.entityManager.addEntity("torch",pos,new Vector(16,16));
                this.lighting.markDirty();
            }
        }


        this.collision.updateSprite(this.player);
        
        // Spawn monsters: 1 = Slime, 2 = Bat, 3 = Moth
        // Slime (1)
        if (this.keys.released('1')) {
            this.entityManager.addEntity("slime",this.player.pos,new Vector(16,16))
        }
        // Bat (2)
        if (this.keys.released('2')) {
            this.entityManager.addEntity("bat",this.player.pos,new Vector(16,16));
        }
        // Moth (3)
        if (this.keys.released('3')) {
            this.entityManager.addEntity("moth",this.player.pos,new Vector(16,16));
        }

        // Toggle debug path drawing with 'b' (bats) and 'm' (moths)
        if (this.keys.released('b')) this.debugBatPaths = !this.debugBatPaths;
        if (this.keys.released('m')) this.debugMothPaths = !this.debugMothPaths;

        // Update lighting
        this.lighting.update();
        this.entityManager.update(tickDelta);

        
        // Update camera smoothing/keyframes
        this.camera.update(tickDelta);
    }

    draw() {
        if (!this.isReady) return;

        // Background
        let bgColor = '#000000';
        const tileSize = this.chunkManager.noiseTileSize;
        const py = this.player.pos.y + this.player.size.y * 0.5;
        const tileY = Math.floor(py / tileSize);
        if (tileY <=8) bgColor = '#87CEEB';
        this.Draw.background(bgColor);
        


        this.Draw.useCtx('base');
        this.camera.applyTransform();
        this.Draw.rect(new Vector(this.player.pos.x-1920,0),new Vector(1920*3,16.1),['#87CEEB00','#000000FF'],'gradienty')
        this.Draw.rect(new Vector(this.player.pos.x-1920,16),new Vector(1920*3,16*16),'#000000FF')
        
        this.chunkManager.draw(this.Draw, this.camera, this.SpriteImages, { lighting: this.lighting });
        // Draw player in world space (after world draw but still under UI)
        const px = this.player.pos.x + this.player.size.x * 0.5;
        const brightness = this.lighting.getBrightnessForWorld(px, py, tileSize);
        this.player.brightness = brightness;
        this.Draw.setBrightness(brightness*3);
        this.player.draw(new Vector(0,0));
        this.Draw.setBrightness(1);

        // draw entities managed by EntityManager
        this.entityManager.drawEntities();
        this.camera.popTransform();





        // UI layer
        this.UIDraw.clear();
        this.mainUI.draw();
    }
}


