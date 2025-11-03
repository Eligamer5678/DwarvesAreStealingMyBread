import Scene from './Scene.js';
import Vector from '../js/Vector.js';
import SoundManager from '../js/SoundManager.js'
import MusicManager from '../js/MusicManager.js'
import Color from '../js/Color.js';
import Geometry from '../js/Geometry.js';
import LoadingOverlay from '../js/UI/LoadingOverlay.js';
import createHButton from '../js/htmlElements/createHButton.js';
import createHDiv from '../js/htmlElements/createHDiv.js';
import { TestSprite } from '../js/sprites/sprites.js';
import SpriteSheet from '../js/Spritesheet.js';
import TileSheet from '../js/Tilesheet.js';
import TileMap from '../js/TileMap.js';

export class TitleScene extends Scene {
    constructor(...args) {
        super('title', ...args);
        this.loaded = 0;
        // Number of players expected in session (1 by default). Used by
        // multiplayer logic to decide whether to send/receive state.
        this.playerCount = 1;
        this.defaultSaveData = {
            'settings':{
                'volume': {

                },
                'colors':{

                },
                'particles':0.1
            },
            'game':{

            }
        }
        this.settings = this.defaultSaveData.settings;
        this.elements = new Map()
        
    }
    
    /**
     * Preload necesary resources. Called BEFORE onReady()
     */
    async onPreload(resources=null) {
        this.soundGuy = new SoundManager()
        this.musician = new SoundManager()
        this.conductor = new MusicManager(this.musician)
        // Ensure skipLoads flag exists (default false) and register a shortcut signal
        window.Debug.addFlag('skipLoads', false);
        window.Debug.createSignal('skip', ()=>{ window.Debug.addFlag('skipLoads', true); });

        // Create and show loading overlay
        try {
            this._loadingOverlay = document.querySelector('loading-overlay') || new LoadingOverlay();
            if (!document.body.contains(this._loadingOverlay)) document.body.appendChild(this._loadingOverlay);
            this._loadingOverlay.setTitle('Dragons Don\'t Like Tetris');
            this._loadingOverlay.setMessage('Starting...');
            this._loadingOverlay.setProgress(0);
            this._loadingOverlay.show();
        } catch (e) {
            console.warn('Could not create loading overlay:', e);
        }
        await this.loadImages()
        this._loadingOverlay && this._loadingOverlay.setProgress(0.25);
        this._loadingOverlay && this._loadingOverlay.setMessage('Loading sounds...');
        await this.loadSounds()
        this._loadingOverlay && this._loadingOverlay.setProgress(0.5);
        if(window.Debug.getFlag('skipLoads')===false){
            await this.loadMusic()
        }else{  
            this.loaded+=2;
        }
        if(this.loaded>=3){
            console.log('Finished loading')
        }
        try {
            // Only start the conductor if music was loaded or if the user hasn't skipped loads
            if (!window.Debug || !window.Debug.skipLoads) {
                this.conductor.start(0.5);
            } else {
                console.log('Skipping conductor.start because skipLoads is enabled');
            }
        } catch (e) {
            console.warn('Conductor start failed:', e);
        }
        this.EM.connect('2Player', (id) => {
            this.enableTwoPlayer(id);
        });
    }

    /**
     * Load images
     */
    async loadImages(){
        // Set up image paths, map them to Image objects after.
        // Examples:
        this.BackgroundImageLinks = {
            'house': 'Assets/Tilemaps/House-tilemap.png'
        }

        this.BackgroundImages = {
            'house': new Image()
        }

        this.SpriteImageLinks = {
            'cat':'Assets/Sprites/cat.png'
        }

        this.SpriteImages = {
            'cat': new Image()
        }



        for(let file in this.BackgroundImages){
            this.BackgroundImages[file].src = this.BackgroundImageLinks[file];
            if (this._loadingOverlay) {
                // rough incremental progress while images load
                const idx = Object.keys(this.BackgroundImages).indexOf(file);
                const total = Object.keys(this.BackgroundImages).length + Object.keys(this.SpriteImages).length;
                const progress = Math.min(0.2, ((idx + 1) / total) * 0.2);
                this._loadingOverlay.setProgress(progress);
            }
        }
        for(let file in this.SpriteImages){
            this.SpriteImages[file].src = this.SpriteImageLinks[file];
            if (this._loadingOverlay) {
                const idx = Object.keys(this.SpriteImages).indexOf(file) + Object.keys(this.BackgroundImages).length;
                const total = Object.keys(this.BackgroundImages).length + Object.keys(this.SpriteImages).length;
                const progress = Math.min(0.25, ((idx + 1) / total) * 0.25);
                this._loadingOverlay.setProgress(progress);
            }
        }
        // Images loaded
        this.loaded += 1;
        this._loadingOverlay && this._loadingOverlay.setProgress(0.25);
    }

    /**
     * Load music
     */
    async loadMusic(){
        // Get music files
        const musicFiles = [
            //['intro', "Assets/sounds/music_intro.wav"],
            //['part1', "Assets/sounds/music_part1.wav"],
            //['part2', "Assets/sounds/music_part2.wav"],
            //['segue', "Assets/sounds/music_segue.wav"],
            //['part3', "Assets/sounds/music_part3.wav"]
        ];
        // Load music files
        let musicSkipped = false;
        for (const [key, path] of musicFiles) {
            // If the debug flag was toggled to skip during loading, stop further loads
            if (window.Debug && typeof window.Debug.getFlag === 'function' && window.Debug.getFlag('skipLoads')) {
                console.log('Skipping remaining music loads (user requested skip)');
                musicSkipped = true;
                break;
            }
            await this.musician.loadSound(key, path);
            if (this._loadingOverlay) {
                // progress between 50% and 90% during music load
                const idx = musicFiles.findIndex(m => m[0] === key);
                const progress = 0.5 + (idx + 1) / musicFiles.length * 0.4;
                this._loadingOverlay.setProgress(progress);
                this._loadingOverlay.setMessage(`Loading music: ${key}`);
            }
        }
        // Music loaded
        if (musicSkipped) {
            this.loaded += 1;
            this._loadingOverlay && this._loadingOverlay.setMessage('Music skipped');
            return;
        }

        // Set up conductor sections and conditions for music transitions
        this.conductor.setSections([
            { name: "intro", loop: false },
            { name: "part1", loop: true },
            { name: "part2", loop: true },
            { name: "part3", loop: true },
            { name: "part4", loop: true },
            { name: "segue", loop: false },
            { name: "part5", loop: false }
        ]);

        // conditions correspond to section indexes 1..4
        const conditions = [
            () => 1+1==11, //example condition
        ];
        conditions.forEach((cond, i) => this.conductor.setCondition(i + 1, cond));

        // Start playback
        this.loaded += 1;
        this._loadingOverlay && this._loadingOverlay.setProgress(0.9);
    }

    /**
     * Load sounds
     */
    async loadSounds(){
        // Loading sound effects

        // Just some example sound effects
        const sfx = [
            //['crash', 'Assets/sounds/crash.wav'],
            //['break', 'Assets/sounds/break.wav'],
            //['place', 'Assets/sounds/place.wav'],
            //['rotate', 'Assets/sounds/rotate.wav'],
        ];

        for (const [key, path] of sfx) {
            await this.soundGuy.loadSound(key, path);
            if (this._loadingOverlay) {
                const idx = sfx.findIndex(s => s[0] === key);
                const progress = 0.25 + (idx + 1) / sfx.length * 0.25;
                this._loadingOverlay.setProgress(progress);
                this._loadingOverlay.setMessage(`Loading SFX: ${key}`);
            }
        }
        // Sound effects loaded
        this.loaded += 1;
        this._loadingOverlay && this._loadingOverlay.setProgress(0.5);
    }


    /**
     * Get data from server and apply to local game state.
     * Data looks like: state[remoteId + 'key']
     * 
     * Use sendState to send data.
     * 
     * This is called automatically when new data is received from the server.
     * 
     * @param {*} state The data sent from the server
     * @returns 
     */
    applyRemoteState = (state) => {
        if (!state) return;
        // Default handling deferred to base Scene.applyRemoteState
        if (typeof super.applyRemoteState === 'function') return super.applyRemoteState(state);
    }

    /** 
     * Advance local tick count to match remote player's tick count. 
     * */
    applyTick(remoteId, state){
        const tickKey = remoteId + 'tick'; 
        if (!(tickKey in state)) return; 
        while (state[tickKey] > this.tickCount) this.tick();
    } 

    /** 
     * Called when the scene is ready. 
     * Declare variables here, NOT in the constructor.
     */
    onReady() {
        this.twoPlayer = false;
        this.isReady = true;
        this.createUI()
        // Hide loading overlay now

        try {
            this._loadingOverlay && this._loadingOverlay.hide();
        } catch (e) { /* ignore */ }
        this.saver.set('twoPlayer',false)
        this.playerId = null;
        // Store a bound handler so we can safely disconnect it later.
        this._rssHandler = (state) => { this.applyRemoteState(state); };
        if (this.RSS && typeof this.RSS.connect === 'function') this.RSS.connect(this._rssHandler);

        const img = this.SpriteImages['cat'];
        const sheet = new SpriteSheet(img, 32);
        // animations: sit:4,sit2:4,lick:4,lick2:4,walk:8,run:8,sleep:4,play:6,pounce:7,stretch:8
        const animList = ['sit','sit2','lick','lick2','walk','run','sleep','play','jump','stretch'];
        const frameCounts = [4,4,4,4,8,8,4,6,7,8];
        for (let i = 0; i < animList.length; i++) {
            sheet.addAnimation(animList[i], i, frameCounts[i]);
        }
        sheet.addAnimation('land', 8, 7);

        this.testSprite = new TestSprite(this.keys,this.Draw,new Vector(100,100),new Vector(100,100),sheet)
        this.loadTilemap()

        // Level editor
        this.levelOffset = new Vector(50,0)
        this.tileSize = 120
        this.cursor = new Vector(0,0)
        this.startOffset = null
        this.drawType = 'floor'
        this.drawRot = 0
        this.drawInvert = 1
        this.rotDelay = 0.2
        this.rotSetDelay = 0.1
        // Build a grid-based palette from the registered tilesheet (row,col entries)
        this.uiMenu = {
            margin: 10,
            menuWidth: 48*5,
            itemSize: 48,
            spacing: 8
        }
        // tileTypes will be filled after tilesheet is available
        this.tileTypes = []
    // zoom state
    this.zoom = 1.0
    this.zoomStep = 0.1
    this.minZoom = 0.25
    this.maxZoom = 3.0
    this.zoomOrigin = null
        
    }

    loadTilemap(){
        const bg = this.BackgroundImages['house'];
        // create a tilesheet and register it with a TileMap
        const ts = new TileSheet(bg, 16);
        ts.addTile('sample', 0, 0);
        this._tilemap = new TileMap();
        this._tilemap.registerTileSheet('house', ts);
        // place the sample tile at map coordinate (0,0)
        // place a 4x4 box starting at map coordinate (0,0)
        // tilesheet layout (col,row): [0,0]=floor, [1,0]=wall, [2,0]=roof
        ts.addTile('floor', 0, 0);
        ts.addTile('wall', 0, 1);
        ts.addTile('roof', 0, 2);

        this._tilemap.setTile(0,5,'house','wall',2)

        // Build 4x4 box (x:0..3, y:0..3)
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                let key = 'floor';
                if (y === 0) {
                    key = 'roof';
                } else if (y === 3) {
                    key = 'floor';
                } else if (x === 0 || x === 3) {
                    key = 'wall';
                } else {
                    key = 'floor';
                }
                this._tilemap.setTile(x, y, 'house', key, 0);
            }
        }
    }

    // Save the current tilemap and editor state to the Saver under maps/<name>
    saveMap(name = 'default'){
        try {
            const payload = {
                map: (this._tilemap && typeof this._tilemap.toJSON === 'function') ? this._tilemap.toJSON() : null,
                levelOffset: Vector.encode(this.levelOffset),
                tileSize: this.tileSize,
                drawType: this.drawType,
                drawRot: this.drawRot,
                drawInvert: this.drawInvert,
                zoom: this.zoom
            };
            this.saver.set('maps/' + name, payload);
            console.log('Map saved:', name);
        } catch (e) {
            console.warn('Save failed:', e);
        }
    }

    // Load a saved tilemap/editor state from Saver (maps/<name>)
    loadMap(name = 'default'){
        try {
            const payload = this.saver.get('maps/' + name);
            if (!payload) {
                console.warn('No saved map found for', name);
                return false;
            }
            if (this._tilemap && typeof this._tilemap.fromJSON === 'function' && payload.map) this._tilemap.fromJSON(payload.map);
            try { this.levelOffset = Vector.decode(payload.levelOffset); } catch (e) { /* ignore */ }
            this.tileSize = payload.tileSize || this.tileSize;
            this.drawType = payload.drawType || this.drawType;
            this.drawRot = payload.drawRot || this.drawRot;
            this.drawInvert = payload.drawInvert || this.drawInvert;
            this.zoom = payload.zoom || this.zoom;
            console.log('Map loaded:', name);
            return true;
        } catch (e) {
            console.warn('Load failed:', e);
            return false;
        }
    }

    // Load map data from a plain payload object (useful for import)
    loadMapFromPayload(payload){
        try {
            if (!payload) return false;
            if (this._tilemap && typeof this._tilemap.fromJSON === 'function' && payload.map) this._tilemap.fromJSON(payload.map);
            try { this.levelOffset = Vector.decode(payload.levelOffset); } catch (e) { /* ignore */ }
            this.tileSize = payload.tileSize || this.tileSize;
            this.drawType = payload.drawType || this.drawType;
            this.drawRot = payload.drawRot || this.drawRot;
            this.drawInvert = payload.drawInvert || this.drawInvert;
            this.zoom = payload.zoom || this.zoom;
            console.log('Map payload applied');
            return true;
        } catch (e) {
            console.warn('Applying map payload failed:', e);
            return false;
        }
    }

    // Export current map/editor state to a downloadable JSON file
    saveMapToFile(filename = 'map.json'){
        try {
            const payload = {
                map: (this._tilemap && typeof this._tilemap.toJSON === 'function') ? this._tilemap.toJSON() : null,
                levelOffset: Vector.encode(this.levelOffset),
                tileSize: this.tileSize,
                drawType: this.drawType,
                drawRot: this.drawRot,
                drawInvert: this.drawInvert,
                zoom: this.zoom
            };
            const json = JSON.stringify(payload, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            console.log('Map exported to file:', filename);
        } catch (e) {
            console.warn('Export failed:', e);
        }
    }

    // Prompt user to pick a JSON file and import it as a map
    loadMapFromFile(){
        return new Promise((resolve) => {
            try {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json';
                input.style.display = 'none';
                input.onchange = (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (!file) { resolve(false); return; }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        try {
                            const payload = JSON.parse(ev.target.result);
                            const ok = this.loadMapFromPayload(payload);
                            resolve(ok);
                        } catch (err) {
                            console.warn('Failed to parse map file:', err);
                            resolve(false);
                        }
                    };
                    reader.onerror = (err) => { console.warn('File read error', err); resolve(false); };
                    reader.readAsText(file);
                };
                document.body.appendChild(input);
                input.click();
                // cleanup after short delay when picker closed
                setTimeout(() => { try { input.remove(); } catch (e){} }, 3000);
            } catch (e) { console.warn('Load file failed:', e); resolve(false); }
        });
    }

    /**
     * Set up player ID
     */
    enableTwoPlayer(id) {
        this.playerId = id;
        const isP1 = this.playerId === 'p1';
        this.twoPlayer = true;
    }

    

    /**
     * Scene-specific tick handler. Called from base Scene.tick().
     */
    sceneTick(tickDelta){
        this.testSprite.update(tickDelta);
        // Placement
        // UI interaction: compute UI bounds and whether pointer is over menu (grid-based)
        let pointerOverUI = false;
        if(this.mouse.pos.x > 1920-48*5){
            try {
                const uiCtx = this.UIDraw.getCtx('UI');
                if (uiCtx) {
                    const uiW = uiCtx.canvas.width / this.UIDraw.Scale.x;
                    const uiH = uiCtx.canvas.height / this.UIDraw.Scale.y;
                    const m = this.uiMenu;
                    const menuX = uiW - m.menuWidth - m.margin;
                    const menuY = m.margin;
                    const menuH = uiH - m.margin * 2;
                    const mp = this.mouse.pos;

                    // ensure tileTypes is populated from the tilesheet (do once)
                    if (this.tileTypes.length === 0) {
                        try {
                            const ts = this._tilemap.getTileSheet('house');
                            const img = ts && ts.sheet;
                            if (ts && img && img.width && ts.slicePx) {
                                const cols = Math.max(1, Math.floor(img.width / ts.slicePx));
                                const rows = Math.max(1, Math.floor(img.height / ts.slicePx));
                                for (let r = 0; r < rows; r++) {
                                    for (let c = 0; c < cols; c++) {
                                        this.tileTypes.push([r, c]);
                                    }
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }

                    // compute grid columns
                    const cols = Math.max(1, Math.floor((m.menuWidth - 16 + m.spacing) / (m.itemSize + m.spacing)));
                    const totalH = Math.ceil(this.tileTypes.length / cols) * (m.itemSize + m.spacing) - m.spacing;
                    const menuBoxH = Math.min(menuH, totalH + 16);

                    // Consider full vertical menu area for buttons below the grid as well
                    if (mp.x >= menuX && mp.x <= menuX + m.menuWidth && mp.y >= menuY && mp.y <= menuY + menuH) {
                        pointerOverUI = true;
                        // compute grid columns and full used rows
                        const cols = Math.max(1, Math.floor((m.menuWidth - 16 + m.spacing) / (m.itemSize + m.spacing)));
                        const rowsUsed = Math.ceil(this.tileTypes.length / cols);
                        const gridH = rowsUsed * (m.itemSize + m.spacing) - m.spacing;

                        // positions for buttons below the grid
                        const btnX = menuX + 8;
                        const btnW = m.menuWidth - 16;
                        const btnH = 28;
                        const btnYStart = menuY + 8 + gridH + m.spacing;

                        if (this.mouse.pressed('left')) {
                            // if click within grid
                            if (mp.y >= menuY + 8 && mp.y <= menuY + 8 + gridH) {
                                const relX = mp.x - (menuX + 8);
                                const relY = mp.y - (menuY + 8);
                                const col = Math.floor(relX / (m.itemSize + m.spacing));
                                const row = Math.floor(relY / (m.itemSize + m.spacing));
                                const idx = row * cols + col;
                                if (idx >= 0 && idx < this.tileTypes.length) {
                                    this.drawType = this.tileTypes[idx];
                                }
                            } else if (mp.x >= btnX && mp.x <= btnX + btnW) {
                                // check for Save button
                                if (mp.y >= btnYStart && mp.y <= btnYStart + btnH) {
                                    // export to a file (download JSON)
                                    this.saveMapToFile('map-default.json');
                                }
                                // check for Load button (stacked below Save)
                                if (mp.y >= btnYStart + btnH + m.spacing && mp.y <= btnYStart + btnH * 2 + m.spacing) {
                                    // open file picker and import
                                    this.loadMapFromFile();
                                }
                            }
                        }
                    }
                }
            } catch (e) { /* ignore UI hit test errors */ }
        }
        // Placement (only if not interacting with UI)
        if (!pointerOverUI && this.mouse.held('left')){
            this._tilemap.setTile(this.cursor.x,this.cursor.y,'house',this.drawType,this.drawRot,this.drawInvert)
        }
        if(this.mouse.held('right')){
            this._tilemap.removeTile(this.cursor.x,this.cursor.y)
        }
        if(this.keys.held('i') && this.rotDelay < -1){
            this.drawInvert *= -1
            this.rotDelay = this.rotSetDelay
        }
        if(this.mouse.pressed('middle')){
            this.mouse.grab(this.mouse.pos)
            this.startOffset = this.levelOffset.clone()
        }
        // Rotation
        this.rotDelay -= tickDelta
        if(this.rotDelay<0){
            if(this.mouse.scroll('up')){
                this.drawRot = (this.drawRot+1)%4
                this.rotDelay = this.rotSetDelay
            }
            if(this.mouse.scroll('down')){
                this.drawRot = (this.drawRot-1)%4
                this.rotDelay = this.rotSetDelay
            }
        }
        if(this.startOffset !== null){
            // mouse.getGrabDelta is in screen space; convert to world-space by dividing by zoom
            this.levelOffset = this.startOffset.add(this.mouse.getGrabDelta().div(this.zoom))
        }

        // Zoom controls: '-' to zoom out, '=' to zoom in (single press)
        try {
            const prevZoom = this.zoom;
            const drawCtx = this.Draw.ctx;
            const uiW = drawCtx ? drawCtx.canvas.width / this.Draw.Scale.x : 0;
            const uiH = drawCtx ? drawCtx.canvas.height / this.Draw.Scale.y : 0;
            const center = new Vector(uiW / 2, uiH / 2);
            const prevOrigin = this.zoomOrigin ? this.zoomOrigin : center;

            // helper to compute world point under screen position S using previous transform
            // invert: S = prevZoom * W + (1 - prevZoom) * prevOrigin
            // => W = (S + (prevZoom - 1) * prevOrigin) / prevZoom
            const worldUnderScreen = (S) => {
                return S.add(prevOrigin.mult(prevZoom - 1)).div(prevZoom);
            };

            // helper to compute new levelOffset so world W maps to screen S under newZoom and newOrigin
            // derive: newLevelOffset = (S + (newZoom - 1)*newOrigin)/newZoom - W + oldLevelOffset
            const computeLevelFor = (W, S, newZoom, newOrigin) => {
                return S.add(newOrigin.mult(newZoom - 1)).div(newZoom).sub(W).add(this.levelOffset);
            };

            // Keyboard zoom (- / =)
            if (this.keys.pressed('-') || this.keys.pressed('=')) {
                const step = this.keys.pressed('=') ? this.zoomStep : -this.zoomStep;
                const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + step));
                const S = this.mouse.pos.clone();
                const W = worldUnderScreen(S);
                const newOrigin = S; // zoom toward mouse
                this.zoom = newZoom;
                this.levelOffset = computeLevelFor(W, S, this.zoom, newOrigin);
                this.zoomOrigin = newOrigin;
            }

            // ctrl+wheel zoom
            const wheelDelta = this.mouse.wheel(null, false, true);
            if (wheelDelta !== 0) {
                const factor = Math.exp(-wheelDelta * 0.001);
                const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
                const S = this.mouse.pos.clone();
                const W = worldUnderScreen(S);
                const newOrigin = S;
                this.zoom = newZoom;
                this.levelOffset = computeLevelFor(W, S, this.zoom, newOrigin);
                this.zoomOrigin = newOrigin;
            }
        } catch (e) { /* ignore zoom errors */ }

        // compute cursor tile indices using configured tileSize and current zoom
        try {
            const ctx = this.Draw.ctx;
            if (ctx) {
                const uiW = ctx.canvas.width / this.Draw.Scale.x;
                const uiH = ctx.canvas.height / this.Draw.Scale.y;
                const center = new Vector(uiW / 2, uiH / 2);
                const origin = this.zoomOrigin ? this.zoomOrigin : center;
                // convert screen mouse pos to world pos by undoing the translate/scale/translate applied in draw()
                const worldPos = this.mouse.pos.sub(origin).div(this.zoom).add(origin);
                // cursor index = floor((worldPos - levelOffset) / tileSize)
                this.cursor = worldPos.sub(this.levelOffset).div(this.tileSize).floorS();
            } else {
                // fallback: previous behavior
                this.cursor = this.mouse.pos.sub(this.levelOffset).div(this.tileSize).floorS();
            }
        } catch (e) {
            this.cursor = this.mouse.pos.sub(this.levelOffset).div(this.tileSize).floorS();
        }

        // If middle was just released, and the grab delta is effectively zero, copy tile under mouse
        try {
            if (this.mouse.released('middle')) {
                // grabPos still set until we call releaseGrab(), so getGrabDelta() is valid
                const grabDelta = this.mouse.getGrabDelta();
                const tol = 1; // pixels tolerance
                if (Math.abs(grabDelta.x) <= tol && Math.abs(grabDelta.y) <= tol) {
                    // copy tile at cursor
                    const info = this._tilemap.getTileRenderInfo(this.cursor.x, this.cursor.y);
                    if (info) {
                        this.drawType = info.tileKey;
                        this.drawRot = info.rotation ?? 0;
                        // if tiles include invert flag, use it; otherwise keep current
                        this.drawInvert = info.invert ?? this.drawInvert;
                    }
                }
                // always clear grab state on release
                this.startOffset = null;
                this.mouse.releaseGrab();
            } else if (!this.mouse.held('middle')) {
                // fallback: if not held (and not a just-released event), clear state
                this.startOffset = null;
                this.mouse.releaseGrab();
            }
        } catch (e) { /* ignore */ }
    }

    drawTilemap(){
        // draw the entire placed region (simple for-each). Use display size 64px per tile
        this._tilemap.forEach((tx, ty, entry) => {
            const info = this._tilemap.getTileRenderInfo(tx, ty);
            if (!info || !info.sheet) return;
            const px = tx * this.tileSize;
            const py = ty * this.tileSize;
            const rot = info.rotation ?? 0;
            const invert = info.invert ?? 0;
            this.Draw.tile(info.sheet, (new Vector(px, py)).addS(this.levelOffset), new Vector(this.tileSize, this.tileSize), info.tileKey, rot, new Vector(invert,1), 1);
        });
    }    

    /** 
     * Draws the game. Use the Draw class to draw elements. 
     * */
    draw() {
        if(!this.isReady) return;
        this.Draw.background('#000000ff')
        // Apply zoom transform around screen center for world drawing
        const drawCtx = this.Draw.ctx;
        if (drawCtx) {
            try {
                const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
                const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
                const center = new Vector(uiW / 2, uiH / 2);
                const origin = this.zoomOrigin ? this.zoomOrigin : center;
                // translate to origin, scale, translate back (grouped so popMatrix restores)
                this.Draw.translate(origin);
                this.Draw.scale(this.zoom);
                this.Draw.translate(new Vector(-origin.x, -origin.y));
            } catch (e) { /* ignore transform errors */ }
        }

        this.testSprite.draw()

        this.drawTilemap()

        // draw preview of the tile under the cursor (on world layer) when not over palette
        if(this.mouse.pos.x < 1920 - this.uiMenu.menuWidth){
            this.Draw.tile(this._tilemap.getTileSheet('house'), (new Vector(this.cursor.x * this.tileSize, this.cursor.y * this.tileSize)).addS(this.levelOffset), new Vector(this.tileSize, this.tileSize), this.drawType, this.drawRot, new Vector(this.drawInvert,1), 1);
            this.Draw.rect(this.cursor.mult(this.tileSize).add(this.levelOffset), new Vector(this.tileSize, this.tileSize), '#FFFFFF44')
        }

        // UI drawing: overlays layer is cleared and used for UI elements
        this.UIDraw.useCtx('overlays')
        this.UIDraw.clear()
        // Draw a right-side tile palette using UIDraw
        try {
            const uiCtx = this.UIDraw.getCtx('UI');
            if (uiCtx) {
                const uiW = uiCtx.canvas.width / this.UIDraw.Scale.x;
                const uiH = uiCtx.canvas.height / this.UIDraw.Scale.y;
                const m = this.uiMenu;
                const menuX = uiW - m.menuWidth - m.margin;
                const menuY = m.margin;
                const menuH = uiH - m.margin * 2;

                // background panel
                this.UIDraw.rect(new Vector(menuX, menuY), new Vector(m.menuWidth, menuH), '#FFFFFF22');

                // draw each tile option in a grid
                const cols = Math.max(1, Math.floor((m.menuWidth - 16 + m.spacing) / (m.itemSize + m.spacing)));
                for (let i = 0; i < this.tileTypes.length; i++) {
                    const ty = this.tileTypes[i];
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    const xPos = menuX + 8 + col * (m.itemSize + m.spacing);
                    const yPos = menuY + 8 + row * (m.itemSize + m.spacing);
                    // item background
                    this.UIDraw.rect(new Vector(xPos, yPos), new Vector(m.itemSize, m.itemSize), '#FFFFFF11');
                    // highlight selection with stroke (compare arrays by string)
                    if (this.drawType && Array.isArray(this.drawType) && Array.isArray(ty) && this.drawType[0] === ty[0] && this.drawType[1] === ty[1]) {
                        this.UIDraw.rect(new Vector(xPos, yPos), new Vector(m.itemSize, m.itemSize), '#00000000', false, true, 3, '#FFFFFF88');
                    }
                    // draw tile icon centered inside item
                    const centerX = xPos + m.itemSize / 2;
                    const centerY = yPos + m.itemSize / 2;
                    this.UIDraw.tile(this._tilemap.getTileSheet('house'), new Vector(centerX-24, centerY-24), new Vector(m.itemSize, m.itemSize), ty, this.drawRot, new Vector(this.drawInvert,1), 1, false);
                }
                // draw Save / Load buttons below the grid
                try {
                    const rowsUsed = Math.ceil(this.tileTypes.length / cols);
                    const gridH = rowsUsed * (m.itemSize + m.spacing) - m.spacing;
                    const btnX = menuX + 8;
                    const btnW = m.menuWidth - 16;
                    const btnH = 28;
                    const btnYStart = menuY + 8 + gridH + m.spacing;
                        // Save to file button
                        this.UIDraw.rect(new Vector(btnX, btnYStart), new Vector(btnW, btnH), '#FFFFFF11');
                        this.UIDraw.text('Save File', new Vector(btnX + btnW / 2, btnYStart + btnH / 2 + 6), '#FFFFFFFF', 0, 18, { align: 'center' });
                        // Load from file button (stacked)
                        this.UIDraw.rect(new Vector(btnX, btnYStart + btnH + m.spacing), new Vector(btnW, btnH), '#FFFFFF11');
                        this.UIDraw.text('Load File', new Vector(btnX + btnW / 2, btnYStart + btnH + m.spacing + btnH / 2 + 6), '#FFFFFFFF', 0, 18, { align: 'center' });
                } catch (e) { /* ignore button draw errors */ }
            }
        } catch (e) {
            // ignore UI draw errors
        }
        // restore world transforms
        try { this.Draw.popMatrix(); } catch (e) { /* ignore */ }
        this.UIDraw.useCtx('UI')
    }
}
