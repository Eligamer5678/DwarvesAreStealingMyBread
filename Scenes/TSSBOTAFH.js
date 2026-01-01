import Scene from './Scene.js';
import Vector from '../js/modules/Vector.js';
import { v } from '../js/modules/Vector.js';
import SpriteSheet from '../js/modules/Spritesheet.js';
import Timer from '../js/modules/Timer.js';
import Geometry from '../js/modules/Geometry.js';

export class TSSBOTAFHScene extends Scene {
    constructor(...args) {
        super('TSSBOTAFH', ...args);
        this.loaded = 0;
        this.elements = new Map();
        this.isPreloaded = false;
        this.isReady = false;

        // Simple mini-game state
        this.eggs = [];
        this.score = 0;
        this.missed = 0;
        this.gameOver = false;
        
        this.player = {'size':v(140,24),'pos':v(960,1000)}
        this.spawnTimer = new Timer("loop",0.5)
    }
    
    /**
     * Preload assets. The new component/asset loader will wire JSON driven assets
     * into this.SpriteImages; keep a permissive loader so we can attach resources
     * from the JSON loader when ready.
    */
   async onPreload(resources = null) {
       try {
            // Create an egg sprite
            let eggImg = new Image();
            eggImg.src = 'Assets/minigames/egg_game/egg.png';
            let eggSheet = new SpriteSheet(eggImg,16,null)
            eggSheet.addAnimation('explode',11,4,8,0,"stop")
            eggSheet.addAnimation('default',0,4,0,0,"swapTo",'explode')
            
            this.Sprites = new Map()
            this.Sprites.set('egg',eggSheet)
            
            this.isPreloaded = true;
            return true;
        } catch (err) {
            console.error('MainScene preload failed:', err);
            return false;
        }
    }
    
    onReady() {
        if (this.isReady) return;
        this.resetGame();
        this.spawnTimer.onLoop.connect(()=>{
            this.spawnEgg();
        })
        this.spawnTimer.start()
        this.isReady = true;
    }

    resetGame() {
        this.eggs = [];
        this.score = 0;
        this.missed = 0;
        this.gameOver = false;
    }

    spawnEgg() {
        const r =32 + Math.random() * 20;
        this.eggs.push({
            'sheet':this.Sprites.get('egg'),
            'pos':v(40 + Math.random() * 1840,-30),
            'size':v(r,r),
            'vlos':v(0,100 + Math.random() * 50)
        });
    }

    sceneTick(tickDelta) {
        if (!this.isReady) return;

        // Basic input update (Scene.update already reset mask/power)
        this.mouse.setMask(0);
        this.mouse.update(tickDelta);
        this.keys.update(tickDelta);

        // Restart game with 'r' after game over
        if (this.gameOver && this.keys.released('r')) this.resetGame();

        // Player paddle follows mouse X (clamped to screen)
        this.player.pos.x = Math.max(this.player.size.x/2 * 0.5,Math.min(1920 - this.player.size.x/2, this.mouse.pos.x))-this.player.size.x/2;

        if (!this.gameOver) {
            // Spawn new eggs over time; speed up slightly as score increases
            const difficultyScale = Math.max(0.4, 0.9 - this.score * 0.03);
            this.spawnTimer.endTime = difficultyScale;
            this.spawnTimer.update(tickDelta)
        }
        for(let i = 0; i<this.eggs.length; i++){
            let egg = this.eggs[i]
            egg.pos.addS(v(egg.vlos.x*tickDelta,egg.vlos.y*tickDelta))
            if(Geometry.rectCollide(this.player.pos,this.player.size,egg.pos,egg.size)){
                this.eggs.splice(i,1)
            }
            if(egg.pos.y>1080) {this.missed+=1; this.eggs.splice(i,1)}
        }
        if(this.missed>3) this.gameOver = true;
    }
    draw() {
        if (!this.isReady) return;

        this.Draw.background('#1e2736ff');

        // Ground line
        this.Draw.line(v(0,1000),v(1920,1000),'#000',3)

        // Draw eggs
        for(let i = 0; i<this.eggs.length; i++){
            let egg = this.eggs[i]
            this.Draw.sheet(egg.sheet,egg.pos,egg.size,egg.sheet.currentAnimation,egg.sheet.currentFrame)
        }

        // Draw paddle
        this.Draw.rect(this.player.pos,this.player.size,'#fff');

        // UI layer (score + status text)
        this.UIDraw.clear();
        const scoreText = `Score: ${this.score}`;
        const missText = `Misses: ${this.missed} / 3`;
        this.UIDraw.text(scoreText, new Vector(20, 24), '#ffff', 1, 28, { baseline: 'top' });
        this.UIDraw.text(missText, new Vector(20, 60), '#ffaaaa', 1, 22, { baseline: 'top' });

        if (this.gameOver) {
            const msg = 'Game Over';
            const sub = 'Press R to restart';
            const centerX = 1920 * 0.5;
            const centerY = 1080 * 0.35;
            this.UIDraw.text(msg, v(centerX, centerY), '#ffff', 2, 56, { align: 'center', baseline: 'middle' });
            this.UIDraw.text(sub, v(centerX, centerY + 60), '#ffff', 1, 26, { align: 'center', baseline: 'middle' });
        }
    }
}


