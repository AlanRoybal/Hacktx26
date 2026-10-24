import * as THREE from 'three';
import { World } from './render/world';
import { loadPlayerAsset } from './render/players';
import { Game } from './game/game';
import { Audio } from './audio';
import { JoyConInput } from './input/joycon';
import { MouseInput } from './input/mouse';
import type { InputListener, ThrowEvent } from './input/types';
import { makeHud, setHint, setPill, setDebug, setCross, loaded, loadingText } from './ui/hud';

declare global { interface Window { __rr: any; rr?: { saveTrace(n: string, t: string): Promise<string>; quit(): void } } }

const canvas = document.getElementById('c') as HTMLCanvasElement;
const world = new World(canvas);
const audio = new Audio();
let game: Game;
let mode: 'mouse' | 'joycon' = 'mouse';
let debug = false;

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
  game = new Game(world, audio, makeHud(hooksBuzz));
  window.__rr = { game, world, joy, audio, mouse };
  loaded();
  joy.connect(false);
  requestAnimationFrame(frame);
}

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
  while (acc >= STEP) { game.step(STEP); acc -= STEP; }
  world.render(now / 1000);
  frames++;
  if (now - fpsT > 500) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; }
  updateUi();
  requestAnimationFrame(frame);
}

function updateUi() {
  const s = game.state;
  const trig = mode === 'joycon' ? (joy.active?.isLeft ? 'ZL' : 'ZR') : 'CLICK';
  setHint(s === 'PRESNAP' ? `HOLD ${trig} TO HIKE  ·  ${mode === 'joycon' ? 'STICK' : '1-4'} TO CHANGE PLAY`
    : s === 'POCKET' ? `${mode === 'joycon' ? 'THROW AND RELEASE ' + trig : 'AIM, FLICK UP AND RELEASE'}` : '');
  setPill(joy.connected(), joy.connected() ? `JOY-CON (${joy.active?.isLeft ? 'L' : 'R'}) ${joy.active?.battery ?? ''}` : 'MOUSE  ·  ENTER = CONNECT JOY-CON');
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
  if (!game) return;
  audio.start();
  if (e.key === 'Enter') { await joy.connect(true); if (joy.pads.size) mode = 'joycon'; }
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
addEventListener('keyup', e => { if (e.key === ' ' && mouse.down) mouse.release(); });

boot();
