import Sprite from './Sprite.js';
import Vector from '../Vector.js';
import Timer from '../Timer.js';

/**
 * @typedef {Object} DwarfInputSettings
 * @property {string} [type] - Input controller type (e.g. 'platformer').
 * @property {boolean} [normalizeDiagonal] - Normalize diagonal movement.
 * @property {string[]} [jumpKeys] - Keys used for jump actions.
 * @property {number} [deadzone] - Deadzone for analog inputs.
 */

/**
 * @typedef {import('../Spritesheet.js').default} SpriteSheetType
 * @typedef {import('../Vector.js').default} VectorType
 * @typedef {import('../Keys.js').default} KeysType
 * @typedef {import('../Draw.js').default} DrawType
 */

/** Dwarf sprite */
export default class Dwarf extends Sprite {
    /**
     * Create a Dwarf player sprite.
     * @param {KeysType} keys - Keys helper instance (optional; pass null to skip input controller)
     * @param {DrawType} Draw - Draw helper used for rendering
     * @param {VectorType} pos - Top-left world position for the sprite
     * @param {VectorType} [size=new Vector(48,48)] - Draw size (in world pixels)
     * @param {SpriteSheetType|null} [spriteSheet=null] - Optional spritesheet for animations
     * @param {DwarfInputSettings|Object} [inputSettings={type:'platformer'}] - Input settings or an Input instance
     */
    constructor(keys, Draw, pos, size = new Vector(48,48), spriteSheet = null, inputSettings = { type: 'platformer' }){
        super(keys, Draw, pos, size, spriteSheet, inputSettings);
        this.speed = 140;
        this.friction = 0.0009;
        this.animFps = 8;
        if (this.sheet && this.sheet.animations) {
            const keysArr = Array.from(this.sheet.animations.keys());
            this.anim = keysArr.length ? keysArr[0] : 'idle';
        } else {
            this.anim = 'idle';
        }
        // reuse parent's animTimer but adjust fps
        try {
            if (this.animTimer) {
                this.animTimer.stop();
            }
            this.animTimer = new Timer('loop', 1 / this.animFps);
            this.animTimer.onLoop.connect(()=>{ this.animFrame += 1; });
            this.animTimer.start();
        } catch (e) {}
    }
}
