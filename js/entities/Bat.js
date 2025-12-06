import Sprite from '../sprites/Sprite.js';
import Vector from '../modules/Vector.js';
import AerialPathfindComponent from '../components/AerialPathfindComponent.js';

export default class Bat extends Sprite {
    constructor(Draw, pos = new Vector(0,0), size = new Vector(16,16), sheet = null, options = {}){
        super(null, Draw, pos, size, sheet, null);
        const opts = Object.assign({}, options || {});
        // default to lower speeds (map uses smaller tiles); scale down by ~8x
        const compOpts = Object.assign({
            flightSpeed: opts.flightSpeed || 1.0,
            pathRecalc: opts.pathRecalc || 0.6,
            attackRange: opts.attackRange || 30,
            attackCooldown: opts.attackCooldown || 2.0,
            lungeSpeed: opts.lungeSpeed || 3
        }, opts);

        this.components = this.components || [];
        this._aerial = new AerialPathfindComponent(compOpts);
        this.components.push(this._aerial);

        // keep a per-entity spritesheet connection to avoid shared updates
        try { if (this.sheet && typeof this.sheet.connect === 'function') this.sheet = this.sheet.connect(); } catch(e){}

        // carry scene reference so component can access chunkManager/player
        if (opts.scene) this.scene = opts.scene;
        // Randomly shrink the bat to give variety
        try {
            const scale = 0.4 + Math.random() * 0.4; // 0.4 - 0.8
            if (this.size && typeof this.size.mult === 'function') this.size = this.size.mult(scale);
        } catch (e) {}
        // set initial animation
        try { if (this.sheet && typeof this.sheet.playAnimation === 'function') this.sheet.playAnimation('fly', true); } catch(e){}
    }

    draw(levelOffset) {
        super.draw(levelOffset);
        try {
            if (this.scene && this.scene.debugBatPaths) {
                const ts = this.scene.noiseTileSize || 16;
                // draw path nodes as connected lines
                const p = this._aerial && this._aerial.path ? this._aerial.path : null;
                const startIdx = this._aerial && typeof this._aerial.pathIdx === 'number' ? this._aerial.pathIdx : 0;
                if (p && p.length) {
                    let prev = this.pos.add(this.size.mult(0.5));
                    for (let i = startIdx; i < p.length; i++) {
                        const node = p[i];
                        const nx = node.x * ts + ts * 0.5;
                        const ny = node.y * ts + ts * 0.5;
                        const next = new Vector(nx, ny);
                        this.Draw.line(prev, next, 'rgba(255, 179, 0, 0.3)', 1);
                        prev = next;
                    }
                }
                // draw roam target
                const rt = this._aerial && this._aerial.roamTarget ? this._aerial.roamTarget : null;
                if (rt) {
                    const cx = rt.x * ts + ts * 0.5;
                    const cy = rt.y * ts + ts * 0.5;
                    this.Draw.circle(new Vector(cx, cy), Math.max(2, ts * 0.2), 'rgba(255,0,0,0.3)', true);
                    this.Draw.circle(new Vector(cx, cy), Math.max(2, ts * 0.2), 'rgba(255,255,255,0.3)', false, 2);
                }
                // draw attack line to player when swooping
                try {
                    if (this._aerial.state === 'windup' && this.scene && this.scene.player) {
                        const playerCenter = this.scene.player.pos.add(this.scene.player.size.mult(0.5));
                        const meCenter = this.pos.add(this.size.mult(0.5));
                        this.Draw.line(meCenter, playerCenter, 'rgba(255,0,0,0.5)', 1);
                    }
                } catch (e) { }
            }
        } catch (e) { /* ignore debug draw errors */ }
    }
}
