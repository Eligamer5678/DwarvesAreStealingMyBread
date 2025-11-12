import Vector from '../Vector.js';

/**
 * BufferedSegment: a line segment with a variable buffer radius.
 * Rendering with a round-capped thick line approximates a capsule around the segment.
 */
export default class BufferedSegment {
    /**
     * @param {Vector} a - start point (world units)
     * @param {Vector} b - end point (world units)
     * @param {number} baseRadius - base buffer radius in pixels (world units)
     * @param {{kv?:number, ka?:number}} [coeffs] - weight factors for velocity/accel
     */
    constructor(a, b, baseRadius = 12, coeffs = {}){
        this.a = a.clone();
        this.b = b.clone();
        // baseRadius is the MAX radius; it shrinks with velocity/accel down to minRadius
        this.baseRadius = baseRadius;
        this.kv = coeffs.kv ?? 0.25; // velocity influence
        this.ka = coeffs.ka ?? 0.05; // acceleration influence
        this.minRadius = (coeffs.min ?? coeffs.minRadius) ?? 5; // absolute minimum
        this.currentRadius = baseRadius;
    }

    updateBuffer(velMag = 0, accelMag = 0){
        return this.currentRadius;
    }

    /** Normalized direction from a to b */
    dir(){ return this.b.sub(this.a).normalize(); }
    /** Perpendicular left normal (unit) */
    normal(){ const d = this.dir(); return new Vector(-d.y, d.x); }

    /** Draw the capsule buffer using a round-capped line of width 2*radius. */
    drawBuffer(Draw, color = '#44AAFF88'){
        const r = this.currentRadius;
        const width = 2 * r;
        try { Draw.line(this.a, this.b, color, width, false, 'round'); } catch (e) {}
    }

    /** Optional: draw center line and normals for debugging */
    drawDebug(Draw){
        try { Draw.line(this.a, this.b, '#FFFFFFAA', 2, false, 'butt'); } catch (e) {}
        // draw small normal ticks every ~64px along segment
        try {
            const ab = this.b.sub(this.a); const len = ab.mag();
            if (len <= 1e-3) return;
            const step = 64; const n = Math.max(1, Math.floor(len / step));
            const d = ab.normalize(); const nrm = new Vector(-d.y, d.x);
            for (let i=1;i<n;i++){
                const p = this.a.add(d.mult(i * step));
                const q = p.add(nrm.mult(this.currentRadius * 0.5));
                Draw.line(p, q, '#FFFF00AA', 2);
            }
        } catch (e) {}
    }

    /**
     * Test collision against a circle (e.g., the Cat). Returns penetration and normal.
     * Normal points from the segment/capsule toward the circle center.
     * @param {Vector} center Circle center (world)
     * @param {number} radius Circle radius
     * @returns {{collides:boolean, penetration:number, normal:Vector, closestPoint:Vector, t:number}}
     */
    collideCircle(center, radius){
        const a = this.a, b = this.b;
        const ab = b.sub(a);
        const abLenSq = Math.max(1e-9, ab.x*ab.x + ab.y*ab.y);
        const ac = center.sub(a);
        // project AC onto AB to get param t along the segment
        let t = (ac.x*ab.x + ac.y*ab.y) / abLenSq;
        t = Math.max(0, Math.min(1, t));
        const closest = new Vector(a.x + ab.x * t, a.y + ab.y * t);
        const delta = center.sub(closest);
        const dist = delta.mag();
        const totalR = this.currentRadius + radius;
        if (dist <= totalR) {
            // compute normal; handle degenerate case where center lies exactly on the capsule surface
            let n;
            if (dist > 1e-6) {
                n = delta.div(dist); // from capsule to circle center
            } else {
                // choose a stable normal when center is exactly on the axis
                const d = this.dir();
                // perpendicular normal, pick side using sign from (center-a) dot perp
                const perp = new Vector(-d.y, d.x);
                const s = Math.sign(perp.dot(center.sub(a))) || 1;
                n = perp.mult(s);
            }
            return {
                collides: true,
                penetration: totalR - dist,
                normal: n,
                closestPoint: closest,
                t
            };
        }
        return { collides: false, penetration: 0, normal: new Vector(0,0), closestPoint: new Vector(0,0), t };
    }
}
