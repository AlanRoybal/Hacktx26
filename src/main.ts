import * as THREE from 'three';
import { World } from './render/world';
import { loadPlayerAsset } from './render/players';
import { Game } from './game/game';
import { Audio } from './audio';
import { JoyConInput } from './input/joycon';
import { MouseInput } from './input/mouse';
import type { InputListener, ThrowEvent } from './input/types';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import QRCode from 'qrcode';
import { makeHud, setHint, setPill, setDebug, setCross, loaded, loadingText } from './ui/hud';

declare global { interface Window { __rr: any; rr?: { saveTrace(n: string, t: string): Promise<string>; quit(): void; uploadClip(id: string, bytes: Uint8Array): Promise<string> } } }

const canvas = document.getElementById('c') as HTMLCanvasElement;
const world = new World(canvas);
const audio = new Audio();
let game: Game;
let mode: 'mouse' | 'joycon' = 'mouse';
let debug = false;
const keys = new Set<string>();

const listener: InputListener = {
  onTrigger(down) {
    if (down && game.state === 'PRESNAP') joy.recenter();
    audio.start();
    game.onTrigger(down);
  },
  onThrow(e: ThrowEvent) { game.onThrow(e, e.source === 'mouse' ? groundAim() : undefined); },
  onPumpFake() { game.onPumpFake(); },
};
const joy = new JoyConInput(listener);
const mouse = new MouseInput(canvas, listener, () => mode === 'mouse' || !joy.connected());

const ray = new THREE.Raycaster();
function groundAim() {
  ray.setFromCamera(new THREE.Vector2(mouse.aimX, mouse.aimY), world.camera);
  const p = new THREE.Vector3();
  const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.3), p);
  if (!hit || p.distanceTo(world.camera.position) > 70) return ray.ray.at(55, p).setY(1.3);
  return p;
}

const hooksBuzz = (ms: number, amp = 0.8) => joy.buzz(ms, amp);

async function boot() {
  loadingText('stadium');
  await Promise.all([world.load(loadingText), loadPlayerAsset(), audio.load()]);
  game = new Game(world, audio, makeHud(hooksBuzz, (steps, both) => joy.pattern(steps, both)));
  window.__rr = { game, world, joy, audio, mouse };
  const apply = (st: Game['settings']) => {
    audio.setVolumes(st.music, st.voice, st.crowd);
    (joy as any).preferHand = st.hand;
    if (st.quality !== 'auto') world.setQuality(st.quality);
  };
  game.onSettings = apply;
  game.onConnect = async () => { await joy.connect(true); if (joy.pads.size) mode = 'joycon'; };
  apply(game.settings);
  game.onPotgEnd = () => saveClip(capFrames.splice(0));
  game.h.screen('title', game);
  loaded();
  joy.connect(false);
  requestAnimationFrame(frame);
}

const CAP_W = 320, CAP_H = 180, CLIP_SITE = 'https://hacktx26.alanroybal.com/';
const cap = Object.assign(document.createElement('canvas'), { width: CAP_W, height: CAP_H });
const capCtx = cap.getContext('2d', { willReadFrequently: true })!;
let capFrames: Uint8ClampedArray[] = [], capT = 0;
async function saveClip(frames: Uint8ClampedArray[]) {
  if (frames.length < 8) return;
  const refresh = () => { if (game.state === 'OVER' && game.t > 1) game.h.screen('over', game); };
  game.clip = { status: 'saving' }; refresh();
  const gif = GIFEncoder();
  for (const f of frames) {
    const pal = quantize(f, 256);
    gif.writeFrame(applyPalette(f, pal), CAP_W, CAP_H, { palette: pal, delay: 66 });
    await new Promise(r => setTimeout(r, 0));
  }
  gif.finish();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const res = window.rr ? await window.rr.uploadClip(id, gif.bytes()) : 'no electron';
  if (res !== 'ok') { console.warn('clip', res); game.clip = { status: 'failed' }; return refresh(); }
  const url = `${CLIP_SITE}?c=${id}`;
  game.clip = { status: 'ready', url, qr: await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#0A0806', light: '#F2E6D6' } }) };
  refresh();
}

const fpsLog: number[] = [];
let last = performance.now(), acc = 0, fps = 0, frames = 0, fpsT = 0;
const STEP = 1 / 120;
const tmpQ = new THREE.Quaternion();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  if (joy.connected()) mode = 'joycon';
  // hand + look-off straight from the newest sample, every frame
  if (mode === 'joycon' && joy.active) {
    joy.relativeHand(tmpQ);
    game.handQ.copy(tmpQ);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(tmpQ);
    game.aimYaw = THREE.MathUtils.clamp(Math.atan2(-f.x, -f.z) * 0.25, -0.52, 0.52);
    const st = joy.active.stick[0];
    if (game.state === 'PRESNAP' && Math.abs(st) > 0.7 && !(joy as any)._flick) { (joy as any)._flick = true; game.pickPlay(game.playIdx + Math.sign(st)); }
    if (Math.abs(st) < 0.3) (joy as any)._flick = false;
  } else if (game.state === 'POCKET' || game.state === 'SNAP') {
    game.aimYaw = -mouse.aimX * 0.3;
    game.handQ.setFromEuler(new THREE.Euler(mouse.aimY * 0.3, -mouse.aimX * 0.4, 0));
  }
  // pocket movement: off-hand Joy-Con stick if held, else the throwing Joy-Con's stick, else arrow keys
  let st = [(keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0), (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0)];
  if (joy.connected() && joy.active) {
    const off = [...joy.pads.values()].find(p => p !== joy.active && now - p.lastReport < 300);
    const js = (off ?? joy.active).stick.map(v => (Math.abs(v) < 0.18 ? 0 : THREE.MathUtils.clamp(v, -1, 1)));
    if (Math.hypot(js[0], js[1]) > Math.hypot(st[0], st[1])) st = js;
  }
  game.stick = st;
  // off-hand and throwing-hand buttons: face = spike, menu = timeout, stick click = scramble
  for (const p of joy.pads.values()) {
    const prev = (p as any)._btn ?? {}, b = p.btn;
    if (b.pause && !prev.pause) game.togglePause();
    if (game.paused) { (p as any)._btn = { ...b }; continue; }
    if (b.face && !prev.face) game.spike();
    if (b.menu && !prev.menu) game.callTimeout();
    if (b.stickClick && !prev.stickClick && game.state === 'POCKET') game.scrambleReq = true;
    (p as any)._btn = { ...b };
  }
  if (game.state === 'TITLE' && joy.connected() && joy.active) {
    const [sx, sy] = joy.active.stick, J = joy as any;
    if (Math.abs(sy) > 0.7 && !J._mflick) { J._mflick = true; game.menuMove(sy > 0 ? -1 : 1); }
    else if (Math.abs(sx) > 0.7 && !J._mflick) { J._mflick = true; game.menuAdjust(sx > 0 ? 1 : -1); }
    if (Math.hypot(sx, sy) < 0.3) J._mflick = false;
  }
  if (game.entry && joy.connected() && joy.active) {
    const sy = joy.active.stick[1];
    if (Math.abs(sy) > 0.7 && !(joy as any)._eflick) { (joy as any)._eflick = true; game.entryStep(sy > 0 ? 1 : -1); }
    if (Math.abs(sy) < 0.3) (joy as any)._eflick = false;
  }
  if (game.paused) {
    acc = 0;
    if (joy.connected() && joy.active) {
      const sy = joy.active.stick[1], J = joy as any;
      if (Math.abs(sy) > 0.7 && !J._pflick) { J._pflick = true; game.pauseMove(sy > 0 ? -1 : 1); }
      if (Math.abs(sy) < 0.3) J._pflick = false;
    }
  }
  while (acc >= STEP) { game.step(STEP); acc -= STEP; }
  world.render(now / 1000);
  if (game.state === 'POTG' && now - capT > 66 && capFrames.length < 140) {   // ~15 fps GIF of the play of the game
    capT = now; capCtx.drawImage(world.renderer.domElement, 0, 0, CAP_W, CAP_H);
    capFrames.push(capCtx.getImageData(0, 0, CAP_W, CAP_H).data);
  }
  frames++;
  if (now - fpsT > 500) {
    fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now;
    // auto quality: after a few seconds of measuring, drop to Low if the Mac can't hold ~75 fps
    if (game.settings.quality === 'auto' && world.quality === 'high') { fpsLog.push(fps); if (fpsLog.length > 8) fpsLog.shift(); if (fpsLog.length === 8 && fpsLog.reduce((a, b) => a + b) / 8 < 75) world.setQuality('low'); }
  }
  updateUi();
  requestAnimationFrame(frame);
}

function updateUi() {
  const s = game.state;
  const trig = mode === 'joycon' ? (joy.active?.isLeft ? 'ZL' : 'ZR') : 'CLICK';
  const L = joy.active?.isLeft, jc = mode === 'joycon';
  const clockTools = game.clockRunning ? `  ·  ${jc ? (L ? 'DOWN' : 'A') : 'S'} = SPIKE  ·  ${jc ? (L ? '−' : '+') : 'T'} = TIMEOUT (${game.timeouts})` : '';
  setHint(s === 'PRESNAP' ? `HOLD ${trig} TO HIKE  ·  ${mode === 'joycon' ? 'STICK' : '← →'} TO CHANGE PLAY${clockTools}`
    : s === 'POCKET' ? `${mode === 'joycon' ? 'STICK TO MOVE  ·  THROW, RELEASE ' + trig + ' AT THE TOP  ·  PUSH STICK UP TO RUN' : 'ARROWS TO MOVE  ·  AIM, FLICK UP, RELEASE  ·  HOLD UP TO RUN'}` : '');
  setPill(joy.connected(), joy.connected() ? `JOY-CON (${joy.active?.isLeft ? 'L' : 'R'}) ${joy.active?.battery ?? ''}` : joy.reconnecting() ? 'RECONNECTING JOY-CON  ·  PRESS ANY BUTTON' : 'MOUSE  ·  ENTER = CONNECT JOY-CON');
  setCross(innerWidth * (mouse.aimX + 1) / 2, innerHeight * (1 - mouse.aimY) / 2, mode === 'mouse' && s === 'POCKET');
  if (debug) {
    const t = joy.lastThrow;
    setDebug(`fps ${fps.toFixed(0)}  state ${s}  t ${game.t.toFixed(2)}\nhype tex ${game.hypeTex.toFixed(2)} ou ${game.hypeOU.toFixed(2)}  pressure ${game.pressure.toFixed(2)}\n` +
      `joycon ${joy.connected()} reports ${joy.active?.reports ?? 0}  armed ${joy.armed}\n` +
      (t ? `last throw: wPeak ${t.wPeak.toFixed(0)} dps  v ${t.speed.toFixed(1)}  launch ${t.launchDeg.toFixed(1)}  yaw ${t.yawDeg.toFixed(1)}  wobble ${t.wobble.toFixed(2)}  timing ${t.timingMs.toFixed(0)}ms` : '') +
      `\ndraw calls ${world.renderer.info.render.calls}  tris ${(world.renderer.info.render.triangles / 1000).toFixed(0)}k`);
  }
}

addEventListener('keydown', async e => {
  keys.add(e.key);
  if (!game) return;
  audio.start();
  if (game.entry) {
    if (/^[a-zA-Z]$/.test(e.key)) return game.entryType(e.key);
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return game.entryStep(e.key === 'ArrowUp' ? 1 : -1);
    if (e.key === 'Enter' || e.key === ' ') return game.entryConfirm();
  }
  if (e.key === 'Escape') return game.togglePause();
  if (game.paused) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') game.pauseMove(e.key === 'ArrowUp' ? -1 : 1);
    if (e.key === 'Enter' || e.key === ' ') game.pauseSelect();
    return;
  }
  if (game.state === 'TITLE') {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return game.menuMove(e.key === 'ArrowUp' ? -1 : 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return game.menuAdjust(e.key === 'ArrowRight' ? 1 : -1);
    if (e.key === 'Enter' || e.key === ' ') return game.menuSelect();
  }
  if (e.key === 's') game.spike();
  else if (e.key === 't') game.callTimeout();
  else if (e.key === 'Enter') { await joy.connect(true); if (joy.pads.size) mode = 'joycon'; }
  else if (e.key >= '1' && e.key <= '4') game.pickPlay(+e.key - 1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') game.pickPlay(game.playIdx + (e.key === 'ArrowLeft' ? -1 : 1));
  else if (e.key === ' ' && !e.repeat) { if (!mouse.down) mouse.press(); }
  else if (e.key === 'a') game.autoThrow();
  else if (e.key === 'd') { debug = !debug; setDebug(debug ? ' ' : null); }
  else if (e.key === 'p') world.pixel = !world.pixel;
  else if (e.key === 'c') joy.active?.recalibrate();
  else if (e.key === 'm') mode = mode === 'mouse' ? 'joycon' : 'mouse';
  else if (e.key === 'r' && !e.shiftKey) game.toTitle();
  else if (e.key === 'R' && e.shiftKey) {
    if (!joy.recording) joy.recording = [];
    else { const txt = JSON.stringify(joy.recording); joy.recording = null; const n = `trace-${Date.now()}.json`;
      if (window.rr) window.rr.saveTrace(n, txt); else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt])); a.download = n; a.click(); } }
  }
});
addEventListener('keyup', e => {
  keys.delete(e.key); if (e.key === ' ' && mouse.down) mouse.release(); });

boot();
