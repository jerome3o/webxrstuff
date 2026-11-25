import * as THREE from 'three';
import { CFG, SHOP } from './config.js';
import { Panel, PAL, drawBoard } from './ui.js';
import { fitText, roundRect, FONT_BRUSH, FONT_SERIF, FONT_LATIN } from './util.js';
import { audio } from './audio.js';

function windName(w) {
  const s = Math.hypot(w.x, w.z);
  if (s < 0.4) return ['无风', 'calm'];
  // Direction the wind blows FROM, in Chinese compass terms (player faces north = -Z)
  const a = Math.atan2(-w.x, w.z); // from-direction angle, 0 = from north
  const names = [['北风', 'N'], ['东北风', 'NE'], ['东风', 'E'], ['东南风', 'SE'], ['南风', 'S'], ['西南风', 'SW'], ['西风', 'W'], ['西北风', 'NW']];
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return names[i];
}

function ammoText(game, id) {
  const a = game.ammo[id];
  return a === Infinity ? '∞' : `${a}/${game.ammoMax(id)}`;
}

export function buildHUD(scene, ui, game, weapons) {
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x4a2a18, roughness: 0.7 });
  const mount = (panel, pos, w, h) => {
    const g = new THREE.Group(); g.position.copy(pos);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.05), boardMat); back.position.z = -0.03; g.add(back);
    for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, pos.y + h / 2, 8), boardMat); post.position.set(s * (w / 2 - 0.1), -(pos.y + h / 2) / 2 + h / 2, -0.06); g.add(post); }
    g.add(panel.mesh);
    g.lookAt(0, pos.y, 0.5);
    scene.add(g);
    return g;
  };

  // ── Scoreboard ─────────────────────────────────────────────
  const score = new Panel(ui, {
    width: 1.5, height: 1.15, px: 1024,
    draw: (c, W, H) => {
      drawBoard(c, W, H, game.roundActive ? '一炷香' : '射箭场', game.roundActive ? 'yì zhù xiāng · round in progress' : 'shèjiàn chǎng · free practice');
      const col = (x, y, cn, en, val, big = false, color = PAL.paper) => {
        c.textAlign = 'left'; c.fillStyle = PAL.gold; c.font = `44px ${FONT_BRUSH}`; c.fillText(cn, x, y);
        c.fillStyle = PAL.dim; c.font = `24px ${FONT_LATIN}`; c.fillText(en, x + c.measureText(cn).width + 70, y + 4);
        c.fillStyle = color; c.font = `${big ? 92 : 58}px ${FONT_SERIF}`; c.fillText(val, x, y + (big ? 84 : 62), 420);
      };
      c.textBaseline = 'middle';
      col(70, 200, '分数', 'score', `${game.score}`, true, PAL.paper);
      col(560, 200, game.roundActive ? '时间' : '最高', game.roundActive ? 'time' : 'best', game.roundActive ? `${Math.ceil(game.roundTime)}s` : `${game.best}`, true, game.roundActive && game.roundTime < 10 ? '#ff7a5a' : PAL.paper);
      col(70, 380, '连击', 'combo', `${game.combo}  ×${game.comboMult()}`, false, game.combo >= 5 ? '#ffd56a' : PAL.paper);
      col(560, 380, '命中率', 'accuracy', `${game.accuracy()}%`);
      const [wcn, wen] = windName(game.wind);
      col(70, 530, '风', 'wind', `${wcn} ${game.wind.length().toFixed(1)}`);
      c.fillStyle = PAL.dim; c.font = `24px ${FONT_LATIN}`; c.fillText(`${wen} · m/s`, 70, 640);
      col(560, 530, '铜钱', 'coins', `${game.coins}`, false, '#ffd56a');
      // Wind arrow
      const cx = 900, cy = 590, a = Math.atan2(game.wind.x, -game.wind.z);
      c.save(); c.translate(cx, cy); c.rotate(a);
      c.strokeStyle = PAL.gold; c.lineWidth = 6; c.beginPath(); c.moveTo(0, 30); c.lineTo(0, -30); c.lineTo(-12, -14); c.moveTo(0, -30); c.lineTo(12, -14); c.stroke();
      c.restore();
      c.fillStyle = PAL.dim; c.font = `22px ${FONT_LATIN}`; c.textAlign = 'center'; c.fillText('down-range ↑', cx, cy + 50);
      // Footer
      c.textAlign = 'center'; c.fillStyle = PAL.dim; c.font = `26px ${FONT_LATIN}`;
      const lr = game.lastRound;
      const foot = game.roundActive ? 'Hit anything. Misses break the combo.' :
        lr ? `Last round ${lr.score}${lr.newBest ? ' — new best!' : ''} · best combo ${lr.combo} · +${lr.bonus} coins` : 'Shoot the gong to start a 90-second round';
      fitText(c, foot, W / 2, H - 70, W - 140, 28, FONT_LATIN);
    },
  });
  mount(score, new THREE.Vector3(-2.7, 1.75, -2.6), 1.5, 1.15);

  // ── Armoury / shop ─────────────────────────────────────────
  const shop = new Panel(ui, {
    width: 1.7, height: 1.55, px: 1100,
    draw: (c, W, H, p) => {
      drawBoard(c, W, H, '兵器库', `bīngqì kù · armoury    ·    铜钱 ${game.coins} coins`);
      // Weapons row
      const ids = CFG.weaponOrder, bw = (W - 140) / ids.length;
      ids.forEach((id, i) => {
        const Wp = CFG.weapons[id];
        p.button('w-' + id, 70 + i * bw + 6, 170, bw - 12, 120, {
          cn: Wp.cn, en: `${Wp.en} · ${ammoText(game, id)}`, active: weapons.current === id,
          onClick: () => weapons.select(id),
        });
      });
      // Shop items
      c.textAlign = 'left'; c.fillStyle = PAL.gold; c.font = `40px ${FONT_BRUSH}`; c.textBaseline = 'middle';
      c.fillText('宝库', 80, 335); c.fillStyle = PAL.dim; c.font = `24px ${FONT_LATIN}`; c.fillText('bǎokù · treasury — spend copper coins', 170, 340);
      const cols = 2, iw = (W - 160) / cols, ih = 104;
      SHOP.forEach((it, i) => {
        const x = 70 + (i % cols) * (iw + 20), y = 370 + Math.floor(i / cols) * (ih + 12);
        const owned = game.has(it.id);
        const equipped = it.skin && game.skin === it.skin;
        const label = owned ? (it.skin ? (equipped ? '已装备 equipped' : '装备 equip') : '已有 owned') : `${it.price} 铜钱`;
        p.button('s-' + it.id, x, y, iw, ih, {
          cn: `${it.cn}  ·  ${label}`, en: it.en,
          enabled: owned ? !!it.skin : game.coins >= it.price, active: owned && (!it.skin || equipped),
          onClick: () => game.buy(it),
        });
      });
      // Settings row
      const y = H - 140, sw = (W - 160) / 3;
      p.button('music', 70, y, sw, 90, { cn: game.settings.music ? '音乐 开' : '音乐 关', en: 'Music on/off', onClick: () => { game.settings.music = audio.toggleMusic(); game.persist(); } });
      p.button('hand', 90 + sw, y, sw, 90, { cn: game.settings.leftHanded ? '左手' : '右手', en: game.settings.leftHanded ? 'Left-handed' : 'Right-handed', onClick: () => { game.settings.leftHanded = !game.settings.leftHanded; game.persist(); } });
      p.button('skin0', 110 + sw * 2, y, sw, 90, { cn: '桑木弓', en: 'Plain mulberry bow', active: game.skin === 'default', onClick: () => game.setSkin('default') });
    },
  });
  mount(shop, new THREE.Vector3(2.9, 1.55, -1.9), 1.7, 1.55);

  // ── Wrist display (VR) ─────────────────────────────────────
  const wrist = new Panel(ui, {
    width: 0.17, height: 0.085, px: 512,
    draw: (c, W, H) => {
      roundRect(c, 0, 0, W, H, 24); c.fillStyle = 'rgba(28,20,17,0.92)'; c.fill();
      c.lineWidth = 4; c.strokeStyle = PAL.gold; c.stroke();
      const id = weapons.current, Wp = CFG.weapons[id];
      c.textBaseline = 'middle'; c.textAlign = 'left';
      c.fillStyle = PAL.gold; c.font = `86px ${FONT_BRUSH}`; c.fillText(Wp.cn, 26, 100);
      c.fillStyle = PAL.paper; c.font = `72px ${FONT_SERIF}`; c.textAlign = 'right'; c.fillText(ammoText(game, id), W - 24, 96);
      c.textAlign = 'left'; c.fillStyle = PAL.dim; c.font = `30px ${FONT_LATIN}`;
      c.fillText(`${Wp.en}`, 28, 186);
      c.textAlign = 'right'; c.fillStyle = '#ffd56a'; c.fillText(`${game.coins} coins`, W - 24, 186);
    },
  });
  wrist.mesh.renderOrder = 50;
  scene.add(wrist.mesh);

  // Refresh on change; scoreboard also ticks for the timer and wind.
  game.onChange(() => { score.markDirty(); shop.markDirty(); wrist.markDirty(); });
  let acc = 0;
  return {
    score, shop, wrist,
    update(dt) { acc += dt; if (acc > 0.25) { acc = 0; score.markDirty(); } },
  };
}
