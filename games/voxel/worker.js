// Blockfell world worker: terrain generation, lighting and meshing off the main thread.
//
// main → worker
//   { type: 'init', seed, table, edits: { 'cx,cz': [idx, id, idx, id, ...] } }
//   { type: 'load', cx, cz }          generate (if needed) + mesh; replies 'chunk' with blocks + mesh
//   { type: 'remesh', cx, cz, prio }  replies 'mesh' (jumps the queue)
//   { type: 'set', x, y, z, id }      apply one block edit (world coords)
//   { type: 'prune', cx, cz, r }      forget chunks farther than r from (cx, cz)
//   { type: 'spawn' }                 replies 'spawn' { x, y, z }
//   { type: 'column', x, z, id }      replies 'column' { id, h, biome } (terrain height/biome query)
// worker → main
//   { type: 'chunk', cx, cz, blocks, mesh }   mesh = { opaque, trans, light }
//   { type: 'mesh', cx, cz, mesh }
import { CHUNK, HEIGHT } from './blocks.js';
import { WorldGen } from './worldgen.js';
import { Mesher } from './mesher.js';

let gen = null, mesher = null;
const chunks = new Map();     // key → Uint8Array
const edits = new Map();      // key → Map(idx → id)
const jobs = [];              // pending load / remesh jobs
let running = false;

const key = (cx, cz) => cx + ',' + cz;

function getChunk(cx, cz) {
  const k = key(cx, cz);
  let c = chunks.get(k);
  if (!c) {
    c = gen.generateChunk(cx, cz);
    const e = edits.get(k);
    if (e) for (const [i, id] of e) c[i] = id;
    chunks.set(k, c);
  }
  return c;
}

function transferList(mesh) {
  return [mesh.opaque.pos.buffer, mesh.opaque.uv.buffer, mesh.opaque.dat.buffer,
    mesh.trans.pos.buffer, mesh.trans.uv.buffer, mesh.trans.dat.buffer, mesh.light.buffer];
}

function runJob(j) {
  if (j.type === 'load') {
    const blocks = getChunk(j.cx, j.cz).slice();
    const mesh = mesher.build(j.cx, j.cz, getChunk);
    postMessage({ type: 'chunk', cx: j.cx, cz: j.cz, blocks, mesh }, [blocks.buffer, ...transferList(mesh)]);
  } else if (j.type === 'remesh') {
    const mesh = mesher.build(j.cx, j.cz, getChunk);
    postMessage({ type: 'mesh', cx: j.cx, cz: j.cz, mesh }, transferList(mesh));
  }
}

function pump() {
  running = true;
  const t0 = performance.now();
  // run a few jobs per slice, then yield so new (priority) messages get in
  while (jobs.length && performance.now() - t0 < 12) {
    const j = jobs.shift();
    try { runJob(j); } catch (e) { postMessage({ type: 'error', message: String(e && e.stack || e) }); }
  }
  if (jobs.length) setTimeout(pump, 0); else running = false;
}
function schedule() { if (!running) { running = true; setTimeout(pump, 0); } }

onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init': {
      gen = new WorldGen(m.seed);
      mesher = new Mesher(m.table, 10);
      chunks.clear(); edits.clear(); jobs.length = 0;
      for (const k in m.edits) {
        const arr = m.edits[k], mp = new Map();
        for (let i = 0; i < arr.length; i += 2) mp.set(arr[i], arr[i + 1]);
        edits.set(k, mp);
      }
      break;
    }
    case 'load':
      if (!jobs.some(j => j.type === 'load' && j.cx === m.cx && j.cz === m.cz)) jobs.push({ type: 'load', cx: m.cx, cz: m.cz });
      schedule(); break;
    case 'remesh': {
      // drop a duplicate pending remesh, then insert at the front (edits must feel instant)
      const i = jobs.findIndex(j => j.type === 'remesh' && j.cx === m.cx && j.cz === m.cz);
      if (i >= 0) jobs.splice(i, 1);
      const job = { type: 'remesh', cx: m.cx, cz: m.cz };
      if (m.prio) jobs.unshift(job); else {
        let p = 0; while (p < jobs.length && jobs[p].type === 'remesh') p++;
        jobs.splice(p, 0, job);
      }
      schedule(); break;
    }
    case 'set': {
      const cx = Math.floor(m.x / CHUNK), cz = Math.floor(m.z / CHUNK);
      const lx = m.x - cx * CHUNK, lz = m.z - cz * CHUNK;
      if (m.y < 0 || m.y >= HEIGHT) break;
      const idx = lx + (lz << 4) + (m.y << 8);
      const k = key(cx, cz);
      let e = edits.get(k); if (!e) { e = new Map(); edits.set(k, e); }
      e.set(idx, m.id);
      const c = chunks.get(k);
      if (c) c[idx] = m.id;
      break;
    }
    case 'cancel': {
      // drop pending loads that are no longer wanted
      const keep = new Set(m.keys);
      for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].type === 'load' && !keep.has(key(jobs[i].cx, jobs[i].cz))) jobs.splice(i, 1);
      break;
    }
    case 'prune': {
      for (const k of chunks.keys()) {
        const [x, z] = k.split(',').map(Number);
        if (Math.max(Math.abs(x - m.cx), Math.abs(z - m.cz)) > m.r) chunks.delete(k);
      }
      break;
    }
    case 'spawn': postMessage({ type: 'spawn', ...gen.findSpawn() }); break;
    case 'column': { const o = gen.column(m.x, m.z, {}); postMessage({ type: 'column', id: m.id, h: o.h, biome: o.biome }); break; }
  }
};
