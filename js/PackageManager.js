import TileSheet from './Tilesheet.js';
import Vector from './Vector.js';

export default class PackageManager {
    constructor(tilemap, scene = null) {
        this._tilemap = tilemap;
        this.scene = scene;
    }

    // Create a tar archive Blob from entries: [{name, uint8Array}]
    async createTarBlob(entries){
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
            const sizeOct = size.toString(8).padStart(11,'0') + '\0';
            writeString(header, 124, sizeOct, 12);
            const mtimeOct = Math.floor(Date.now()/1000).toString(8).padStart(11,'0') + '\0';
            writeString(header, 136, mtimeOct, 12);
            for (let i=148;i<156;i++) header[i]=32;
            header[156]=48;
            writeString(header, 257, 'ustar\0', 6);
            writeString(header, 263, '00', 2);
            let sum = 0;
            for (let i=0;i<512;i++) sum += header[i];
            const chks = sum.toString(8).padStart(6,'0') + '\0 ';
            writeString(header, 148, chks, 8);

            parts.push(header);
            parts.push(data);
            const pad = (512 - (size % 512)) % 512;
            if (pad>0) parts.push(new Uint8Array(pad));
        }
        parts.push(new Uint8Array(512));
        parts.push(new Uint8Array(512));
        return new Blob(parts, { type: 'application/x-tar' });
    }

    // Export tilemap + tilesheets as tar
    async exportAsTarFile(filename = 'tilesheets.tar', mapPayload = null){
        try {
            const sheets = [];
            const entries = [];
            for (const [id, ts] of this._tilemap.tileSheets.entries()) {
                let tilesObj = {};
                try {
                    if (ts.tiles instanceof Map) {
                        for (const [k, v] of ts.tiles.entries()) tilesObj[k] = v;
                    } else if (ts.tiles) {
                        tilesObj = ts.tiles;
                    }
                } catch (e) { tilesObj = {}; }

                try {
                    const img = ts.sheet;
                    if (img && img.width && img.height) {
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

            // include map payload if provided
            try {
                if (mapPayload) {
                    const mapJson = JSON.stringify(mapPayload, null, 2);
                    entries.push({ name: 'map.json', data: new TextEncoder().encode(mapJson) });
                }
            } catch (e) { /* ignore */ }

            const tarBlob = await this.createTarBlob(entries);
            const url = URL.createObjectURL(tarBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            return true;
        } catch (e) {
            console.warn('Export tilesheets tar failed:', e);
            return false;
        }
    }

    // Parse a tar into payloads
    async parseTarBuffer(arrayBuffer){
        try {
            const u = new Uint8Array(arrayBuffer);
            const entries = {};
            let offset = 0;
            while (offset + 512 <= u.length) {
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

            const keys = Object.keys(entries);
            const tsKey = keys.find(k => k.toLowerCase().endsWith('tilesheets.json'));
            if (!tsKey) return null;
            const jsonText = new TextDecoder().decode(entries[tsKey]);
            const payload = JSON.parse(jsonText);
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
            const mapKey = keys.find(k => k.toLowerCase().endsWith('map.json'));
            let mapPayload = null;
            if (mapKey && entries[mapKey]) {
                try { mapPayload = JSON.parse(new TextDecoder().decode(entries[mapKey])); } catch (e) { console.warn('Failed to parse map.json', e); }
            }
            return { sheetsPayload: payload, mapPayload };
        } catch (e) { console.warn('Failed to parse tar buffer', e); return null; }
    }

    // Import payload (register tilesheets into tilemap)
    async importSheetsPayload(payload){
        try {
            if (!payload || !Array.isArray(payload.sheets)) return false;
            for (const s of payload.sheets) {
                try {
                    const img = new Image();
                    const p = new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); });
                    img.src = s.imageData || s.url || '';
                    await p;
                    const ts = new TileSheet(img, s.slicePx || 16);
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
                    const id = s.id || ('sheet_' + Math.random().toString(36).slice(2,9));
                    this._tilemap.registerTileSheet(id, ts);
                } catch (e) { console.warn('Failed to apply tilesheet', s && s.id, e); }
            }
            return true;
        } catch (e) { console.warn('importSheetsPayload failed', e); return false; }
    }

    // Open file picker and import files (images, json, tar)
    async promptImportFiles(){
        return new Promise((resolve) => {
            try {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json,image/*,.tar,application/x-tar,application/tar';
                input.multiple = true;
                input.style.display = 'none';
                input.onchange = async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (!files.length) { resolve(false); return; }
                    const imageFiles = files.filter(f => f.type && f.type.startsWith('image'));
                    const jsonFiles = files.filter(f => f.type && (f.type === 'application/json' || f.name.toLowerCase().endsWith('.json')));
                    const tarFiles = files.filter(f => f.name.toLowerCase().endsWith('.tar') || f.type === 'application/x-tar');
                    let anyOk = false;
                    for (const f of imageFiles) {
                        try {
                            const dataUrl = await new Promise((res, rej) => {
                                const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('readFailed')); r.readAsDataURL(f);
                            });
                            const img = new Image();
                            const p = new Promise((res, rej) => { img.onload = () => res(true); img.onerror = () => res(false); });
                            img.src = dataUrl; await p;
                            let defaultSlice = 16;
                            try { const m = f.name.match(/(\d{2,3})/); if (m) defaultSlice = parseInt(m[1], 10); } catch (e) {}
                            const sliceStr = window.prompt(`Enter tile slice size (px) for ${f.name}:`, String(defaultSlice));
                            const slicePx = Math.max(1, Number(sliceStr) || defaultSlice);
                            const id = f.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, '_');
                            const ts = new TileSheet(img, slicePx);
                            try {
                                const cols = Math.max(1, Math.floor(img.width / slicePx));
                                const rows = Math.max(1, Math.floor(img.height / slicePx));
                                for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ts.addTile(`${r}_${c}`, r, c);
                            } catch (e) {}
                            this._tilemap.registerTileSheet(id, ts);
                            anyOk = true;
                        } catch (e) { console.warn('Failed to import image file as tilesheet', f.name, e); }
                    }
                    for (const f of jsonFiles) {
                        try {
                            const text = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('readFailed')); r.readAsText(f); });
                            const payload = JSON.parse(text);
                            const ok = await this.importSheetsPayload(payload);
                            anyOk = anyOk || ok;
                        } catch (e) { console.warn('Failed to import JSON tilesheet file', f.name, e); }
                    }
                    for (const f of tarFiles) {
                        try {
                            const arrayBuf = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('readFailed')); r.readAsArrayBuffer(f); });
                            const parsed = await this.parseTarBuffer(arrayBuf);
                            if (parsed && parsed.sheetsPayload) {
                                const ok = await this.importSheetsPayload(parsed.sheetsPayload);
                                anyOk = anyOk || ok;
                                if (parsed.mapPayload && this.scene && typeof this.scene.loadMapFromPayload === 'function') {
                                    try { this.scene.loadMapFromPayload(parsed.mapPayload); } catch (e) { console.warn('Failed to apply map payload', e); }
                                }
                            }
                        } catch (e) { console.warn('Failed to import tar tilesheet file', f.name, e); }
                    }
                    // refresh palette in scene if provided
                    if (this.scene) {
                        this.scene.tileTypes = [];
                        for (const [id, ts] of this._tilemap.tileSheets.entries()) {
                            try {
                                const img = ts.sheet; const cols = Math.max(1, Math.floor(img.width / ts.slicePx)); const rows = Math.max(1, Math.floor(img.height / ts.slicePx));
                                for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) this.scene.tileTypes.push({ sheetId: id, row: r, col: c });
                            } catch (e) { }
                        }
                    }
                    try { if (input && input.parentNode) document.body.removeChild(input); } catch (e) {}
                    resolve(anyOk);
                };
                document.body.appendChild(input);
                input.click();
                setTimeout(() => { try { input.remove(); } catch (e){} }, 3000);
            } catch (e) { console.warn('Import files failed:', e); resolve(false); }
        });
    }
}
