    
import Scene from './Scene.js';
import Vector from '../js/Vector.js';

import { perlinNoise } from '../js/noiseGen.js';
import Camera from '../js/Camera.js';

export class MainScene extends Scene {
    constructor(...args) {
        super('main', ...args);
        this.loaded = 0;
        this.playerCount = 1;
        this.defaultSaveData = {
            'settings':{
                'volume': {

                },
                'colors':{

                },
            },
            'game':{

            }
        }
        this.settings = this.defaultSaveData.settings;
        this.elements = new Map()
    }

    onReady() {
        // Camera: handles zoom/offset, input and keyframes
        this.camera = new Camera(this.Draw, this.mouse, {
            minZoom: 0.25,
            maxZoom: 16,
            zoomSmooth: 8,
            zoomImpulse: 12,
            zoomStep: -0.001,
            panSmooth: 8,
            panImpulse: 1.0
        });


        // Generate a small test noise map for debugging/visual testing
        // width/height chosen small to keep render cost low
        this.noiseMap = perlinNoise(64, 64, { scale: 24, octaves: 4, seed: 1337, normalize: true });
        this.noiseTileSize = 8; // world units per noise sample

        this.isReady = true;
    }

    
    sceneTick(tickDelta) {
        this.mouse.update(tickDelta)
        this.keys.update(tickDelta)
        this.mouse.setMask(0)
        // Do UI here

        this.mouse.setPower(0)

        // Space key: play demo keyframes
        if (this.keys && this.keys.released && this.keys.released(' ')) {
            const curOff = this.camera.offset.clone();
            // Zoom in
            this.camera.addKeyframe({ zoom: new Vector(2, 2) }, 0.6);
            // Pan a bit
            this.camera.addKeyframe({ offset: curOff.add(new Vector(-80, -40)) }, 0.8);
            // Return to default
            this.camera.addKeyframe({ zoom: new Vector(1, 1), offset: new Vector(0, 0) }, 1.0);
        }

        // Let camera handle input and integration
        this.camera.handleInput(tickDelta);
        this.camera.update(tickDelta);
    }

    draw() {
        if (!this.isReady) return;
        // Background
        this.Draw.background('#000000');
        this.Draw.useCtx('base');

        // World transform (use camera)
        this.camera.applyTransform();

        // Render noise map as grayscale tiles (for quick testing)
        if (this.noiseMap) {
            const w = this.noiseMap.width;
            const h = this.noiseMap.height;
            const data = this.noiseMap.data;
            const ts = this.noiseTileSize || 4;
            for (let yy = 0; yy < h; yy++) {
                for (let xx = 0; xx < w; xx++) {
                    const v = data[yy * w + xx];
                    const c = Math.max(0, Math.min(255, Math.floor(v * 255)));
                    this.Draw.rect(new Vector(xx * ts, yy * ts), new Vector(ts, ts), `rgb(${c},${c},${c})`);
                }
            }
        } else {
            this.Draw.rect(new Vector(50,50),new Vector(50,50),'#FF0000')
        }

        this.camera.popTransform();
    }
}

