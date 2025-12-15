import ChunkManager from '../js/managers/ChunkManager.js';
import fs from 'fs';

(async ()=>{
  const cm = new ChunkManager({chunkSize:16, noiseTileSize:16});
  // load chunk specs/generation
  try {
    const cj = JSON.parse(fs.readFileSync(new URL('../data/chunks.json', import.meta.url)));
    cm.chunkSpecs = cj;
  } catch(e){ console.error('load chunks.json failed',e); }
  try {
    const gj = JSON.parse(fs.readFileSync(new URL('../data/generation.json', import.meta.url)));
    cm.generationSpec = gj;
  } catch(e){ /* may not exist */ }

  // generate chunk 0,0
  console.log('Generating chunk 0,0');
  const chunk = cm._ensureChunk(0,0);
  console.log('Chunk returned layer:', chunk.layer);
  const key = '0,0';
  console.log('Stored layers keys:', Object.keys(cm.chunks));
  for (const ln of Object.keys(cm.chunks)){
    const b = cm.chunks[ln];
    if (b[key]){
      console.log('layer',ln,'has tiles sample [0]:', b[key].tiles[0]);
    }
  }

  const sx=2, sy=10;
  console.log('\nBefore setTileValue back: getTileValue(back):', cm.getTileValue(sx,sy,'back'));
  console.log('Before setTileValue base: getTileValue(base):', cm.getTileValue(sx,sy,'base'));

  console.log('\nSetting back to red_sand');
  cm.setTileValue(sx,sy,'red_sand','back');
  console.log('After set, getTileValue(back):', cm.getTileValue(sx,sy,'back'));
  console.log('After set, getTileValue(base):', cm.getTileValue(sx,sy,'base'));

  console.log('\nSetting base to air (mining)');
  cm.setTileValue(sx,sy,null,'back');
  console.log('After mining, getTileValue(back):', cm.getTileValue(sx,sy,'back'));
  console.log('After mining, getTileValue(base):', cm.getTileValue(sx,sy,'base'));

  process.exit(0);
})();
