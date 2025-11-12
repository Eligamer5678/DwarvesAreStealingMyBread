import Vector from '../Vector.js';
import BufferedSegment from './BufferedSegment.js';

/**
 * BufferedPolygon: edge-only collision using a ring of BufferedSegments.
 * No interior tests; collision is the union of edge capsules.
 */
export default class BufferedPolygon {
    /**
     * @param {Vector[]} vertices - ordered vertices; last will connect to first
     * @param {number} baseRadius - max buffer radius for each edge
     * @param {{kv?:number, ka?:number, min?:number, minRadius?:number}} [coeffs]
     */
    constructor(vertices = [], baseRadius = 12, coeffs = {}){
        this.vertices = (vertices || []).map(v => v.clone());
        this.baseRadius = baseRadius;
        this.coeffs = coeffs || {};
        this.edges = [];
        this._buildEdges();
    }

    setVertices(vertices){
        this.vertices = (vertices || []).map(v => v.clone());
        this._buildEdges();
    }

    _buildEdges(){
        this.edges = [];
        const n = this.vertices.length;
        if (n < 2) return;
        for (let i = 0; i < n; i++) {
            const a = this.vertices[i];
            const b = this.vertices[(i+1)%n];
            this.edges.push(new BufferedSegment(a, b, this.baseRadius, this.coeffs));
        }
    }

    updateBuffer(velMag = 0, accelMag = 0){
        for (const e of this.edges) e.updateBuffer(velMag, accelMag);
    }

    drawBuffer(Draw, color = '#44AAFF66'){
        for (const e of this.edges) e.drawBuffer(Draw, color);
    }

    drawDebug(Draw){
        // outline
        try {
            for (const e of this.edges) e.drawDebug(Draw);
        } catch (e) {}
    }

    /**
     * Collide a circle against all edge capsules; returns the deepest hit.
     * @returns {{collides:boolean, penetration:number, normal:Vector, closestPoint:Vector, edgeIdx:number}|{collides:false}}
     */
    collideCircle(center, radius){
        let best = null; let bestPen = 0; let bestIdx = -1;
        for (let i=0;i<this.edges.length;i++){
            const hit = this.edges[i].collideCircle(center, radius);
            if (hit && hit.collides && hit.penetration > bestPen) {
                best = hit; bestPen = hit.penetration; bestIdx = i;
            }
        }
        if (best) return { ...best, edgeIdx: bestIdx };
        return { collides: false };
    }
}
