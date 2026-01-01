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
import Saver from '../js/managers/Saver.js';

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
            if (resources?.spriteImages instanceof Map) {
                for (const [k, v] of resources.spriteImages) this.SpriteImages.set(k, v);
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
            this.chunkManager = new ChunkManager(this.saver);
            await this.chunkManager.loadDefinitions('./data');
            // entity manager
            // Create a camera for world rendering
            this.entityManager = new EntityManager(this.chunkManager, this.Draw, this.SpriteImages, { noiseTileSize: this.chunkManager.noiseTileSize });
            this.camera = new Camera(this.Draw, this.mouse);
            this.createPlayer()

            // Load and register prefabs now so entity types are available
            // before chunk generation runs later in `onReady`.
            try {
                const pdata = { chunkManager: this.chunkManager, target: this.player, Draw: this.Draw };
                await PrefabLoader.loadAndRegister('./data/entities.json', this.entityManager, pdata, this.SpriteImages);
            } catch (e) {
                console.warn('MainScene: PrefabLoader preload failed', e);
            }

            await Saver.loadJSON('./data/recipes.json',(json)=>{
                this.recipes = json;
            })

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
        // pass the scene reference so UI can resolve resources and player
        this.mainUI = new MainUI(this.Draw, this.mouse, this.keys, this, {'recipes':this.recipes});

        
        
        // Some debug commands
        window.Debug.createSignal('getPos',()=>{
            console.log('Player coordnates')
            console.log('- Tile')
            console.log("x:",Math.floor(this.player.pos.x/this.chunkManager.noiseTileSize)," y:",Math.floor(this.player.pos.y/this.chunkManager.noiseTileSize))
            console.log('- Real')
            console.log("x:",this.player.pos.x," y:",this.player.pos.y)
        })
        window.Debug.createSignal('tp',(x,y)=>{
            this.player.pos.x = x;
            this.player.pos.y = y;
            console.log('Player teleported to: [',x,',',y,']')
        })
        window.Debug.createSignal('setBlock',(x,y,block)=>{
            this.chunkManager.setTileValue(x,y,block)
        })
        window.Debug.createSignal('saveChunk',(x,y)=>{
            this.chunkManager.saveChunk(x,y)
        })
        window.Debug.createSignal('clearSave',()=>{
            this.saver.clear()
        })
        window.Debug.createSignal('gamemode',(gamemode)=>{
            if(gamemode === 'c' || gamemode === 'creative') this.player.creative = true;
            else this.player.creative = false;
        })

        
            
        this.createManagers()
        // Allow chunk manager to spawn entities during generation when available
        this.chunkManager.entityManager = this.entityManager;
        // Prime initial chunks around origin
        this.chunkManager.generateChunksAround(this.player.pos.x, this.player.pos.y, 3);
        this.isReady = true;
        this.chunkManager.ready = true;

    }
    createPlayer(){
        // Create player and attach to camera
        const dwarfSheet = this.SpriteImages.get('dwarf');
        const tilePx = this.chunkManager.noiseTileSize;
        const startPos = new Vector(tilePx * 2, tilePx * 2-96);
        const size = new Vector(tilePx, tilePx);
        this.player = new Dwarf(this.keys, this.Draw, startPos, size, dwarfSheet, { type: 'platformer', chunkManager: this.chunkManager, scene: this });
        this.entityManager.setPlayer(this.player);   
        // simple fallback so player remains visible while collisions aren't implemented
        this.player.onGround = 1;
        this.camera.track(this.player, { offset: new Vector(0,0) });            
        // Zoom in camera a bunch
        if (this.camera) {
            // immediate zoom to 3x for clarity
            this.camera.zoom.x = 10; 
            this.camera.zoom.y = 10;
            this.camera.targetZoom.x = 10; 
            this.camera.targetZoom.y = 10;
            this.camera.targetOffset = this.camera.targetOffset;
        }
        // UI reads player from the passed scene reference; nothing to set here
    }
    createManagers(){
        // collision system
        this.collision = new CollisionSystem(this.chunkManager, { noiseTileSize: this.chunkManager.noiseTileSize });
        // lighting system
        this.lighting = new LightingSystem(this.chunkManager, {});
        this.chunkManager.lightingSystem = this.lighting
        this.lighting.markDirty();
        this.lighting.update();
        this.entityManager.setLightingSystem(this.lighting);
        this.chunkManager.onTileModified.connect((sx, sy, val) => {this.lighting.markDirty()});
    }

    sceneTick(tickDelta) {
        // Minimal tick: update input and UI. Full game systems will be added
        // when we wire the new component architecture and JSON loader.
        this.mouse.setMask(0)
        this.mouse.update(tickDelta);
        this.keys.update(tickDelta);
        this.mainUI.update(tickDelta);
        // Update player
        this.mouse.setPower(0)
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
        
        // Spawn monsters: 8 = Slime, 9 = Bat, 0 = Moth
        // Slime
        if (this.keys.released('8')) {
            this.entityManager.addEntity("slime",this.player.pos,new Vector(16,16))
        }
        // Bat
        if (this.keys.released('9')) {
            this.entityManager.addEntity("bat",this.player.pos,new Vector(16,16));
        }
        // Moth
        if (this.keys.released('0')) {
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
        // Mouse controls: left-click to place selected block, right-click to remove (Disabled for now)
        // try {
        //     if (this.mouse.held('left')) {
        //         const world = this.camera.screenToWorld(this.mouse.pos);
        //         try { this.player.buildAtWorld(world.x, world.y, this.player.selectedItem); } catch (e) { console.warn('Mouse place failed', e); }
        //     }
        //     if (this.mouse.held('right')) {
        //         const world = this.camera.screenToWorld(this.mouse.pos);
        //         try { this.player.mineAtWorld(world.x, world.y); } catch (e) { console.warn('Mouse remove failed', e); }
        //     }
        // } catch (e) {
        //     // ignore if mouse/camera/player not ready
        // }
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


