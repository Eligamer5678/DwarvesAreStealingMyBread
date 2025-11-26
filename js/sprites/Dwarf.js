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
     * @param {SpriteSheetType|null} [spriteSheet=null] - Animation Spritesheet 
     * @param {DwarfInputSettings|Object} [inputSettings={type:'platformer'}] - Input settings or an Input instance
     */
    constructor(keys, Draw, pos, size = new Vector(48,48), spriteSheet = null, inputSettings = { type: 'platformer' }){
        super(keys, Draw, pos, size, spriteSheet, inputSettings);
        this.speed = 50;
        this.friction = 0.001;

        // Platformer physics
        this.gravity = 30; // px/s^2 downward
        this.terminal = 100; // max fall speed (px/s)
        this.jumpSpeed = 7; // initial jump impulse (px/s)
        this.onGround = false; // set by scene collision resolution
        this.onLadder = false; // set by scene when overlapping ladder
        this.climbSpeed = 4; // px/s climb speed when on ladder (slower)
        this.mining = false;
        // Tool state (can be changed at runtime). `speed` scales mining time (1.0 = normal).
        this.currentTool = { type: 'pickaxe', speed: 1.0 };

        // Wire jump input (Input.onJump emits when jump key pressed)
        if (this.input && this.input.onJump && typeof this.input.onJump.connect === 'function') {
            this.input.onJump.connect((k) => {
                if (this.onGround) {
                    this.vlos.y = -this.jumpSpeed;
                    this.onGround = false;
                }
            });
        }
    }

    update(delta){
        // base sprite update handles horizontal input and friction
        super.update(delta);

        // Ladder climbing: when on a ladder, gravity is suspended and vertical
        // movement is controlled by input.y (this.inputDir.y). Otherwise, apply gravity.
        if (this.onLadder) {
            // prefer environment input for vertical control when on ladder
            const env = (this.envInputDir && typeof this.envInputDir.y === 'number') ? this.envInputDir.y : (this.inputDir && typeof this.inputDir.y === 'number' ? this.inputDir.y : 0);
            // input: -1 up, +1 down
            this.vlos.y = env * this.climbSpeed;
            this.onGround = false;
        } else {
            // apply gravity (downwards positive)
            this.vlos.y += this.gravity * delta;
            if (this.vlos.y > this.terminal) this.vlos.y = this.terminal;
        }

        
        // Facing: set invert to -1 when moving left, 1 when moving right.
        if ((this.vlos.x || 0) < -0.01) this.invert.x = -1;
        else if ((this.vlos.x || 0) > 0.01) this.invert.x = 1;
        this.updateAnimation()
        
    }
    updateAnimation(){
        // Animation & facing: switch to 'walk' when moving horizontally,
        // otherwise 'idle'. Reset frame when animation changes.
        const moveSpeed = Math.abs(this.vlos.x || 0);
        const walkThreshold = 0.1; // px/s threshold to consider 'walking'
        if (this.mining) {this.sheet.playAnimation('mine'); return;}
        if (moveSpeed > walkThreshold) {
            if(this.keys.held(' ')) {
                if(this.input.isHeld('up')) {this.sheet.playAnimation('walk_and_hold_pick'); return;}
                this.sheet.playAnimation('walk_and_hold_pick_as_sheild');
                return;
            }
            this.sheet.playAnimation('walk');
            return;
        }
        this.sheet.playAnimation('idle');
    }
}
