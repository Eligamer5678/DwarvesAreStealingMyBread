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
import PackageManager from '../js/PackageManager.js';

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

        this.testSprite = new TestSprite(this.keys,this.UIDraw,new Vector(100,100),new Vector(200,200),sheet)
        this.loadTilemap()

        // create package manager for import/export (needs tilemap)
        this.drawSheet = 'house';
        this.packageManager = null; // initialized after tilemap
        // UI click debounce flag (prevents multiple triggers per press)
        this._uiHandled = false;

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
        this.minZoom = 0.1
        this.maxZoom = 10.0
        this.zoomOrigin = null
        // selection state for editor (selected placed tile)
        this.selectedTile = null; // { x, y, info }
        this.selectionColor = '#FF0000FF';
        // edit mode (false = normal, true = editing a selected tile)
        this.editmode = false;
        this.editMenuWidth = 300;
    // quick color picker for edit panel (array of Color instances)
    this.editPaletteColors = ['#000000FF','#FFFFFFFF','#FF0000FF','#00FF00FF','#0000FFFF','#FFFF00FF','#FF00FFFF','#808080FF','#C08040FF'].map(c=>Color.convertColor(c));
    this.editColor = Color.convertColor('#FFFFFFFF');
    // eyedropper / color input state
    this.eyedropActive = false;
        
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

        // populate tileTypes from all registered sheets (sheetId,row,col entries)
        this.tileTypes = [];
        for (const [id, sheetObj] of this._tilemap.tileSheets.entries()) {
            try {
                const img = sheetObj.sheet;
                const cols = Math.max(1, Math.floor(img.width / sheetObj.slicePx));
                const rows = Math.max(1, Math.floor(img.height / sheetObj.slicePx));
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        this.tileTypes.push({ sheetId: id, row: r, col: c });
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }

    // Prepare an offscreen edit canvas for the currently selected tile.
    prepareEditTile(){
        try {
            if (!this.selectedTile || !this.selectedTile.info) return false;
            const info = this.selectedTile.info;
            const ts = info.sheet; // TileSheet object
            const slice = ts.slicePx || 16;

            // determine row/col of the tileKey
            let row = 0, col = 0;
            const tk = info.tileKey;
            if (Array.isArray(tk)) {
                row = tk[0]; col = tk[1];
            } else if (typeof tk === 'string' && typeof ts.getTile === 'function') {
                const meta = ts.getTile(tk);
                if (meta) { row = meta.row; col = meta.col; }
            }

            // ensure the master tilesheet is a canvas so we can write back pixels
            if (!(ts.sheet instanceof HTMLCanvasElement)) {
                const orig = ts.sheet;
                const cv = document.createElement('canvas');
                cv.width = orig.width || (col + 1) * slice;
                cv.height = orig.height || (row + 1) * slice;
                const ctx = cv.getContext('2d');
                try { ctx.drawImage(orig, 0, 0); } catch (e) {}
                ts.sheet = cv;
            }

            // create edit canvas sized to the tile pixel dimensions
            const edit = document.createElement('canvas');
            edit.width = slice;
            edit.height = slice;
            const ectx = edit.getContext('2d');
            // copy the tile pixels from the master tilesheet into edit canvas
            try {
                ectx.clearRect(0,0,edit.width, edit.height);
                ectx.drawImage(ts.sheet, col * slice, row * slice, slice, slice, 0, 0, slice, slice);
            } catch (e) { console.warn('prepareEditTile draw failed', e); }

            this.editTileCanvas = edit;
            this.editTilesheet = ts;
            this.editTileRow = row;
            this.editTileCol = col;
            // zoom for editor view (scale up for comfortable editing)
            this.editTileZoom = Math.max(4, Math.floor((this.editMenuWidth - 40) / slice));
            this.editColor = this.editColor || '#FFFFFFFF';
            return true;
        } catch (e) {
            console.warn('prepareEditTile failed', e);
            return false;
        }
    }

    // Create a new standalone tilesheet (1 tile) and open it for editing
    createNewTile(){
        try {
            // Use the slice size from the current edit tilesheet if available, else default to 16
            const baseTs = this.editTilesheet || (this.selectedTile && this.selectedTile.info && this.selectedTile.info.sheet) || null;
            const slice = (baseTs && baseTs.slicePx) ? baseTs.slicePx : 16;

            // create a small canvas for a single tile and fill with current edit color
            const cv = document.createElement('canvas');
            cv.width = slice;
            cv.height = slice;
            const ctx = cv.getContext('2d');
            try {
                // use Color helper to produce rgb bytes
                const col = Color.convertColor(this.editColor || '#FFFFFFFF').toRgb();
                const r = Math.round(col.a || 0);
                const g = Math.round(col.b || 0);
                const b = Math.round(col.c || 0);
                const a = Math.round((col.d || 1) * 255);
                ctx.fillStyle = `rgba(${r},${g},${b},${a/255})`;
                ctx.fillRect(0,0,slice,slice);
            } catch (e) { /* ignore */ }

            const ts = new TileSheet(cv, slice);
            const tileName = `tile_0_0`;
            try { ts.addTile(tileName, 0, 0); } catch (e) { /* ignore */ }

            // register as a new tilesheet id
            this._newSheetCounter = (this._newSheetCounter || 0) + 1;
            const sheetId = `customsheet_${Date.now().toString(36)}_${this._newSheetCounter}`;
            this._tilemap.registerTileSheet(sheetId, ts);

            // rebuild palette entries so UI shows the new tile
            this.tileTypes = [];
            for (const [id, tss] of this._tilemap.tileSheets.entries()) {
                try {
                    const img = tss.sheet;
                    const cols = Math.max(1, Math.floor(img.width / tss.slicePx));
                    const rows = Math.max(1, Math.floor(img.height / tss.slicePx));
                    for (let r = 0; r < rows; r++) {
                        for (let c = 0; c < cols; c++) {
                            this.tileTypes.push({ sheetId: id, row: r, col: c });
                        }
                    }
                } catch (e) { /* ignore */ }
            }
 
            // open the new tile in the editor
            this.editTilesheet = ts;
            this.editTileRow = 0;
            this.editTileCol = 0;
            // If a placed tile is currently selected, replace it with the new tile
            if (this.selectedTile && typeof this.selectedTile.x === 'number' && typeof this.selectedTile.y === 'number') {
                try {
                    // place the new tile at the selected coordinates (use array [row,col])
                    this._tilemap.setTile(this.selectedTile.x, this.selectedTile.y, sheetId, [0,0], 0);
                    // update selectedTile.info so editor shows the new tile
                    this.selectedTile.info = { sheet: ts, tileKey: [0,0], tilesheetId: sheetId, rotation: 0 };
                } catch (e) { /* ignore placement errors */ }
            } else {
                // set palette drawing to the new tile so user can place it
                this.drawSheet = sheetId;
                this.drawType = [0,0];
            }

            // prepare the edit canvas using selectedTile.info (or direct tilesheet info)
            this.prepareEditTile();
            // open the editor for the newly created tile
            this.editmode = true;
            try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
            this.rotDelay = this.rotSetDelay;
            return true;
        } catch (e) {
            console.warn('createNewTile failed', e);
            return false;
        }
    }

    // Apply the contents of editTileCanvas back into the registered tilesheet image
    applyEditTileToTilesheet(){
        try {
            if (!this.editTileCanvas || !this.editTilesheet) return false;
            const slice = this.editTileCanvas.width;
            const sx = this.editTileCol * slice;
            const sy = this.editTileRow * slice;
            const ctx = this.editTilesheet.sheet.getContext('2d');
            ctx.clearRect(sx, sy, slice, slice);
            ctx.drawImage(this.editTileCanvas, 0, 0, slice, slice, sx, sy, slice, slice);
            return true;
        } catch (e) {
            console.warn('applyEditTileToTilesheet failed', e);
            return false;
        }
    }

    exitEditMode(){
        try {
            // apply any remaining changes
            this.applyEditTileToTilesheet();
        } catch (e) {}
        this.editmode = false;
        // keep edit canvas in memory if needed, but could cleanup
    }

    // Convert hex color '#RRGGBBAA' or '#RRGGBB' into [r,g,b,a]
    _hexToRGBA(hex){
        if (!hex) return [0,0,0,255];
        let h = hex.replace('#','');
        if (h.length === 6) h += 'FF';
        if (h.length !== 8) return [0,0,0,255];
        const r = parseInt(h.substr(0,2),16);
        const g = parseInt(h.substr(2,2),16);
        const b = parseInt(h.substr(4,2),16);
        const a = parseInt(h.substr(6,2),16);
        return [r,g,b,a];
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

    // Export currently registered tilesheets including image data (dataURLs)
    // Create a tar archive Blob from entries: [{name, uint8Array}]
    async createTarBlob(entries){
        // helper to create header
        function writeString(buf, offset, str, length){
            for (let i=0;i<length;i++) buf[offset+i]=0;
            const bytes = new TextEncoder().encode(str);
            buf.set(bytes.subarray(0, Math.min(bytes.length, length)), offset);
        }

        const parts = [];
        for (const ent of entries){
            const name = ent.name;
            const data = ent.data instanceof Uint8Array ? ent.data : (ent.data instanceof ArrayBuffer ? new Uint8Array(ent.data) : new Uint8Array(ent.data));
            const size = data.length;

            const header = new Uint8Array(512);
            writeString(header, 0, name, 100);
            writeString(header, 100, '0000777', 8);
            writeString(header, 108, '0000000', 8);
            writeString(header, 116, '0000000', 8);
            // size field as octal
            const sizeOct = size.toString(8).padStart(11,'0') + '\0';
            writeString(header, 124, sizeOct, 12);
            const mtimeOct = Math.floor(Date.now()/1000).toString(8).padStart(11,'0') + '\0';
            writeString(header, 136, mtimeOct, 12);
            // checksum: fill with spaces for now
            for (let i=148;i<156;i++) header[i]=32;
            header[156]=48; // typeflag '0'
            writeString(header, 257, 'ustar\0', 6);
            writeString(header, 263, '00', 2);
            // compute checksum
            let sum = 0;
            for (let i=0;i<512;i++) sum += header[i];
            const chks = sum.toString(8).padStart(6,'0') + '\0 ';
            writeString(header, 148, chks, 8);

            parts.push(header);
            parts.push(data);
            // pad to 512
            const pad = (512 - (size % 512)) % 512;
            if (pad>0) parts.push(new Uint8Array(pad));
        }
        // two 512-byte zero blocks
        parts.push(new Uint8Array(512));
        parts.push(new Uint8Array(512));

        return new Blob(parts, { type: 'application/x-tar' });
    }

    // Export currently registered tilesheets as a tar archive including JSON and image files
    async exportTileSheetsAsTarFile(filename = 'tilesheets.tar'){
        try {
            const sheets = [];
            const entries = [];
            for (const [id, ts] of this._tilemap.tileSheets.entries()) {
                // gather tiles map
                let tilesObj = {};
                try {
                    if (ts.tiles instanceof Map) {
                        for (const [k, v] of ts.tiles.entries()) tilesObj[k] = v;
                    } else if (ts.tiles) {
                        tilesObj = ts.tiles;
                    }
                } catch (e) { tilesObj = {}; }

                // convert image to blob if possible
                try {
                    const img = ts.sheet;
                    if (img && img.width && img.height) {
                        // draw to canvas and get PNG blob
                        const c = document.createElement('canvas');
                        c.width = img.width;
                        c.height = img.height;
                        const ctx = c.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
                        const arrayBuf = await blob.arrayBuffer();
                        entries.push({ name: `images/${id}.png`, data: new Uint8Array(arrayBuf) });
                        sheets.push({ id, slicePx: ts.slicePx, tiles: tilesObj, imageFile: `images/${id}.png` });
                    } else if (img && img.src) {
                        // fallback: include src as text file
                        entries.push({ name: `images/${id}.txt`, data: new TextEncoder().encode(img.src) });
                        sheets.push({ id, slicePx: ts.slicePx, tiles: tilesObj, imageFile: `images/${id}.txt` });
                    }
                } catch (e) {
                    console.warn('Could not include image for', id, e);
                    sheets.push({ id, slicePx: ts.slicePx, tiles: tilesObj, imageFile: null });
                }
            }

            const payload = { sheets };
            const json = JSON.stringify(payload, null, 2);
            entries.push({ name: 'tilesheets.json', data: new TextEncoder().encode(json) });

            // include current map/editor state as map.json
            try {
                const mapPayload = {
                    map: (this._tilemap && typeof this._tilemap.toJSON === 'function') ? this._tilemap.toJSON() : null,
                    levelOffset: (this.levelOffset && typeof this.levelOffset.encode === 'function') ? this.levelOffset.encode ? this.levelOffset.encode() : Vector.encode(this.levelOffset) : Vector.encode(this.levelOffset),
                    tileSize: this.tileSize,
                    drawType: this.drawType,
                    drawRot: this.drawRot,
                    drawInvert: this.drawInvert,
                    zoom: this.zoom
                };
                const mapJson = JSON.stringify(mapPayload, null, 2);
                entries.push({ name: 'map.json', data: new TextEncoder().encode(mapJson) });
            } catch (e) { /* ignore map export errors */ }

            const tarBlob = await this.createTarBlob(entries);
            const url = URL.createObjectURL(tarBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            console.log('Tilesheets exported to tar file:', filename);
        } catch (e) {
            console.warn('Export tilesheets tar failed:', e);
        }
    }

    // Prompt user to pick a JSON file and import tilesheets
    loadTileSheetsFromFile(){
        return new Promise((resolve) => {
            try {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json';
                input.style.display = 'none';
                input.onchange = async (e) => {
                    const file = e.target.files && e.target.files[0];
                    if (!file) { resolve(false); return; }
                    const reader = new FileReader();
                    reader.onload = async (ev) => {
                        try {
                            const payload = JSON.parse(ev.target.result);
                            const ok = await this.loadTileSheetsFromPayload(payload);
                            resolve(ok);
                        } catch (err) {
                            console.warn('Failed to parse tilesheet file:', err);
                            resolve(false);
                        }
                    };
                    reader.onerror = (err) => { console.warn('File read error', err); resolve(false); };
                    reader.readAsText(file);
                };
                document.body.appendChild(input);
                input.click();
                setTimeout(() => { try { input.remove(); } catch (e){} }, 3000);
            } catch (e) { console.warn('Load file failed:', e); resolve(false); }
        });
    }

    // Prompt user to pick image files (PNG/JPG) or a JSON payload and import accordingly
    promptImportFiles(){
        return new Promise((resolve) => {
            try {
                const input = document.createElement('input');
                input.type = 'file';
                // allow JSON, images, and tar archives
                input.accept = '.json,application/json,image/*,.tar,application/x-tar,application/tar';
                input.multiple = true;
                input.style.display = 'none';
                input.onchange = async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (!files.length) { resolve(false); return; }

                    // Separate images vs json vs tar
                    const imageFiles = files.filter(f => f.type && f.type.startsWith('image'));
                    const jsonFiles = files.filter(f => f.type && (f.type === 'application/json' || f.name.toLowerCase().endsWith('.json')));
                    const tarFiles = files.filter(f => f.name.toLowerCase().endsWith('.tar') || f.type === 'application/x-tar');

                    let anyOk = false;

                    // Handle image files: create tilesheets
                    for (const f of imageFiles) {
                        try {
                            const dataUrl = await new Promise((res, rej) => {
                                const r = new FileReader();
                                r.onload = () => res(r.result);
                                r.onerror = () => rej(new Error('readFailed'));
                                r.readAsDataURL(f);
                            });
                            const img = new Image();
                            const p = new Promise((res, rej) => { img.onload = () => res(true); img.onerror = () => res(false); });
                            img.src = dataUrl;
                            await p;
                            // ask for slice size (try to infer default from filename or use 16)
                            let defaultSlice = 16;
                            try {
                                // try to infer: if name contains numbers like 32,64
                                const m = f.name.match(/(\d{2,3})/);
                                if (m) defaultSlice = parseInt(m[1], 10);
                            } catch (e) {}
                            const sliceStr = window.prompt(`Enter tile slice size (px) for ${f.name}:`, String(defaultSlice));
                            const slicePx = Math.max(1, Number(sliceStr) || defaultSlice);
                            const id = f.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, '_');
                            const ts = new TileSheet(img, slicePx);
                            // auto-add tile entries by grid positions as numeric keys
                            try {
                                const cols = Math.max(1, Math.floor(img.width / slicePx));
                                const rows = Math.max(1, Math.floor(img.height / slicePx));
                                for (let r = 0; r < rows; r++) {
                                    for (let c = 0; c < cols; c++) {
                                        // name them by r_c for convenience
                                        ts.addTile(`${r}_${c}`, r, c);
                                    }
                                }
                            } catch (e) { /* ignore */ }
                            this._tilemap.registerTileSheet(id, ts);
                            anyOk = true;
                        } catch (e) {
                            console.warn('Failed to import image file as tilesheet', f.name, e);
                        }
                    }

                    // Handle JSON files: attempt to parse and apply payloads
                    for (const f of jsonFiles) {
                        try {
                            const text = await new Promise((res, rej) => {
                                const r = new FileReader();
                                r.onload = () => res(r.result);
                                r.onerror = () => rej(new Error('readFailed'));
                                r.readAsText(f);
                            });
                            const payload = JSON.parse(text);
                            const ok = await this.loadTileSheetsFromPayload(payload);
                            anyOk = anyOk || ok;
                        } catch (e) {
                            console.warn('Failed to import JSON tilesheet file', f.name, e);
                        }
                    }

                    // Handle tar files: parse tar and extract tilesheets.json + images
                    for (const f of tarFiles) {
                        try {
                            const arrayBuf = await new Promise((res, rej) => {
                                const r = new FileReader();
                                r.onload = () => res(r.result);
                                r.onerror = () => rej(new Error('readFailed'));
                                r.readAsArrayBuffer(f);
                            });
                            const parsed = await this.loadTileSheetsFromTarBuffer(arrayBuf);
                            if (parsed && parsed.sheetsPayload) {
                                const ok = await this.loadTileSheetsFromPayload(parsed.sheetsPayload);
                                anyOk = anyOk || ok;
                                // if there is a map payload, apply it after sheets are registered
                                if (parsed.mapPayload) {
                                    const mapOk = this.loadMapFromPayload(parsed.mapPayload);
                                    anyOk = anyOk || mapOk;
                                }
                            }
                        } catch (e) {
                            console.warn('Failed to import tar tilesheet file', f.name, e);
                        }
                    }

                    // refresh palette entries now that new sheets may be registered
                    this.tileTypes = [];
                    for (const [id, ts] of this._tilemap.tileSheets.entries()) {
                        try {
                            const img = ts.sheet;
                            const cols = Math.max(1, Math.floor(img.width / ts.slicePx));
                            const rows = Math.max(1, Math.floor(img.height / ts.slicePx));
                            for (let r = 0; r < rows; r++) {
                                for (let c = 0; c < cols; c++) {
                                    this.tileTypes.push({ sheetId: id, row: r, col: c });
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }

                    try { if (input && input.parentNode) document.body.removeChild(input); } catch (e) { /* ignore if already removed */ }
                    resolve(anyOk);
                };
                document.body.appendChild(input);
                input.click();
                setTimeout(() => { try { input.remove(); } catch (e){} }, 3000);
            } catch (e) { console.warn('Import files failed:', e); resolve(false); }
        });
    }

    // Parse a tar archive ArrayBuffer and return payload object similar to exported tilesheets.json
    async loadTileSheetsFromTarBuffer(arrayBuffer){
        try {
            const u = new Uint8Array(arrayBuffer);
            const entries = {};
            let offset = 0;
            while (offset + 512 <= u.length) {
                // read header
                const nameBytes = u.subarray(offset, offset+100);
                const name = new TextDecoder().decode(nameBytes).replace(/\0.*$/,'');
                if (!name) break;
                const sizeBytes = u.subarray(offset+124, offset+136);
                const sizeStr = new TextDecoder().decode(sizeBytes).replace(/\0.*$/,'').trim();
                const size = sizeStr ? parseInt(sizeStr, 8) : 0;
                offset += 512;
                const data = u.subarray(offset, offset + size);
                entries[name] = data.slice();
                const skip = (512 - (size % 512)) % 512;
                offset += size + skip;
            }

            // find tilesheets.json (allow for path prefixes)
            const keys = Object.keys(entries);
            const tsKey = keys.find(k => k.toLowerCase().endsWith('tilesheets.json'));
            if (!tsKey) {
                console.warn('Tar archive missing tilesheets.json');
                return null;
            }
            const jsonText = new TextDecoder().decode(entries[tsKey]);
            const payload = JSON.parse(jsonText);
            // convert image entries to object URLs and set imageFile -> imageData
            for (const s of payload.sheets) {
                if (s.imageFile) {
                    const imgKey = keys.find(k => k.toLowerCase().endsWith(s.imageFile.toLowerCase()));
                    if (imgKey && entries[imgKey]) {
                        const arr = entries[imgKey];
                        const blob = new Blob([arr], { type: 'image/png' });
                        const url = URL.createObjectURL(blob);
                        s.imageData = url;
                    }
                }
            }

            // also look for map.json (allow path prefixes)
            const mapKey = keys.find(k => k.toLowerCase().endsWith('map.json'));
            let mapPayload = null;
            if (mapKey && entries[mapKey]) {
                try {
                    const mapText = new TextDecoder().decode(entries[mapKey]);
                    mapPayload = JSON.parse(mapText);
                } catch (e) { console.warn('Failed to parse map.json from tar', e); }
            }

            return { sheetsPayload: payload, mapPayload };
        } catch (e) {
            console.warn('Failed to parse tar buffer', e);
            return null;
        }
    }

    // Apply payload containing tilesheets: { sheets: [{id, slicePx, tiles, imageData}] }
    async loadTileSheetsFromPayload(payload){
        try {
            if (!payload || !Array.isArray(payload.sheets)) return false;
            for (const s of payload.sheets) {
                try {
                    const img = new Image();
                    // ensure we wait for load
                    const p = new Promise((res, rej) => { img.onload = () => res(true); img.onerror = () => res(false); });
                    img.src = s.imageData || s.url || '';
                    await p;
                    const ts = new TileSheet(img, s.slicePx || 16);
                    // restore tiles
                    if (s.tiles) {
                        if (Array.isArray(s.tiles)) {
                            for (const [k, v] of s.tiles) ts.addTile(k, v.row, v.col);
                        } else {
                            for (const k of Object.keys(s.tiles)) {
                                const v = s.tiles[k];
                                if (v && typeof v.row !== 'undefined') ts.addTile(k, v.row, v.col);
                            }
                        }
                    }
                    // register under given id (or generate if missing)
                    const id = s.id || ('sheet_' + Math.random().toString(36).slice(2,9));
                    this._tilemap.registerTileSheet(id, ts);
                } catch (e) {
                    console.warn('Failed to apply tilesheet', s && s.id, e);
                }
            }
            // refresh palette types so UI includes newly loaded sheets
            this.tileTypes = [];
            // populate tileTypes now from all registered sheets
            for (const [id, ts] of this._tilemap.tileSheets.entries()) {
                try {
                    const img = ts.sheet;
                    const cols = Math.max(1, Math.floor(img.width / ts.slicePx));
                    const rows = Math.max(1, Math.floor(img.height / ts.slicePx));
                    for (let r = 0; r < rows; r++) {
                        for (let c = 0; c < cols; c++) {
                            this.tileTypes.push({ sheetId: id, row: r, col: c });
                        }
                    }
                } catch (e) { /* ignore */ }
            }
            console.log('Tilesheets loaded from payload');
            return true;
        } catch (e) {
            console.warn('Applying tilesheet payload failed:', e);
            return false;
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
                            // populate from all registered sheets
                            for (const [id, ts] of this._tilemap.tileSheets.entries()) {
                                const img = ts && ts.sheet;
                                if (ts && img && img.width && ts.slicePx) {
                                    const cols = Math.max(1, Math.floor(img.width / ts.slicePx));
                                    const rows = Math.max(1, Math.floor(img.height / ts.slicePx));
                                    for (let r = 0; r < rows; r++) {
                                        for (let c = 0; c < cols; c++) {
                                            this.tileTypes.push({ sheetId: id, row: r, col: c });
                                        }
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

                        if (this.mouse.pressed('left') && !this._uiHandled) {
                            // if click within grid
                            if (mp.y >= menuY + 8 && mp.y <= menuY + 8 + gridH) {
                                const relX = mp.x - (menuX + 8);
                                const relY = mp.y - (menuY + 8);
                                const col = Math.floor(relX / (m.itemSize + m.spacing));
                                const row = Math.floor(relY / (m.itemSize + m.spacing));
                                const idx = row * cols + col;
                                if (idx >= 0 && idx < this.tileTypes.length) {
                                    const t = this.tileTypes[idx];
                                    // store tile key and current sheet for placement
                                    this.drawType = [t.row, t.col];
                                    this.drawSheet = t.sheetId;
                                    this._uiHandled = true;
                                }
                            } else if (mp.x >= btnX && mp.x <= btnX + btnW) {
                                // two buttons: Export Tilesheets, Import Tilesheets
                                const y0 = btnYStart;
                                const y1 = y0 + (btnH + m.spacing);
                                        if (mp.y >= y0 && mp.y <= y0 + btnH) {
                                            // Export tilesheets
                                            try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                                            if (!this.packageManager) this.packageManager = new PackageManager(this._tilemap, this);
                                            // build map payload from current scene state
                                            const mapPayload = {
                                                map: (this._tilemap && typeof this._tilemap.toJSON === 'function') ? this._tilemap.toJSON() : null,
                                                levelOffset: Vector.encode(this.levelOffset),
                                                tileSize: this.tileSize,
                                                drawType: this.drawType,
                                                drawRot: this.drawRot,
                                                drawInvert: this.drawInvert,
                                                zoom: this.zoom
                                            };
                                            this.packageManager.exportAsTarFile('tilesheets.tar', mapPayload);
                                    this._uiHandled = true;
                                } else if (mp.y >= y1 && mp.y <= y1 + btnH) {
                                    // Import tilesheets or image files (open file picker)
                                    try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                                    this.promptImportFiles();
                                    this._uiHandled = true;
                                }
                            }
                        }
                    }
                }
            } catch (e) { /* ignore UI hit test errors */ }
        }

        // If edit mode is open, treat the left-side edit menu area as UI so clicks there
        // don't paint the map. This ensures the left panel blocks placement while open.
        try {
            if (this.editmode) {
                const leftW = this.editMenuWidth || 300;
                if (this.mouse.pos.x <= leftW) pointerOverUI = true;
            }
        } catch (e) { /* ignore */ }

        // Handle clicks inside the edit panel for close/create buttons
        try {
            if (this.editmode && this.mouse.pressed('left') && this.mouse.pos) {
                const mp = this.mouse.pos;
                const leftW = this.editMenuWidth || 300;
                const panelX = 8;
                const panelY = 8;
                const panelW = leftW;
                const panelH = (this.UIDraw.getCtx('UI') ? (this.UIDraw.getCtx('UI').canvas.height / this.UIDraw.Scale.y) : 800) - 16;
                // color swatches layout (small palette near top of panel)
                const swatchSize = 20;
                const swatchSpacing = 8;
                const swatchCols = 10;
                const swStartX = panelX + 12;
                // shift swatches down to avoid overlapping the edit canvas
                const swStartY = panelY + 36 + 300;
                // handle clicks on color swatches
                // color input and eyedropper buttons
                const colorDisplayX = panelX + 12;
                // move action buttons down to avoid overlapping the edit canvas
                const colorDisplayY = panelY + 36 + 350;
                const colorDisplayW = 28;
                const colorDisplayH = 28;
                const chooseX = colorDisplayX + colorDisplayW + 8;
                const chooseY = colorDisplayY;
                const chooseW = 100;
                const chooseH = 28;
                const dropX = chooseX + chooseW + 8;
                const dropY = chooseY;
                const dropW = 90;
                const dropH = 28;
                // Choose Color button: opens native color picker
                if (mp.x >= chooseX && mp.x <= chooseX + chooseW && mp.y >= chooseY && mp.y <= chooseY + chooseH) {
                    try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                    // create a temporary input[type=color]
                    try {
                        const inp = document.createElement('input');
                        inp.type = 'color';
                        // use current editColor hex (drop alpha)
                        try { inp.value = (this.editColor && typeof this.editColor.toHex === 'function') ? this.editColor.toHex().slice(0,7) : '#ffffff'; } catch (e) { inp.value = '#ffffff'; }
                        inp.style.position = 'fixed'; inp.style.left = '-100px'; inp.style.top = '-100px';
                        inp.addEventListener('input', (ev) => {
                            try {
                                const v = ev.target.value; // #rrggbb
                                let c = Color.fromHex(v);
                                // preserve previous alpha
                                if (this.editColor && typeof this.editColor.d !== 'undefined') c.d = this.editColor.d;
                                this.editColor = c;
                            } catch (e) { /* ignore */ }
                        });
                        inp.addEventListener('change', ()=>{ try { inp.remove(); } catch(e){} });
                        document.body.appendChild(inp);
                        inp.click();
                    } catch (e) { console.warn('Color input failed', e); }
                    this.rotDelay = this.rotSetDelay; this._uiHandled = true;
                }
                // Eyedropper toggle
                if (mp.x >= dropX && mp.x <= dropX + dropW && mp.y >= dropY && mp.y <= dropY + dropH) {
                    try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                    this.eyedropActive = !this.eyedropActive;
                    this.rotDelay = this.rotSetDelay; this._uiHandled = true;
                }

                if (this.mouse.pressed('left') && Array.isArray(this.editPaletteColors)) {
                    for (let si = 0; si < this.editPaletteColors.length; si++) {
                        const scol = si % swatchCols;
                        const srow = Math.floor(si / swatchCols);
                        const sx = swStartX + scol * (swatchSize + swatchSpacing);
                        const sy = swStartY + srow * (swatchSize + swatchSpacing);
                        if (mp.x >= sx && mp.x <= sx + swatchSize && mp.y >= sy && mp.y <= sy + swatchSize) {
                            // select this color (store Color instance)
                            this.editColor = this.editPaletteColors[si];
                            try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                            this.rotDelay = this.rotSetDelay;
                            this._uiHandled = true;
                            break;
                        }
                    }
                }
                // close button region
                const bx = panelX + panelW - 28;
                const by = panelY + 8;
                const bw = 20;
                const bh = 20;
                if (mp.x >= bx && mp.x <= bx + bw && mp.y >= by && mp.y <= by + bh) {
                    try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                    this.exitEditMode();
                    this._uiHandled = true;
                }
                // create new tile button
                const btnX = panelX + 12;
                const btnY = panelY + panelH - 56;
                const btnW = panelW - 24;
                const btnH = 36;
                if (mp.x >= btnX && mp.x <= btnX + btnW && mp.y >= btnY && mp.y <= btnY + btnH) {
                    try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                    if(this.rotDelay<-1){
                        this.createNewTile();
                        this.rotDelay = 1
                    }
                    this._uiHandled = true;
                }
                // if eyedropper was active and we clicked inside the edit canvas area, handle sampling here
                if (this.eyedropActive) {
                    // we will sample inside the pixel-edit block below (on press inside canvas)
                    // but clear UI handled so sampling can occur
                    this._uiHandled = false;
                }
            }
        } catch (e) { /* ignore */ }
        // Handle Shift+click selection: when Shift is held and left is pressed, select placed tile under cursor
        try {
            if (!pointerOverUI && this.mouse.pressed('left') && this.keys.held('Shift')) {
                const info = this._tilemap.getTileRenderInfo(this.cursor.x, this.cursor.y);
                if (info) {
                    this.selectedTile = { x: this.cursor.x, y: this.cursor.y, info };
                } else {
                    // clear selection if clicking empty tile
                    this.selectedTile = null;
                }
                // don't paint when selecting
                this._uiHandled = true;
            }
        } catch (e) { /* ignore selection errors */ }

        // Eyedropper: if active and clicked on the world (not UI), sample pixel from placed tile under cursor
        try {
            if (this.eyedropActive && !pointerOverUI && (this.mouse.pressed('left') || this.mouse.held('left'))) {
                const info = this._tilemap.getTileRenderInfo(this.cursor.x, this.cursor.y);
                if (info && info.sheet) {
                    try {
                        const ts = info.sheet; // TileSheet
                        const slice = ts.slicePx || 16;
                        // determine row/col of the tile
                        let row = 0, col = 0;
                        const tk = info.tileKey;
                        if (Array.isArray(tk)) { row = tk[0]; col = tk[1]; }
                        else if (typeof tk === 'string' && typeof ts.getTile === 'function') {
                            const meta = ts.getTile(tk);
                            if (meta) { row = meta.row; col = meta.col; }
                        }

                        // compute world-space mouse -> pixel within tile
                        const drawCtx = this.Draw.ctx;
                        let origin = new Vector(0,0);
                        if (drawCtx) {
                            const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
                            const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
                            const center = new Vector(uiW/2, uiH/2);
                            origin = this.zoomOrigin ? this.zoomOrigin : center;
                        }
                        const worldPos = this.mouse.pos.sub(origin).div(this.zoom).add(origin);
                        const local = worldPos.sub(this.levelOffset);
                        const withinTileX = local.x - (this.cursor.x * this.tileSize);
                        const withinTileY = local.y - (this.cursor.y * this.tileSize);

                        const px = Math.floor((withinTileX / this.tileSize) * slice);
                        const py = Math.floor((withinTileY / this.tileSize) * slice);
                        if (px < 0 || py < 0 || px >= slice || py >= slice) {
                            // clicked outside precise tile pixels, ignore
                        } else {
                            // prepare a temp canvas for the tile pixels
                            let source = ts.sheet;
                            const tmp = document.createElement('canvas');
                            tmp.width = slice; tmp.height = slice;
                            const tctx = tmp.getContext('2d');
                            try {
                                tctx.clearRect(0,0,slice,slice);
                                tctx.drawImage(source, col * slice, row * slice, slice, slice, 0, 0, slice, slice);
                                const d = tctx.getImageData(px, py, 1, 1).data;
                                const picked = new Color(d[0], d[1], d[2], (d[3] || 255) / 255, 'rgb');
                                this.editColor = picked;
                                this.eyedropActive = false;
                                try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                                this.rotDelay = this.rotSetDelay;
                                this._uiHandled = true;
                            } catch (e) {
                                console.warn('Eyedrop world sample failed', e);
                            }
                        }
                    } catch (e) { /* ignore eyedrop sampling errors */ }
                }
            }
        } catch (e) { /* ignore */ }

        // If editing a selected tile, allow painting directly in the world view (pixel-level)
        try {
            if (this.editmode && this.selectedTile && typeof this.selectedTile.x === 'number' && !pointerOverUI && (this.mouse.pressed('left') || this.mouse.held('left') || this.mouse.pressed('right') || this.mouse.held('right'))) {
                const sel = this.selectedTile;
                const info = sel.info;
                if (info && info.sheet) {
                    try {
                        const ts = info.sheet;
                        const slice = ts.slicePx || 16;
                        // determine row/col in tilesheet
                        let row = 0, col = 0;
                        const tk = info.tileKey;
                        if (Array.isArray(tk)) { row = tk[0]; col = tk[1]; }
                        else if (typeof tk === 'string' && typeof ts.getTile === 'function') {
                            const meta = ts.getTile(tk);
                            if (meta) { row = meta.row; col = meta.col; }
                        }

                        // compute pixel coords inside the tile based on world mouse position
                        const drawCtx = this.Draw.ctx;
                        let origin = new Vector(0,0);
                        if (drawCtx) {
                            const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
                            const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
                            const center = new Vector(uiW/2, uiH/2);
                            origin = this.zoomOrigin ? this.zoomOrigin : center;
                        }
                        const worldPos = this.mouse.pos.sub(origin).div(this.zoom).add(origin);
                        const local = worldPos.sub(this.levelOffset);
                        const withinTileX = local.x - (sel.x * this.tileSize);
                        const withinTileY = local.y - (sel.y * this.tileSize);
                        const px = Math.floor((withinTileX / this.tileSize) * slice);
                        const py = Math.floor((withinTileY / this.tileSize) * slice);

                        if (px >= 0 && py >= 0 && px < slice && py < slice) {
                            // ensure master tilesheet is a canvas we can write to
                            if (!(ts.sheet instanceof HTMLCanvasElement)) {
                                const orig = ts.sheet;
                                const cv = document.createElement('canvas');
                                cv.width = orig.width || (col + 1) * slice;
                                cv.height = orig.height || (row + 1) * slice;
                                const ctx = cv.getContext('2d');
                                try { ctx.drawImage(orig, 0, 0); } catch (e) {}
                                ts.sheet = cv;
                            }
                            const ctx = ts.sheet.getContext('2d');
                            const im = ctx.getImageData(col * slice, row * slice, slice, slice);
                            const idx = (py * slice + px) * 4;
                            if (this.mouse.held('right') || this.mouse.pressed('right')) {
                                im.data[idx+0] = 0; im.data[idx+1] = 0; im.data[idx+2] = 0; im.data[idx+3] = 0;
                            } else {
                                try {
                                    const colc = Color.convertColor(this.editColor || '#FFFFFFFF').toRgb();
                                    im.data[idx+0] = Math.round(colc.a || 0);
                                    im.data[idx+1] = Math.round(colc.b || 0);
                                    im.data[idx+2] = Math.round(colc.c || 0);
                                    im.data[idx+3] = Math.round((colc.d || 1) * 255);
                                } catch (e) {
                                    const rgba = this._hexToRGBA(this.editColor || '#FFFFFFFF');
                                    im.data[idx+0] = rgba[0]; im.data[idx+1] = rgba[1]; im.data[idx+2] = rgba[2]; im.data[idx+3] = rgba[3];
                                }
                            }
                            ctx.putImageData(im, col * slice, row * slice);
                            // update the edit canvas view if present
                            try {
                                if (this.editTileCanvas) {
                                    const edctx = this.editTileCanvas.getContext('2d');
                                    edctx.clearRect(0,0,this.editTileCanvas.width,this.editTileCanvas.height);
                                    edctx.drawImage(ts.sheet, col * slice, row * slice, slice, slice, 0, 0, slice, slice);
                                }
                            } catch (e) {}
                            this._uiHandled = true;
                            this.rotDelay = this.rotSetDelay;
                        }
                    } catch (e) { /* ignore painting errors */ }
                }
            } else if (!pointerOverUI && this.mouse.held('left') && !this.keys.held('Shift')){
                const sheetId = this.drawSheet || 'house';
                this._tilemap.setTile(this.cursor.x,this.cursor.y,sheetId,this.drawType,this.drawRot,this.drawInvert)
            }
        } catch (e) { /* ignore placement errors */ }
        // Toggle edit mode: press 'e' when a tile is selected to open/close the editor menu
        try {
            if (this.keys.pressed('e') && this.selectedTile) {
                if (!this.editmode) {
                    this.editmode = true;
                    try { this.prepareEditTile(); } catch (e) { console.warn('prepareEditTile failed', e); }
                } else {
                    try { this.exitEditMode(); } catch (e) { /* ignore */ }
                }
            }
            // close edit mode with Escape
            if (this.keys.pressed('Escape') && this.editmode) {
                try { this.exitEditMode(); } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }
        if(this.mouse.held('right')&& !this.editmode){
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
        if(this.rotDelay<0 && !this.keys.held('Control')){
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

        // Edit-mode pixel editing: when editmode active, handle clicks inside the left edit panel
        try {
            if (this.editmode && this.editTileCanvas) {
                const mp = this.mouse.pos;
                const panelX = 8;
                const panelY = 8;
                const padX = 12;
                const padY = 48;
                const slice = this.editTileCanvas.width;
                const zoom = this.editTileZoom || 8;
                const imgX = panelX + padX;
                const imgY = panelY + padY;
                const imgW = slice * zoom;
                const imgH = slice * zoom;

                const inside = (mp.x >= imgX && mp.x <= imgX + imgW && mp.y >= imgY && mp.y <= imgY + imgH);
                        if (inside && (this.mouse.pressed('left') || this.mouse.held('left') || this.mouse.pressed('right') || this.mouse.held('right'))) {
                    // compute pixel coords in edit canvas
                    const rx = Math.floor((mp.x - imgX) / zoom);
                    const ry = Math.floor((mp.y - imgY) / zoom);
                    if (rx >= 0 && rx < slice && ry >= 0 && ry < slice) {
                        // allow eyedropper sampling to take precedence over painting
                        let skipApply = false;
                        if (this.eyedropActive && (this.mouse.pressed('left') || this.mouse.held('left'))) {
                            try {
                                const ctxSample = this.editTileCanvas.getContext('2d');
                                const pixel = ctxSample.getImageData(rx, ry, 1, 1).data;
                                const picked = new Color(pixel[0], pixel[1], pixel[2], (pixel[3] || 255) / 255, 'rgb');
                                this.editColor = picked;
                                this.eyedropActive = false;
                                try { if (this.mouse && typeof this.mouse._setButton === 'function') this.mouse._setButton(0,0); } catch (e) {}
                                this.rotDelay = this.rotSetDelay;
                                this._uiHandled = true;
                                skipApply = true;
                            } catch (e) { console.warn('Eyedrop sample failed', e); }
                        }
                        const ctx = this.editTileCanvas.getContext('2d');
                        const im = ctx.getImageData(0,0,slice,slice);
                        const idx = (ry * slice + rx) * 4;
                                if (this.mouse.held('right') || this.mouse.pressed('right')) {
                                    // erase -> set alpha 0
                                    im.data[idx+0] = 0;
                                    im.data[idx+1] = 0;
                                    im.data[idx+2] = 0;
                                    im.data[idx+3] = 0;
                                } else {
                                    // use Color helper to get rgb bytes
                                    try {
                                        const col = Color.convertColor(this.editColor || '#FFFFFFFF').toRgb();
                                        im.data[idx+0] = Math.round(col.a || 0);
                                        im.data[idx+1] = Math.round(col.b || 0);
                                        im.data[idx+2] = Math.round(col.c || 0);
                                        im.data[idx+3] = Math.round((col.d || 1) * 255);
                                    } catch (e) {
                                        const rgba = this._hexToRGBA(this.editColor || '#FFFFFFFF');
                                        im.data[idx+0] = rgba[0];
                                        im.data[idx+1] = rgba[1];
                                        im.data[idx+2] = rgba[2];
                                        im.data[idx+3] = rgba[3];
                                    }
                                }
                        if (!skipApply) {
                            ctx.putImageData(im,0,0);
                            // immediately apply to tilesheet so world view updates
                            try { this.applyEditTileToTilesheet(); } catch (e) { console.warn('applyEditTileToTilesheet failed', e); }
                        }
                    }
                }
            }
        } catch (e) { /* ignore edit errors */ }

        // If middle was just released, and the grab delta is effectively zero, copy tile under mouse
        try {
            if (this.mouse.released('middle')) {
                // grabPos still set until we call releaseGrab(), so getGrabDelta() is valid
                const grabDelta = this.mouse.getGrabDelta();
                const tol = 1; // pixels tolerance
                if (Math.abs(grabDelta.x) <= tol && Math.abs(grabDelta.y) <= tol) {
                    // If we're editing, use middle-click as an eyedropper (sample color)
                    if (this.editmode) {
                        try {
                            const mp = this.mouse.pos;
                            // first try sampling from the edit canvas if mouse is over it
                            if (this.editTileCanvas) {
                                const panelX = 8, panelY = 8, padX = 12, padY = 48;
                                const slice = this.editTileCanvas.width;
                                const zoom = this.editTileZoom || 8;
                                const imgX = panelX + padX;
                                const imgY = panelY + padY;
                                const imgW = slice * zoom;
                                const imgH = slice * zoom;
                                if (mp.x >= imgX && mp.x <= imgX + imgW && mp.y >= imgY && mp.y <= imgY + imgH) {
                                    const rx = Math.floor((mp.x - imgX) / zoom);
                                    const ry = Math.floor((mp.y - imgY) / zoom);
                                    if (rx >= 0 && rx < slice && ry >= 0 && ry < slice) {
                                        try {
                                            const sctx = this.editTileCanvas.getContext('2d');
                                            const d = sctx.getImageData(rx, ry, 1, 1).data;
                                            this.editColor = new Color(d[0], d[1], d[2], (d[3]||255)/255, 'rgb');
                                            this.eyedropActive = false;
                                            this.rotDelay = this.rotSetDelay;
                                            this._uiHandled = true;
                                        } catch (e) { /* ignore sampling errors */ }
                                    }
                                } else {
                                    // not over edit canvas: sample from world tile under cursor
                                    const info = this._tilemap.getTileRenderInfo(this.cursor.x, this.cursor.y);
                                    if (info && info.sheet) {
                                        try {
                                            const ts = info.sheet;
                                            const slice2 = ts.slicePx || 16;
                                            let row = 0, col = 0;
                                            const tk = info.tileKey;
                                            if (Array.isArray(tk)) { row = tk[0]; col = tk[1]; }
                                            else if (typeof tk === 'string' && typeof ts.getTile === 'function') {
                                                const meta = ts.getTile(tk);
                                                if (meta) { row = meta.row; col = meta.col; }
                                            }
                                            // compute pixel coords inside tile
                                            const drawCtx = this.Draw.ctx;
                                            let origin = new Vector(0,0);
                                            if (drawCtx) {
                                                const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
                                                const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
                                                const center = new Vector(uiW/2, uiH/2);
                                                origin = this.zoomOrigin ? this.zoomOrigin : center;
                                            }
                                            const worldPos = this.mouse.pos.sub(origin).div(this.zoom).add(origin);
                                            const local = worldPos.sub(this.levelOffset);
                                            const withinTileX = local.x - (this.cursor.x * this.tileSize);
                                            const withinTileY = local.y - (this.cursor.y * this.tileSize);
                                            const px = Math.floor((withinTileX / this.tileSize) * slice2);
                                            const py = Math.floor((withinTileY / this.tileSize) * slice2);
                                            if (px >= 0 && py >= 0 && px < slice2 && py < slice2) {
                                                const tmp = document.createElement('canvas');
                                                tmp.width = slice2; tmp.height = slice2;
                                                const tctx = tmp.getContext('2d');
                                                try {
                                                    tctx.clearRect(0,0,slice2,slice2);
                                                    tctx.drawImage(ts.sheet, col * slice2, row * slice2, slice2, slice2, 0, 0, slice2, slice2);
                                                    const d = tctx.getImageData(px, py, 1, 1).data;
                                                    this.editColor = new Color(d[0], d[1], d[2], (d[3]||255)/255, 'rgb');
                                                    this.eyedropActive = false;
                                                    this.rotDelay = this.rotSetDelay;
                                                    this._uiHandled = true;
                                                } catch (e) { /* ignore */ }
                                            }
                                        } catch (e) { /* ignore */ }
                                    }
                                }
                            } else {
                                // no edit canvas: sample from world tile under cursor (same as above)
                                const info = this._tilemap.getTileRenderInfo(this.cursor.x, this.cursor.y);
                                if (info && info.sheet) {
                                    try {
                                        const ts = info.sheet;
                                        const slice2 = ts.slicePx || 16;
                                        let row = 0, col = 0;
                                        const tk = info.tileKey;
                                        if (Array.isArray(tk)) { row = tk[0]; col = tk[1]; }
                                        else if (typeof tk === 'string' && typeof ts.getTile === 'function') {
                                            const meta = ts.getTile(tk);
                                            if (meta) { row = meta.row; col = meta.col; }
                                        }
                                        const drawCtx = this.Draw.ctx;
                                        let origin = new Vector(0,0);
                                        if (drawCtx) {
                                            const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
                                            const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
                                            const center = new Vector(uiW/2, uiH/2);
                                            origin = this.zoomOrigin ? this.zoomOrigin : center;
                                        }
                                        const worldPos = this.mouse.pos.sub(origin).div(this.zoom).add(origin);
                                        const local = worldPos.sub(this.levelOffset);
                                        const withinTileX = local.x - (this.cursor.x * this.tileSize);
                                        const withinTileY = local.y - (this.cursor.y * this.tileSize);
                                        const px = Math.floor((withinTileX / this.tileSize) * slice2);
                                        const py = Math.floor((withinTileY / this.tileSize) * slice2);
                                        if (px >= 0 && py >= 0 && px < slice2 && py < slice2) {
                                            const tmp = document.createElement('canvas');
                                            tmp.width = slice2; tmp.height = slice2;
                                            const tctx = tmp.getContext('2d');
                                            try {
                                                tctx.clearRect(0,0,slice2,slice2);
                                                tctx.drawImage(ts.sheet, col * slice2, row * slice2, slice2, slice2, 0, 0, slice2, slice2);
                                                const d = tctx.getImageData(px, py, 1, 1).data;
                                                this.editColor = new Color(d[0], d[1], d[2], (d[3]||255)/255, 'rgb');
                                                this.eyedropActive = false;
                                                this.rotDelay = this.rotSetDelay;
                                                this._uiHandled = true;
                                            } catch (e) { /* ignore */ }
                                        }
                                    } catch (e) { /* ignore */ }
                                }
                            }
                        } catch (e) { /* ignore eyedrop sampling errors */ }
                    } else {
                        // copy tile at cursor
                        const info = this._tilemap.getTileRenderInfo(this.cursor.x, this.cursor.y);
                        if (info) {
                            this.drawType = info.tileKey;
                            // set drawSheet to the sheet where tile came from
                            this.drawSheet = info.tilesheetId || info.tilesheet || this.drawSheet;
                            this.drawRot = info.rotation ?? 0;
                            // if tiles include invert flag, use it; otherwise keep current
                            this.drawInvert = info.invert ?? this.drawInvert;
                        }
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
        // Reset UI handled flag when left button released so next click works
        try {
            if (this.mouse.released('left')) this._uiHandled = false;
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

        
        this.drawTilemap()
        
        // draw preview of the tile under the cursor (on world layer) when not over palette
        if(this.mouse.pos.x < 1920 - this.uiMenu.menuWidth){
            const previewSheet = this._tilemap.getTileSheet(this.drawSheet || 'house');
            if(!this.editmode){
                if(!this.keys.held('Shift')){
                    this.Draw.tile(previewSheet, (new Vector(this.cursor.x * this.tileSize, this.cursor.y * this.tileSize)).addS(this.levelOffset), new Vector(this.tileSize, this.tileSize), this.drawType, this.drawRot, new Vector(this.drawInvert,1), 1);
                }
                this.Draw.rect(this.cursor.mult(this.tileSize).add(this.levelOffset), new Vector(this.tileSize, this.tileSize), '#FFFFFF44')
            }
                this.Draw.rect(this.cursor.mult(this.tileSize).add(this.levelOffset), new Vector(this.tileSize, this.tileSize), '#907f7f44',false,true,2,'#ffffff88')
            
        }

        // draw selection rectangle for any selected placed tile
        try {
            if (this.selectedTile) {
                const sx = this.selectedTile.x * this.tileSize;
                const sy = this.selectedTile.y * this.tileSize;
                this.Draw.rect(new Vector(sx, sy).addS(this.levelOffset), new Vector(this.tileSize, this.tileSize), '#00000000', false, true, 3, this.selectionColor);
            }
        } catch (e) { /* ignore selection draw errors */ }

        // draw a mini pixel cursor on the world view when editing a selected tile
        try {
            if (this.editmode && this.selectedTile) {
                const info = this.selectedTile.info;
                if (info && info.sheet) {
                    const ts = info.sheet;
                    const slice = ts.slicePx || 16;

                    // compute world-space mouse -> pixel within the selected tile
                    const drawCtx = this.Draw.ctx;
                    let origin = new Vector(0,0);
                    if (drawCtx) {
                        const uiW = drawCtx.canvas.width / this.Draw.Scale.x;
                        const uiH = drawCtx.canvas.height / this.Draw.Scale.y;
                        const center = new Vector(uiW/2, uiH/2);
                        origin = this.zoomOrigin ? this.zoomOrigin : center;
                    }
                    const worldPos = this.mouse.pos.sub(origin).div(this.zoom).add(origin);
                    const local = worldPos.sub(this.levelOffset);
                    const withinTileX = local.x - (this.selectedTile.x * this.tileSize);
                    const withinTileY = local.y - (this.selectedTile.y * this.tileSize);

                    const px = Math.floor((withinTileX / this.tileSize) * slice);
                    const py = Math.floor((withinTileY / this.tileSize) * slice);

                    if (px >= 0 && py >= 0 && px < slice && py < slice) {
                        const pixelWorldSize = this.tileSize / slice;
                        const pxWorld = this.selectedTile.x * this.tileSize + px * pixelWorldSize;
                        const pyWorld = this.selectedTile.y * this.tileSize + py * pixelWorldSize;
                        // draw a highlighted rectangle for the single pixel (stroke with a bright color)
                        this.Draw.rect(new Vector(pxWorld, pyWorld).addS(this.levelOffset), new Vector(pixelWorldSize, pixelWorldSize), '#00000000', false, true, 0.5, '#ffcc00ff');
                    }
                }
            }
        } catch (e) { /* ignore cursor draw errors */ }
        
        // UI drawing: overlays layer is cleared and used for UI elements
        this.UIDraw.useCtx('overlays')
        this.UIDraw.clear()
        this.testSprite.draw()
        // Draw left-side edit menu when edit mode is active (blank panel for now)
        try {
            if (this.editmode) {
                const ovCtx = this.UIDraw.getCtx('overlays');
                if (ovCtx) {
                    const uiW = ovCtx.canvas.width / this.UIDraw.Scale.x;
                    const uiH = ovCtx.canvas.height / this.UIDraw.Scale.y;
                    const w = this.editMenuWidth || 300;
                    const x = 8;
                    const y = 8;
                    // background panel
                    this.UIDraw.rect(new Vector(x, y), new Vector(w, uiH - 16), '#000000EE');
                    // header
                    this.UIDraw.text('Edit Mode', new Vector(x + 12, y + 22), '#FFFFFFFF', 0, 16, { align: 'left' });
                    // close button (simple X)
                    const bx = x + w - 28;
                    const by = y + 8;
                    const bw = 20;
                    const bh = 20;
                    this.UIDraw.rect(new Vector(bx, by), new Vector(bw, bh), '#FFFFFF11');
                    this.UIDraw.text('X', new Vector(bx + bw/2, by + bh/2 + 6), '#FFFFFFFF', 0, 14, { align: 'center' });
                    // color picker label
                    this.UIDraw.text('Color:', new Vector(x + 12, y + 40), '#FFFFFFFF', 0, 12, { align: 'left' });
                    // current color display + controls
                    try {
                        const dispX = x + 12;
                        // move action buttons down to avoid overlapping the edit canvas
                        const dispY = y + 36 + 350;
                        const dispW = 28;
                        const dispH = 28;
                        // current color swatch
                        try {
                            this.UIDraw.rect(new Vector(dispX, dispY), new Vector(dispW, dispH), this.editColor || '#FFFFFFFF');
                        } catch (e) {
                            this.UIDraw.rect(new Vector(dispX, dispY), new Vector(dispW, dispH), (this.editColor && this.editColor.toHex) ? this.editColor.toHex().slice(0,7) : '#FFFFFF');
                        }
                        // Choose Color button
                        const chooseX = dispX + dispW + 8;
                        const chooseY = dispY;
                        const chooseW = 100;
                        const chooseH = 28;
                        this.UIDraw.rect(new Vector(chooseX, chooseY), new Vector(chooseW, chooseH), '#FFFFFF11');
                        this.UIDraw.text('Choose Color', new Vector(chooseX + chooseW/2, chooseY + chooseH/2 + 6), '#FFFFFFFF', 0, 12, { align: 'center' });
                        // Eyedropper button
                        const dropX = chooseX + chooseW + 8;
                        const dropY = chooseY;
                        const dropW = 90;
                        const dropH = 28;
                        const dropCol = this.eyedropActive ? '#FFAA00FF' : '#FFFFFF11';
                        this.UIDraw.rect(new Vector(dropX, dropY), new Vector(dropW, dropH), dropCol);
                        this.UIDraw.text('Eyedropper', new Vector(dropX + dropW/2, dropY + dropH/2 + 6), '#FFFFFFFF', 0, 12, { align: 'center' });
                    } catch (e) { /* ignore control draw errors */ }
                    // draw color swatches
                    try {
                        const swatchSize = 20;
                        const swatchSpacing = 8;
                        const swatchCols = 10;
                        const swStartX = x + 12;
                        // shift swatches down to avoid overlapping the edit canvas
                        const swStartY = y + 36 + 300;
                        const colors = Array.isArray(this.editPaletteColors) ? this.editPaletteColors : [this.editColor || Color.convertColor('#FFFFFFFF')];
                        for (let i = 0; i < colors.length; i++) {
                            const col = i % swatchCols;
                            const row = Math.floor(i / swatchCols);
                            const sx = swStartX + col * (swatchSize + swatchSpacing);
                            const sy = swStartY + row * (swatchSize + swatchSpacing);
                            // UIDraw supports Color instances directly
                            try {
                                this.UIDraw.rect(new Vector(sx, sy), new Vector(swatchSize, swatchSize), colors[i]);
                            } catch (e) {
                                // fallback to hex string
                                this.UIDraw.rect(new Vector(sx, sy), new Vector(swatchSize, swatchSize), (colors[i] && typeof colors[i].toHex === 'function') ? colors[i].toHex() : (colors[i] || '#FFFFFFFF'));
                            }
                            // highlight selected color by comparing hex representation
                            try {
                                const isSel = this.editColor && (this.editColor.toHex() === (colors[i] && colors[i].toHex && colors[i].toHex()));
                                if (isSel) {
                                    this.UIDraw.rect(new Vector(sx, sy), new Vector(swatchSize, swatchSize), '#00000000', false, true, 2, '#FFFFFFFF');
                                } else {
                                    this.UIDraw.rect(new Vector(sx, sy), new Vector(swatchSize, swatchSize), '#00000000', false, true, 1, '#FFFFFF33');
                                }
                            } catch (e) {
                                this.UIDraw.rect(new Vector(sx, sy), new Vector(swatchSize, swatchSize), '#00000000', false, true, 1, '#FFFFFF33');
                            }
                        }
                    } catch (e) { /* ignore swatch draw errors */ }
                    // create-new-tile button near bottom of panel
                    const btnW = w - 24;
                    const btnH = 36;
                    const btnX = x + 12;
                    const btnY = y + uiH - 56;
                    this.UIDraw.rect(new Vector(btnX, btnY), new Vector(btnW, btnH), '#FFFFFF11');
                    this.UIDraw.text('Create New Tile', new Vector(btnX + btnW/2, btnY + btnH/2 + 6), '#FFFFFFFF', 0, 16, { align: 'center' });
                    // draw the editable tile canvas scaled up
                    try {
                        if (this.editTileCanvas) {
                            const slice = this.editTileCanvas.width;
                            const zoom = this.editTileZoom || Math.max(4, Math.floor((w - 40) / slice));
                            const imgX = x + 12;
                            const imgY = y + 48;
                            const size = new Vector(slice * zoom, slice * zoom);
                            this.UIDraw.image(this.editTileCanvas, new Vector(imgX, imgY), size, null, 0, 1, false);
                            // draw pixel grid lines
                            for (let gx = 0; gx <= slice; gx++) {
                                const px = imgX + gx * zoom;
                                this.UIDraw.line(new Vector(px, imgY), new Vector(px, imgY + slice * zoom), '#FFFFFF22', 1);
                            }
                            for (let gy = 0; gy <= slice; gy++) {
                                const py = imgY + gy * zoom;
                                this.UIDraw.line(new Vector(imgX, py), new Vector(imgX + slice * zoom, py), '#FFFFFF22', 1);
                            }
                        }
                    } catch (e) { /* ignore edit-canvas draw errors */ }
                }
            }
        } catch (e) { /* ignore overlay draw errors */ }
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

                // draw each tile option in a grid (supports multiple sheets)
                const cols = Math.max(1, Math.floor((m.menuWidth - 16 + m.spacing) / (m.itemSize + m.spacing)));
                for (let i = 0; i < this.tileTypes.length; i++) {
                    const ty = this.tileTypes[i];
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    const xPos = menuX + 8 + col * (m.itemSize + m.spacing);
                    const yPos = menuY + 8 + row * (m.itemSize + m.spacing);
                    // item background
                    this.UIDraw.rect(new Vector(xPos, yPos), new Vector(m.itemSize, m.itemSize), '#FFFFFF11');
                    // highlight selection
                    if (this.drawType && Array.isArray(this.drawType) && ty && this.drawSheet && ty.sheetId === this.drawSheet && this.drawType[0] === ty.row && this.drawType[1] === ty.col) {
                        this.UIDraw.rect(new Vector(xPos, yPos), new Vector(m.itemSize, m.itemSize), '#00000000', false, true, 3, '#FFFFFF88');
                    }
                    // draw tile icon centered inside item
                    const centerX = xPos + m.itemSize / 2;
                    const centerY = yPos + m.itemSize / 2;
                    try {
                        const sheetObj = this._tilemap.getTileSheet(ty.sheetId);
                        this.UIDraw.tile(sheetObj, new Vector(centerX-24, centerY-24), new Vector(m.itemSize, m.itemSize), [ty.row, ty.col], this.drawRot, new Vector(this.drawInvert,1), 1, false);
                    } catch (e) { /* ignore drawing errors for individual tiles */ }
                }
                // draw Save / Load buttons below the grid
                try {
                    const rowsUsed = Math.ceil(this.tileTypes.length / cols);
                    const gridH = rowsUsed * (m.itemSize + m.spacing) - m.spacing;
                    const btnX = menuX + 8;
                    const btnW = m.menuWidth - 16;
                    const btnH = 28;
                    const btnYStart = menuY + 8 + gridH + m.spacing;
                        // Export Tilesheets
                        this.UIDraw.rect(new Vector(btnX, btnYStart), new Vector(btnW, btnH), '#FFFFFF11');
                        this.UIDraw.text('Export Tilesheets', new Vector(btnX + btnW / 2, btnYStart + btnH / 2 + 6), '#FFFFFFFF', 0, 14, { align: 'center' });
                        // Import Tilesheets
                        this.UIDraw.rect(new Vector(btnX, btnYStart + btnH + m.spacing), new Vector(btnW, btnH), '#FFFFFF11');
                        this.UIDraw.text('Import Tilesheets', new Vector(btnX + btnW / 2, btnYStart + btnH + m.spacing + btnH / 2 + 6), '#FFFFFFFF', 0, 14, { align: 'center' });
                        // (old Save/Load buttons removed — Export/Import replace them)
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
