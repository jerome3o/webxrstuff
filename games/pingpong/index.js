import * as THREE from 'three';
import { Panel, Pointer, Locomotion, FONTS, roundRect } from '../../src/platform/kit.js';
import {
  R, H, TOP, HL, HW, BLADE_Z, EV_TABLE, EV_NET, EV_FLOOR, makeBall, copyBall, integrate, collideStatic, Predictor, solveShot,
} from './physics.js';
import { PaddleBody, makePaddleMesh } from './paddle.js';
import { Bot, LEVELS, makeShot, makeServe, checkShot, spinFor } from './ai.js';
import { buildWorld, makeBallVisuals, makeBot, makeMachine } from './world.js';
import { Sounds } from './sounds.js';

// Paddle Duel — table tennis against a hovering practice bot.
// Physics runs at a fixed 480 Hz; the player's paddle is swept between its previous and current
// tracked pose so even very fast swings hit. See physics.js / paddle.js.

const SPAWN = { x: 0, z: 2.05, yaw: 0 };
const opp = (w) => (w === 'P' ? 'A' : 'P');
const sideOf = (z) => (z > 0 ? 'P' : 'A');

export async function create(ctx) {
  const { scene, input, rig } = ctx;
  buildWorld(scene);
  const vis = makeBallVisuals(scene);
  const sounds = new Sounds(ctx.audio);
  const loco = new Locomotion({ speed: 2.0 });

  // ── Player paddle ──
  const playerPaddle = makePaddleMesh(0xc8202a, 0x1a1a1e);
  scene.add(playerPaddle);
  const body = new PaddleBody();
  // off hand marker (a small glove puck)
  const offMarker = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshStandardMaterial({ color: 0xe2b85c, roughness: 0.6, transparent: true, opacity: 0.6 }));
  offMarker.scale.set(1, 0.55, 1.3);
  scene.add(offMarker);

  // ── Bot + practice machine ──
  const bot = new Bot(makeBot(scene, makePaddleMesh(0x1d5fbf, 0x1a1a1e)));
  bot.setLevel(ctx.load('pingpong:level', 'normal'));
  const machine = makeMachine(scene);
  machine.position.set(0, 1.0, -1.78); machine.visible = false;
  const NOZZLE = new THREE.Vector3(0, 1.05, -1.56);

  // hit flash
  const flashTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 4, 32, 32, 30); g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.4, 'rgba(255,200,120,0.5)'); g.addColorStop(1, 'rgba(255,160,80,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  flash.scale.setScalar(0.12); scene.add(flash);
  let flashT = 1;

  // ── Ball state ──
  const ball = makeBall();
  const prevP = new THREE.Vector3();
  const pre = makeBall();
  const ev = { type: 0, x: 0, y: 0, z: 0, speed: 0 };
  let ballLive = false, ballHeld = null;  // ballHeld: 'P' | 'A' | null
  let ballVisible = false;
  const judge = new Predictor(1400);

  // ── Timing ──
  let realTime = 0, acc = 0, step = 0;       // fixed-step clock: simTime = step * H
  const simTime = () => step * H;
  let lastEventStep = 0;
  let hitAtStep = -1;

  // ── Game state ──
  const G = {
    mode: 'menu',          // 'menu' | 'match' | 'practice'
    menuOpen: true,
    level: ctx.load('pingpong:level', 'normal'),
    phase: 'idle',         // 'idle' | 'serveReady' | 'toss' | 'live' | 'dead' | 'over'
    server: 'P', gameFirstServer: 'P',
    score: { P: 0, A: 0 }, games: { P: 0, A: 0 }, gameNo: 1,
    lastHitter: null, serveStage: 0, netOnServe: false, bounces: { P: 0, A: 0 },
    msg: '', deadTimer: 0, pendingNewGame: false, matchWinner: null,
    practice: { returns: 0, streak: 0, best: ctx.load('pingpong:best', 0), shots: 0, state: 'wait', nextAt: 0, good: false },
    tossWait: 0,
  };

  // ── Panels ──
  const board = new Panel({ width: 2.4, height: 1.05, px: 1024, transparent: true, draw: drawBoard });
  board.mesh.position.set(0, 2.42, -3.75); scene.add(board.mesh);
  const menu = new Panel({ width: 1.1, height: 0.82, px: 1024, draw: drawMenu });
  menu.mesh.position.set(0, 1.42, 0.98); menu.mesh.rotation.x = -0.16; scene.add(menu.mesh);
  const pointer = new Pointer(scene);
  pointer.panels.push(menu);
  pointer.onHover = () => sounds.hover();
  pointer.onClick = () => sounds.click();

  function drawBoard(c, W, H) {
    roundRect(c, 4, 4, W - 8, H - 8, 36); c.fillStyle = 'rgba(12,16,30,0.92)'; c.fill();
    c.lineWidth = 6; c.strokeStyle = '#e2b85c'; c.stroke();
    c.textBaseline = 'middle';
    if (G.mode === 'practice') {
      c.textAlign = 'center'; c.fillStyle = '#e2b85c'; c.font = `700 64px ${FONTS.sans}`;
      c.fillText('PRACTICE · BALL MACHINE', W / 2, 80);
      c.fillStyle = '#f1e6cf'; c.font = `800 150px ${FONTS.sans}`;
      c.fillText(String(G.practice.returns), W * 0.25, 240);
      c.fillText(String(G.practice.streak), W * 0.5, 240);
      c.fillText(String(G.practice.best), W * 0.75, 240);
      c.font = `600 40px ${FONTS.sans}`; c.fillStyle = '#a8a0c0';
      c.fillText('good returns', W * 0.25, 340); c.fillText('streak', W * 0.5, 340); c.fillText('best streak', W * 0.75, 340);
      c.fillStyle = '#7fd8ff'; c.font = `500 40px ${FONTS.sans}`; c.fillText(G.msg || 'Return the ball onto the far half', W / 2, 410);
      return;
    }
    if (G.mode !== 'match') {
      c.textAlign = 'center'; c.fillStyle = '#e2b85c'; c.font = `700 110px ${FONTS.latin}`; c.fillText('Paddle Duel', W / 2, 170);
      c.fillStyle = '#a8a0c0'; c.font = `500 44px ${FONTS.sans}`; c.fillText(G.msg || 'Choose a mode on the menu', W / 2, 300);
      return;
    }
    const rowY = [150, 290];
    const names = [['YOU', 'P'], [`BOT · ${LEVELS[G.level].name.toUpperCase()}`, 'A']];
    names.forEach(([name, who], i) => {
      const y = rowY[i];
      c.textAlign = 'left'; c.fillStyle = who === 'P' ? '#f1e6cf' : '#9cc8ff'; c.font = `700 62px ${FONTS.sans}`;
      c.fillText(name, 70, y);
      // serve marker
      if (G.server === who && G.phase !== 'over') { c.fillStyle = '#ffffff'; c.beginPath(); c.arc(48, y, 13, 0, Math.PI * 2); c.fill(); }
      // games won
      for (let g = 0; g < 2; g++) { c.beginPath(); c.arc(W - 330 + g * 44, y, 15, 0, Math.PI * 2); c.fillStyle = g < G.games[who] ? '#e2b85c' : 'rgba(255,255,255,0.15)'; c.fill(); }
      c.textAlign = 'right'; c.fillStyle = '#ffffff'; c.font = `800 120px ${FONTS.sans}`;
      c.fillText(String(G.score[who]), W - 60, y + 6);
    });
    c.fillStyle = 'rgba(226,184,92,0.35)'; c.fillRect(60, 220, W - 120, 3);
    c.textAlign = 'center'; c.font = `500 40px ${FONTS.sans}`; c.fillStyle = '#7fd8ff';
    c.fillText(G.msg || `Game ${G.gameNo} · best of 3 · first to 11`, W / 2, 390);
  }

  function drawMenu(c, W, H, panel) {
    roundRect(c, 4, 4, W - 8, H - 8, 40); c.fillStyle = 'rgba(14,18,34,0.95)'; c.fill();
    c.lineWidth = 5; c.strokeStyle = '#e2b85c'; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#e2b85c'; c.font = `700 96px ${FONTS.latin}`; c.fillText('Paddle Duel', W / 2, 92);
    c.fillStyle = '#a8a0c0'; c.font = `500 30px ${FONTS.sans}`; c.fillText('Table tennis against the hall bot', W / 2, 150);
    c.fillStyle = '#f1e6cf'; c.font = `600 30px ${FONTS.sans}`; c.fillText('Opponent', W / 2, 205);
    const ids = ['easy', 'normal', 'hard'];
    ids.forEach((id, i) => panel.button('lv-' + id, 110 + i * 275, 232, 250, 84, LEVELS[id].name, () => setLevel(id), { active: G.level === id, activeBg: '#2a6fb0' }));
    const inMatch = G.mode === 'match' && G.phase !== 'over';
    panel.button('start', 110, 345, 520, 110, inMatch ? 'Restart match' : 'Start match', () => startMatch(), { size: 46 });
    panel.button('resume', 650, 345, 270, 110, 'Resume', () => closeMenu(), { enabled: G.mode !== 'menu' });
    panel.button('practice', 110, 475, 520, 90, 'Practice · ball machine', () => startPractice());
    panel.button('exit', 650, 475, 270, 90, 'Exit to hub', () => ctx.exit());
    c.fillStyle = '#a8a0c0'; c.font = `400 26px ${FONTS.sans}`; c.textAlign = 'left';
    const lines = input.desktop
      ? ['Mouse aims the paddle · move the mouse to swing · LMB lunges forward', 'Q / Space toss to serve · R menu · E recenter · WASD step']
      : ['Paddle in your main hand · swing naturally · off-hand trigger tosses to serve', 'Main B: menu · Main A: recenter · off stick: step sideways'];
    lines.forEach((l, i) => c.fillText(l, 80, 620 + i * 40));
    c.textAlign = 'center'; c.fillStyle = '#7fd8ff'; c.font = `500 28px ${FONTS.sans}`;
    c.fillText('Serves change every 2 points · 11 points, win by 2 · best of 3', W / 2, 720);
  }

  function setLevel(id) { G.level = id; bot.setLevel(id); ctx.save('pingpong:level', id); menu.markDirty(); board.markDirty(); }
  function openMenu() { G.menuOpen = true; menu.mesh.visible = true; menu.markDirty(); }
  function closeMenu() { if (G.mode === 'menu') return; G.menuOpen = false; menu.mesh.visible = false; triggerLock = true; }

  // ── Match flow ──
  function startMatch() {
    G.mode = 'match'; G.practice.state = 'off'; G.score.P = G.score.A = 0; G.games.P = G.games.A = 0; G.gameNo = 1;
    G.gameFirstServer = Math.random() < 0.5 ? 'P' : 'A';
    G.pendingNewGame = false; G.matchWinner = null;
    setBotVisible(true); machine.visible = false;
    bot.reset();
    G.msg = G.gameFirstServer === 'P' ? 'You serve first' : 'Bot serves first';
    closeMenu(); newServe(); board.markDirty();
  }
  function startPractice() {
    G.mode = 'practice'; setBotVisible(false); machine.visible = true; bot.reset();
    Object.assign(G.practice, { returns: 0, streak: 0, shots: 0, state: 'wait', nextAt: simTime() + 1.0, good: false });
    G.msg = 'Get ready…'; ballLive = false; ballHeld = null; ballVisible = false; G.phase = 'idle';
    closeMenu(); board.markDirty();
  }
  function setBotVisible(v) { for (const o of [bot.vis.root, bot.vis.arm, bot.vis.offArm, bot.vis.paddle]) o.visible = v; }

  function currentServer() {
    const n = G.score.P + G.score.A;
    const idx = n < 20 ? Math.floor(n / 2) % 2 : n % 2;
    return idx === 0 ? G.gameFirstServer : opp(G.gameFirstServer);
  }
  function newServe() {
    G.server = currentServer();
    G.phase = 'serveReady';
    G.lastHitter = null; G.serveStage = 0; G.netOnServe = false; G.bounces.P = G.bounces.A = 0;
    ballLive = false; ballVisible = true; hitAtStep = -1;
    ball.v.set(0, 0, 0); ball.w.set(0, 0, 0);
    if (G.server === 'P') { ballHeld = 'P'; G.tossWait = 0; if (!G.msg) G.msg = input.desktop ? 'Your serve · Q or Space to toss' : 'Your serve · off-hand trigger to toss'; }
    else { ballHeld = 'A'; bot.beginServe(simTime()); if (!G.msg) G.msg = 'Bot to serve'; }
    board.markDirty();
  }
  function pointTo(who, why) {
    if (G.mode !== 'match' || G.phase === 'dead' || G.phase === 'over') return;
    G.score[who]++;
    sounds.point(who === 'P');
    G.msg = `${who === 'P' ? 'Your point' : 'Bot’s point'} · ${why}`;
    G.phase = 'dead'; G.deadTimer = 1.7; hitAtStep = -1; bot.state = bot.state === 'track' ? 'recover' : bot.state;
    const s = G.score[who], o = G.score[opp(who)];
    if (s >= 11 && s - o >= 2) {
      G.games[who]++;
      if (G.games[who] >= 2) {
        G.phase = 'over'; G.matchWinner = who; G.deadTimer = 4.5;
        G.msg = who === 'P' ? `You win the match ${G.games.P}–${G.games.A}!` : `The bot wins ${G.games.A}–${G.games.P}. Rematch?`;
        sounds.fanfare(who === 'P');
      } else {
        G.pendingNewGame = true; G.deadTimer = 2.8;
        G.msg = `Game ${G.gameNo} to ${who === 'P' ? 'you' : 'the bot'} (${s}–${o})`;
        sounds.fanfare(who === 'P');
      }
    }
    board.markDirty();
  }
  function letServe(why) {
    if (G.phase === 'dead' || G.phase === 'over') return;
    G.msg = why; G.phase = 'dead'; G.deadTimer = 1.1; hitAtStep = -1; bot.state = 'recover'; board.markDirty();
  }
  function afterDead() {
    if (G.phase === 'over') { G.mode = 'menu'; openMenu(); board.markDirty(); ballVisible = false; ballLive = false; return; }
    if (G.pendingNewGame) {
      G.pendingNewGame = false; G.score.P = G.score.A = 0; G.gameNo++;
      G.gameFirstServer = opp(G.gameFirstServer);
    }
    G.msg = '';
    newServe();
  }

  // Would this ball (no further hits) make a legal landing for `who`'s opponent's shot?
  // Used for volleys: if the ball would have landed correctly on the volleyer's side, the volleyer loses.
  function wouldLandGood(state, volleyer) {
    judge.run(state, 1400);
    let k = 0;
    const tableEv = (i) => { while (i < judge.nev && judge.evType[i] === EV_NET) i++; return i < judge.nev && judge.evType[i] === EV_TABLE ? i : -1; };
    if (G.serveStage === 1) { k = tableEv(0); if (k < 0 || sideOf(judge.evZ[k]) !== G.server) return false; k = tableEv(k + 1); }
    else k = tableEv(0);
    return k >= 0 && sideOf(judge.evZ[k]) === volleyer;
  }

  // ── Rules: events from the physics loop ──
  function onHit(who) {
    lastEventStep = step;
    if (G.mode === 'practice') { if (who === 'P') G.practice.lastHitter = 'P'; return true; }
    if (G.mode !== 'match') return false;
    if (G.phase === 'toss') {
      if (who !== G.server) return false;
      G.phase = 'live'; G.lastHitter = who; G.serveStage = 1; G.netOnServe = false; G.bounces.P = G.bounces.A = 0;
      if (G.msg) { G.msg = ''; board.markDirty(); }
      return true;
    }
    if (G.phase !== 'live') return false;
    if (who === G.lastHitter) { pointTo(opp(who), who === 'P' ? 'you hit it twice' : 'double hit'); return false; }
    if (G.serveStage > 0 || G.bounces[who] === 0) {
      if (wouldLandGood(pre, who)) pointTo(opp(who), who === 'P' ? 'volley — let it bounce first' : 'volley');
      else pointTo(who, G.serveStage > 0 ? 'serve fault' : 'it was going out');
      return false;
    }
    G.lastHitter = who; G.serveStage = 0; G.bounces.P = G.bounces.A = 0;
    return true;
  }
  function onTable(side) {
    lastEventStep = step;
    if (G.mode === 'practice') {
      const pr = G.practice;
      if (pr.state !== 'live') return;
      if (pr.lastHitter === 'P') {
        if (side === 'A') { pr.returns++; pr.streak++; if (pr.streak > pr.best) { pr.best = pr.streak; ctx.save('pingpong:best', pr.best); } G.msg = pr.streak >= 3 ? `Nice! ${pr.streak} in a row` : 'Good return'; }
        else { pr.streak = 0; G.msg = 'Hit your own side'; }
        endPracticeBall();
      } else if (side === 'P') { pr.bouncesP = (pr.bouncesP ?? 0) + 1; if (pr.bouncesP >= 2) { pr.streak = 0; G.msg = 'Missed'; endPracticeBall(); } }
      return;
    }
    if (G.mode !== 'match') return;
    if (G.phase === 'toss') { if (G.server === 'P') letServe('Toss again — strike it on the way down'); return; }
    if (G.phase !== 'live') return;
    if (G.serveStage === 1) {
      if (side === G.server) G.serveStage = 2; else pointTo(opp(G.server), 'serve must bounce on your own side first');
    } else if (G.serveStage === 2) {
      if (side !== G.server) {
        if (G.netOnServe) letServe('Let — serve touched the net');
        else { G.serveStage = 0; G.bounces[side] = 1; }
      } else pointTo(opp(G.server), 'serve fault');
    } else {
      if (side === G.lastHitter) pointTo(opp(G.lastHitter), 'bounced on own side');
      else if (++G.bounces[side] >= 2) pointTo(G.lastHitter, side === 'P' ? 'double bounce' : 'unreturned');
    }
  }
  function onNet() { lastEventStep = step; if (G.mode === 'match' && G.phase === 'live' && G.serveStage > 0) G.netOnServe = true; }
  function onOut(why) {
    if (G.mode === 'practice') {
      const pr = G.practice;
      if (pr.state === 'live') { if (pr.lastHitter === 'P') G.msg = 'Out'; else G.msg = 'Missed'; pr.streak = 0; endPracticeBall(); }
      return;
    }
    if (G.mode !== 'match') return;
    if (G.phase === 'toss') { if (G.server === 'P') letServe('Toss again'); return; }
    if (G.phase !== 'live') return;
    if (G.serveStage > 0) { pointTo(opp(G.server), 'serve fault'); return; }
    const h = G.lastHitter, r = opp(h);
    if (G.bounces[r] >= 1) pointTo(h, r === 'P' ? 'missed return' : 'unreturned');
    else pointTo(r, why);
  }
  function endPracticeBall() { const pr = G.practice; pr.state = 'wait'; pr.nextAt = simTime() + 1.1; board.markDirty(); }

  function fireMachine() {
    const pr = G.practice, lv = LEVELS[G.level];
    const r = Math.random();
    const kind = r < 0.5 ? 'drive' : r < 0.8 ? 'push' : r < 0.92 ? 'lob' : 'smash';
    makeShot(NOZZLE, +1, lv, kind, ball.v, ball.w);
    ball.p.copy(NOZZLE);
    ballLive = true; ballVisible = true; ballHeld = null;
    pr.state = 'live'; pr.lastHitter = 'A'; pr.bouncesP = 0; pr.shots++;
    lastEventStep = step;
    sounds.machine(NOZZLE);
    G.msg = kind === 'push' ? 'Backspin' : kind === 'lob' ? 'High ball' : kind === 'smash' ? 'Fast one!' : 'Topspin';
    board.markDirty();
  }

  // ── Physics sub-step ──
  const tossPt = new THREE.Vector3();
  let needPlan = false, planServe = false;
  function substep(a0, a1) {
    // bot strokes happen at the start of a step, exactly on the predicted sample
    if (G.mode === 'match' && ballLive) {
      if (bot.state === 'track' && hitAtStep >= 0 && step >= hitAtStep) {
        hitAtStep = -1;
        copyBall(pre, ball);
        if (bot.tryHit(ball, simTime())) {
          onHit('A');
          sounds.paddle(ball.p, ball.v.length(), true);
        }
      } else if (bot.state === 'serveToss' && ball.v.y < 0 && ball.p.y <= TOP + 0.3) {
        copyBall(pre, ball);
        bot.serveHit(ball, simTime());
        onHit('A');
        sounds.paddle(ball.p, ball.v.length(), true);
      }
    }
    step++;
    if (!ballLive) return;
    copyBall(pre, ball);
    prevP.copy(ball.p);
    integrate(ball, H);
    if (body.sweep(ball, prevP, a0, a1)) {
      const hit = body.hit;
      ball.p.addScaledVector(ball.v, (1 - hit.f) * H);
      prevP.copy(hit.point);
      playerContact(hit);
    }
    const t = collideStatic(ball, prevP, H, ev);
    if ((step & 3) === 0) pushTrail();
    if (t === EV_TABLE) { sounds.table(ball.p, ev.speed); onTable(sideOf(ev.z)); }
    else if (t === EV_NET) { sounds.net(ball.p, ev.speed); onNet(); }
    else if (t === EV_FLOOR) { sounds.floor(ball.p, ev.speed); onOut('into the floor'); }
    if (Math.abs(ball.p.x) > 8.6 || Math.abs(ball.p.z) > 12.6 || ball.p.y > 7) { onOut('out of the hall'); ballLive = false; ballVisible = false; }
    if ((G.phase === 'live' || G.phase === 'toss' || G.practice.state === 'live') && (step - lastEventStep) * H > 3.5) onOut('timeout');
    if (needPlan) {
      needPlan = false;
      const now = simTime();
      if (G.mode === 'match' && G.phase === 'live' && bot.plan(ball, now, planServe)) { hitAtStep = step + Math.round((bot.hitAt - now) / H); bot.hitAt = hitAtStep * H; }
      else hitAtStep = -1;
    }
  }
  function pushTrail() {   // sampled from the physics clock (120 Hz) so its length is time-based
    const arr = trailPos.array;
    for (let i = vis.trailN - 1; i > 1; i--) { arr[i * 3] = arr[(i - 1) * 3]; arr[i * 3 + 1] = arr[(i - 1) * 3 + 1]; arr[i * 3 + 2] = arr[(i - 1) * 3 + 2]; }
    arr[3] = ball.p.x; arr[4] = ball.p.y; arr[5] = ball.p.z;
  }
  function playerContact(hit) {
    const k = Math.min(1, hit.rel / 9);
    input.main.haptic(0.2 + 0.8 * k, 12 + 30 * k);
    sounds.paddle(hit.point, hit.rel, true);
    flash.position.copy(hit.point); flashT = 0;
    const wasServe = G.phase === 'toss';
    if (input.desktop && !testMode && ball.v.z < 0) desktopAssist(wasServe);
    if (onHit('P') && G.mode === 'match') { needPlan = true; planServe = wasServe; }
  }
  // Desktop only: a mouse can't reproduce a real stroke, so a forward contact is turned into a shot
  // aimed where the camera is heading, with pace from the swing speed. VR keeps the raw physics.
  const aV = new THREE.Vector3(), aW = new THREE.Vector3();
  function desktopAssist(serve) {
    const f = input.head.fwd, yaw = Math.atan2(-f.x, -f.z);
    const sw = Math.min(8, body.vel.length() + ball.v.length() * 0.3);
    if (serve) { makeServe(ball.p, -1, LEVELS.normal, aV, aW); }
    else {
      const tx = THREE.MathUtils.clamp(Math.tan(yaw) * (ball.p.z + 0.9) * -1 + ball.p.x * 0.15, -0.62, 0.62);
      const tz = -THREE.MathUtils.clamp(0.55 + sw * 0.08, 0.5, 1.15);
      const T = THREE.MathUtils.clamp(1.0 - sw * 0.07, 0.45, 0.9);
      spinFor(aW, ball.p, tx, tz, 60 + sw * 20, 0);
      if (!solveShot(ball.p, aW, tx, tz, T, aV) || !checkShot(ball.p, aV, aW, -1)) {
        spinFor(aW, ball.p, tx, -0.8, 40, 0); solveShot(ball.p, aW, tx, -0.8, 1.0, aV);
      }
    }
    ball.v.copy(aV); ball.w.copy(aW);
  }

  function physicsFrame(dt) {
    realTime += dt; acc += dt;
    const frameStart = realTime - dt;
    let n = 0;
    while (acc >= H && n < 160) {
      acc -= H; n++;
      const tStart = step * H;
      const a0 = THREE.MathUtils.clamp((tStart - frameStart) / dt, 0, 1);
      const a1 = THREE.MathUtils.clamp((tStart + H - frameStart) / dt, 0, 1);
      substep(a0, a1);
    }
    if (n >= 160) acc = 0;
    // keep the sim clock glued to real time
    if (Math.abs(realTime - step * H) > 0.1) realTime = step * H + acc;
  }

  // ── Paddle pose from input ──
  const padPos = new THREE.Vector3(), padQuat = new THREE.Quaternion();
  const dX = new THREE.Vector3(), dY = new THREE.Vector3(), dZ = new THREE.Vector3(), dM = new THREE.Matrix4();
  let lungeT = 9;
  function readPaddle(dt) {
    const m = input.main;
    if (__test.paddleOverride) return __test.paddleOverride(dt, padPos, padQuat);
    if (!m.present) return false;
    if (input.desktop) {
      // Paddle rides the crosshair at a fixed distance; mouse motion is the swing. LMB lunges.
      if (input.mouse.leftDown) lungeT = 0;
      lungeT += dt;
      const lunge = lungeT < 0.07 ? 0.3 * lungeT / 0.07 : lungeT < 0.32 ? 0.3 * (1 - (lungeT - 0.07) / 0.25) : 0;
      const head = input.head;
      const blade = dY.copy(head.pos).addScaledVector(head.fwd, 0.52 + lunge);
      // face: horizontal heading, tipped slightly open
      const yaw = Math.atan2(-head.fwd.x, -head.fwd.z);
      dX.set(-Math.sin(yaw), 0.24, -Math.cos(yaw)).normalize();
      dZ.set(0, -1, 0).addScaledVector(dX, dX.y).normalize();   // local -Z = blade up
      const Y = dM.makeBasis(dX, padPos.crossVectors(dZ, dX), dZ);
      padQuat.setFromRotationMatrix(Y);
      padPos.set(0, 0, -BLADE_Z).applyQuaternion(padQuat).negate().add(blade);
    } else { padPos.copy(m.gripPos); padQuat.copy(m.gripQuat); }
    return true;
  }

  // ── Test hooks ──
  let testMode = false;

  ctx.recenter(SPAWN.x, SPAWN.z, SPAWN.yaw);
  if (!ctx.isXR()) input.pitch = -0.32;
  openMenu();
  let triggerLock = false;
  const qs = new THREE.Quaternion(), axis = new THREE.Vector3();
  const trailPos = vis.trail.geometry.attributes.position;

  function update(rdt) {
    const dt = rdt * (__test.timeScale || 1);
    sounds.updateListener(input.head);
    // ── input: menu, recenter ──
    const m = input.main, o = input.off;
    if (m.b || (input.desktop && input.keyDown('KeyR')) || (input.desktop && input.keyDown('Escape'))) { if (G.menuOpen) closeMenu(); else openMenu(); }
    if (m.a || (input.desktop && input.keyDown('KeyE'))) { ctx.recenter(SPAWN.x, SPAWN.z, SPAWN.yaw); if (input.desktop) input.pitch = -0.32; body.hasPose = false; }
    loco.update(dt, input, rig, { turn: false });

    // paddle
    const has = readPaddle(dt);
    playerPaddle.visible = has;
    if (has) { body.setPose(padPos, padQuat, dt); playerPaddle.position.copy(padPos); playerPaddle.quaternion.copy(padQuat); }
    body.enabled = has && !G.menuOpen;
    if (input.desktop !== playerPaddle.userData.desk) {
      playerPaddle.userData.desk = input.desktop;
      playerPaddle.material.transparent = input.desktop; playerPaddle.material.opacity = input.desktop ? 0.55 : 1; playerPaddle.material.needsUpdate = true;
    }
    offMarker.visible = o.present && !input.desktop;
    if (offMarker.visible) { offMarker.position.copy(o.gripPos); offMarker.quaternion.copy(o.gripQuat); }

    // menu pointer
    if (G.menuOpen) {
      const hit = pointer.update(m, { show: true });
      if (hit && m.triggerDown) { pointer.click(hit); triggerLock = true; }
    } else pointer.update(null, { show: false });
    if (m.trigger < 0.2 && o.trigger < 0.2 && !input.key('Space') && !input.key('KeyQ')) triggerLock = false;

    const paused = G.menuOpen && G.mode !== 'menu';
    if (!paused && !testMode) {
      // ── serving ──
      if (G.mode === 'match' && G.phase === 'serveReady') {
        if (ballHeld === 'P') {
          G.tossWait += dt;
          const tossReq = __test.tossNow || !triggerLock && (o.triggerDown || (!input.desktop && m.triggerDown) || (input.desktop && input.keyDown('Space')) || (!o.present && G.tossWait > 1.5));
          if (tossReq) {
            tossPt.copy(ball.p);
            ball.v.set(0, 2.45, 0);
            if (o.present && !input.desktop) { const ov = o.velocity; ball.v.x += THREE.MathUtils.clamp(ov.x * 0.3, -0.5, 0.5); ball.v.z += THREE.MathUtils.clamp(ov.z * 0.3, -0.5, 0.5); ball.v.y += THREE.MathUtils.clamp(ov.y * 0.3, -0.3, 1); }
            ball.w.set(0, 0, 0);
            ballHeld = null; ballLive = true; G.phase = 'toss'; lastEventStep = step;
            sounds.toss(ball.p); o.haptic(0.2, 20); __test.tossNow = false;
            G.msg = ''; board.markDirty();
          }
        } else if (ballHeld === 'A' && bot.state === 'serveHold' && simTime() >= bot.serveAt) {
          bot.servePoint(ball.p); ball.v.set(0, 2.2, 0); ball.w.set(0, 0, 0);
          ballHeld = null; ballLive = true; G.phase = 'toss'; bot.state = 'serveToss'; lastEventStep = step;
          sounds.toss(ball.p);
          if (G.msg) { G.msg = ''; board.markDirty(); }
        }
      }
      // ── practice machine ──
      if (G.mode === 'practice' && G.practice.state === 'wait' && simTime() >= G.practice.nextAt) fireMachine();

      physicsFrame(dt);

      if (G.phase === 'dead' || G.phase === 'over') { G.deadTimer -= dt; if (G.deadTimer <= 0) afterDead(); }
    }

    // held ball follows the hand
    if (ballHeld === 'P') {
      if (o.present) ball.p.copy(o.gripPos).add(axis.set(0, 0.055, -0.02).applyQuaternion(o.gripQuat));
      else ball.p.copy(padPos).add(axis.set(-0.25, 0.1, 0));
      if (input.desktop) ball.p.copy(o.gripPos).add(axis.set(0, 0.05, 0));
    } else if (ballHeld === 'A') ball.p.copy(bot.hold).y += 0.04;

    bot.update(dt, simTime(), ball.p ? ball : null, ballVisible && G.mode === 'match');
    if (ballHeld === 'A') ball.p.copy(bot.hold).y += 0.04;
    updateBallVisuals(dt);
    if (flashT < 1) { flashT += dt / 0.12; flash.material.opacity = Math.max(0, 1 - flashT); flash.scale.setScalar(0.06 + flashT * 0.12); }
    else flash.material.opacity = 0;

    board.redraw();
    if (input.desktop) {
      const s = G.mode === 'match' ? `You ${G.score.P} – ${G.score.A} Bot · games ${G.games.P}–${G.games.A}` : G.mode === 'practice' ? `Practice · returns ${G.practice.returns} · streak ${G.practice.streak}` : 'Paddle Duel';
      ctx.setHud(`${s}${G.msg ? ' · ' + G.msg : ''} &nbsp;|&nbsp; mouse swings · LMB lunge · Q/Space toss · R menu`);
    }
  }

  function updateBallVisuals(dt) {
    const bm = vis.ball;
    bm.visible = ballVisible;
    vis.shadow.visible = ballVisible;
    if (!ballVisible) { vis.trail.visible = false; return; }
    bm.position.copy(ball.p);
    const wl = ball.w.length();
    if (wl > 1e-3 && ballLive) { qs.setFromAxisAngle(axis.copy(ball.w).divideScalar(wl), Math.min(wl, 60) * dt); bm.quaternion.premultiply(qs); }
    // blob shadow on the table or the floor
    const overTable = Math.abs(ball.p.x) < HW && Math.abs(ball.p.z) < HL && ball.p.y > TOP;
    const gy = overTable ? TOP + 0.0015 : 0.004;
    const hgt = Math.max(0, ball.p.y - R - gy);
    vis.shadow.position.set(ball.p.x, gy, ball.p.z);
    vis.shadow.scale.setScalar(0.05 + hgt * 0.06);
    vis.shadow.material.opacity = Math.max(0.12, 0.75 - hgt * 0.55);
    // trail
    const arr = trailPos.array, N = vis.trailN;
    arr[0] = ball.p.x; arr[1] = ball.p.y; arr[2] = ball.p.z;
    if (!ballLive) { for (let i = 1; i < N; i++) { arr[i * 3] = arr[0]; arr[i * 3 + 1] = arr[1]; arr[i * 3 + 2] = arr[2]; } }
    trailPos.needsUpdate = true;
    vis.trail.visible = ballLive && ball.v.lengthSq() > 9;
  }

  // ── Test API (used by automated checks) ──
  var __test = {
    paddleOverride: null, tossNow: false, timeScale: 1,
    THREE, ball, body, bot, G, judge, LEVELS, solveShot, makeShot, makeServe, checkShot, spinFor, collideStatic, integrate, makeBall, Predictor,
    consts: { R, H, TOP, HL, HW, BLADE_Z },
    setTestMode(v) { testMode = v; },
    launchBall(p, v, w) { ball.p.copy(p); ball.v.copy(v); ball.w.copy(w ?? new THREE.Vector3()); ballLive = true; ballVisible = true; ballHeld = null; },
    frame(dt) { physicsFrame(dt); },
    state() { return { phase: G.phase, mode: G.mode, score: { ...G.score }, games: { ...G.games }, server: G.server, msg: G.msg, ballLive, ballHeld, botState: bot.state, hitAtStep, step }; },
    startMatch, startPractice, onHit, onTable, onOut, onNet, pointTo, newServe, afterDead, closeMenu, openMenu,
    get step() { return step; },
  };

  return {
    spawn: SPAWN,
    update,
    __test,
    onXRStart() { body.hasPose = false; menu.markDirty(); },
    onXREnd() { body.hasPose = false; menu.markDirty(); },
    dispose() { sounds.resetListener(); },
  };
}
