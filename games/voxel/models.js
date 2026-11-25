import * as THREE from 'three';
import { BLOCKS } from './blocks.js';
import { ITEMS } from './items.js';
import { blockGeometry } from './materials.js';

// 3D models + 2D icons for items, cached per game instance.
//   models.create(id) → Object3D centred on the origin, ~1 unit big (scale it yourself)
//   models.icon(id)   → 64×64 canvas (isometric block or flat sprite) for panels
export class ItemModels {
  constructor(game) {
    this.game = game;
    this.spriteGeo = new Map();
    this.icons = new Map();
    this.spriteMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  create(id) {
    const def = ITEMS[id];
    if (!def) return new THREE.Group();
    const root = new THREE.Group();
    if (def.kind === 'block') {
      const m = new THREE.Mesh(blockGeometry(id, this.game.atlas.layer, this.game.world.index), this.game.mats.item);
      m.position.set(-0.5, -0.5, -0.5);
      m.userData.itemLight = 1;
      m.onBeforeRender = itemLightHook;
      root.add(m);
      root.userData.blockMesh = m;
    } else {
      const g = this._spriteGeometry(def.sprite);
      const m = new THREE.Mesh(g, this.spriteMat);
      root.add(m);
    }
    return root;
  }

  // per-pixel extrusion of a 16×16 sprite, 1 unit wide, 1/16 thick, centred
  _spriteGeometry(name) {
    if (this.spriteGeo.has(name)) return this.spriteGeo.get(name);
    const sp = this.game.sprites.get(name);
    const pos = [], nor = [], col = [];
    if (sp) {
      const p = sp.px, on = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && p.alpha(x, y) > 0;
      const s = 1 / 16, t = s * 0.5;
      const quad = (a, b, c, d, n, cc) => { for (const v of [a, b, c, a, c, d]) { pos.push(...v); nor.push(...n); col.push(...cc); } };
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (!on(x, y)) continue;
        const c = p.get(x, y).map(v => Math.pow(v / 255, 2.2));
        const x0 = x * s - 0.5, x1 = x0 + s, y1 = 0.5 - y * s, y0 = y1 - s;
        quad([x0, y0, t], [x1, y0, t], [x1, y1, t], [x0, y1, t], [0, 0, 1], c);
        quad([x1, y0, -t], [x0, y0, -t], [x0, y1, -t], [x1, y1, -t], [0, 0, -1], c);
        const dk = c.map(v => v * 0.75);
        if (!on(x - 1, y)) quad([x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t], [-1, 0, 0], dk);
        if (!on(x + 1, y)) quad([x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t], [1, 0, 0], dk);
        if (!on(x, y - 1)) quad([x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t], [0, 1, 0], dk);
        if (!on(x, y + 1)) quad([x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t], [0, -1, 0], dk);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
    this.spriteGeo.set(name, g);
    return g;
  }

  icon(id) {
    if (this.icons.has(id)) return this.icons.get(id);
    const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    const def = ITEMS[id];
    if (def?.kind === 'block') {
      const b = BLOCKS[id];
      const tile = (f) => this.game.atlas.canvases.get(faceTileName(b, f));
      if (b.render === 'cross') { g.drawImage(tile(0), 8, 8, 48, 48); }
      else {
        const k = S / 32;
        g.setTransform(k, -k / 2, k, k / 2, 0, S / 4); g.drawImage(tile(2), 0, 0, 16, 16);
        g.setTransform(k, k / 2, 0, k, 0, S / 4); g.drawImage(tile(4), 0, 0, 16, 16);
        g.fillStyle = 'rgba(40,30,70,0.22)'; g.fillRect(0, 0, 16, 16);
        g.setTransform(k, -k / 2, 0, k, S / 2, S / 2); g.drawImage(tile(0), 0, 0, 16, 16);
        g.fillStyle = 'rgba(40,30,70,0.4)'; g.fillRect(0, 0, 16, 16);
        g.setTransform(1, 0, 0, 1, 0, 0);
      }
    } else if (def) {
      const sp = this.game.sprites.get(def.sprite);
      if (sp) g.drawImage(sp.canvas, 4, 4, 56, 56);
    }
    this.icons.set(id, cv);
    return cv;
  }

  dispose() { for (const g of this.spriteGeo.values()) g.dispose(); this.spriteGeo.clear(); this.spriteMat.dispose(); }
}

import { faceTile } from './blocks.js';
const faceTileName = (b, f) => faceTile(b, f);

// Per-object light for block items: set the item material's uniform just before drawing.
function itemLightHook(renderer, scene, camera, geometry, material) {
  material.uniforms.uItemLight.value = this.userData.itemLight;
  material.uniformsNeedUpdate = true;
}
