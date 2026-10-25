import * as THREE from 'three';
import { World, YD, OU_GOAL_Z, mulberry } from '../render/world';
import { Actor } from '../render/players';
import { PLAYS, OFF_SPOT, DEF_SPOT, OFF_NUM, DEF_NUM, OFF_NAME, DEF_NAME, ELIGIBLE, makeCoverage, type Play, type OffPos, type DefPos, type DefCall, type Cover } from './plays';
import type { ThrowEvent } from '../input/types';
import type { Audio, Clip } from '../audio';

export type State = 'TITLE' | 'PRESNAP' | 'SNAP' | 'POCKET' | 'AIR' | 'RUN' | 'SACK' | 'SCRAMBLE' | 'TACKLED' | 'DEAD' | 'CUTSCENE' | 'OVER';
type Result = { kind: 'catch' | 'inc' | 'int' | 'sack' | 'fumble' | 'td' | 'pi' | 'run'; yards: number; time: number; oob?: boolean; why?: string };

export interface Hooks {
  banner(text: string, sub?: string, color?: string): void;
  hud(g: Game): void;
  buzz(ms: number, amp?: number): void;
  statCard(lines: string[]): void;
  screen(kind: 'title' | 'over' | 'none', g: Game): void;
  plays(sel: number, show: boolean): void;
  rumble(steps: [number, number, number][], both?: boolean): void;
}

const LIVE: State[] = ['SNAP', 'POCKET', 'AIR', 'RUN', 'SACK', 'SCRAMBLE', 'TACKLED'];
const REF_SPOT: Record<string, [number, number, number]> = { R: [-4, -12, 0], CJ: [5, -11, 0], HL: [-25.8, 0, Math.PI / 2], LJ: [25.8, 0, -Math.PI / 2], BJ: [0, 24, Math.PI] };
const grade = (w: number) => (w < 0.08 ? 'A' : w < 0.16 ? 'B' : w < 0.3 ? 'C' : 'DUCK');
export type BoardRow = { n: string; r: number; yds: number; td: number; win: boolean };

const G = 9.81;
const HALF_W = 26.667 * YD;
const OFF: OffPos[] = ['LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3', 'RB'];
const DEF: DefPos[] = ['DE1', 'DT1', 'DT2', 'DE2', 'LB1', 'LB2', 'CB1', 'CB2', 'NB', 'S1', 'S2'];
const v3 = () => new THREE.Vector3();

export class Game {
  state: State = 'TITLE';
  t = 0;            // time in state
  playT = 0;        // time since snap
  clock = 105;
  down = 1; toGo = 10; ballOn = 45;   // yards to the OU goal line
  tex = 27; ou = 31;
  stats = { att: 0, comp: 0, yds: 0, td: 0, int: 0, sacks: 0, bestSpiral: 1, lastPlay: '', fast: 0, long: 0 };
  playIdx = 0;
  play: Play = PLAYS[0];
  off = new Map<OffPos, Actor>();
  def = new Map<DefPos, Actor>();
  qb = v3();
  ball = { pos: v3(), vel: v3(), spin: 0, wobble: 0, live: false, target: null as Actor | null, aim: v3(), throwT: 0, bounced: false, data: null as { missed: boolean } | null, reach: false, q: 1 };
  carrier: Actor | null = null;
  yacGoal = 0;
  result: Result | null = null;
  sackT = 3.5;
  rusher: DefPos = 'DE1';
  jumped: OffPos | null = null;
  speedMul = new Map<OffPos, number>();
  pressure = 0;
  hypeTex = 0.3; hypeOU = 0.2;
  spikeTex = 0; spikeOU = 0;
  waveT = -1;
  assist = 0.85;
  private armT = -1;
  private armKind: 'throw' | 'pump' = 'throw';
  private armFrom = { p: v3(), q: new THREE.Quaternion() };
  lookAt = v3();
  handQ = new THREE.Quaternion();
  aimYaw = 0;          // camera look-off from the controller (rad)
  timeScale = 1; tsTarget = 1;   // slow motion
  stick = [0, 0];                // pocket movement (x = right, y = up/forward)
  qbOff = new THREE.Vector2();
  sackFx = { dir: v3(), start: v3(), fwd: v3(), hit: 0, mates: [] as Actor[] };
  private hudT = 0;
  rng = mulberry(Date.now() & 0xffff);
  private jumboUntil = 0;
  private jumboCamTarget = v3();
  qbA!: Actor;
  refs: Actor[] = [];
  bench: Actor[] = [];
  coach!: Actor;
  call: DefCall = 'MAN';
  cover: Partial<Record<DefPos, Cover>> = {};
  timeouts = 3;
  clockRunning = false;
  private stopClock = false;
  entry: { letters: number[]; idx: number } | null = null;
  savedRank = -1;
  private overT = 0;
  scrambleReq = false;
  private fwdHold = 0;
  private scr = { pos: v3(), vel: v3(), side: 1 };
  private benchT = 0;
  private deadHold = 1.8;
  private cadT = 0;
  menu = { page: 'home' as 'home' | 'settings', sel: 0 };
  settings = Object.assign({ quality: 'auto', music: 7, voice: 7, crowd: 7, hand: 'auto' }, JSON.parse(localStorage.getItem('rrqb_settings') || '{}')) as
    { quality: 'auto' | 'low' | 'high'; music: number; voice: number; crowd: number; hand: 'auto' | 'R' | 'L' };
  onSettings: (s: Game['settings']) => void = () => {};
  onConnect: () => void = () => {};
  static readonly SETTINGS_ROWS = ['QUALITY', 'MUSIC', 'ANNOUNCERS', 'CROWD', 'THROWING HAND', 'CONNECT JOY-CONS', 'BACK'];
  menuMove(d: number) {
    if (this.state !== 'TITLE') return;
    const n = this.menu.page === 'home' ? 2 : Game.SETTINGS_ROWS.length;
    this.menu.sel = (this.menu.sel + d + n) % n; this.h.screen('title', this);
  }
  menuAdjust(d: number) {
    if (this.state !== 'TITLE' || this.menu.page !== 'settings') return;
    const s = this.settings, row = Game.SETTINGS_ROWS[this.menu.sel];
    const cyc = <T,>(arr: T[], v: T) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];
    if (row === 'QUALITY') s.quality = cyc(['auto', 'low', 'high'] as const as unknown as ('auto' | 'low' | 'high')[], s.quality);
    else if (row === 'THROWING HAND') s.hand = cyc(['auto', 'R', 'L'] as ('auto' | 'R' | 'L')[], s.hand);
    else if (row === 'MUSIC') s.music = THREE.MathUtils.clamp(s.music + d, 0, 10);
    else if (row === 'ANNOUNCERS') s.voice = THREE.MathUtils.clamp(s.voice + d, 0, 10);
    else if (row === 'CROWD') s.crowd = THREE.MathUtils.clamp(s.crowd + d, 0, 10);
    localStorage.setItem('rrqb_settings', JSON.stringify(s));
    this.onSettings(s); this.h.screen('title', this);
  }
  menuSelect() {
    if (this.menu.page === 'home') {
      if (this.menu.sel === 0) return this.start();
      this.menu = { page: 'settings', sel: 0 };
    } else {
      const row = Game.SETTINGS_ROWS[this.menu.sel];
      if (row === 'BACK') this.menu = { page: 'home', sel: 1 };
      else if (row === 'CONNECT JOY-CONS') this.onConnect();
      else return this.menuAdjust(1);
    }
    this.h.screen('title', this);
  }
  private throwT0 = 0;
  private tdT = 0;
  private sackPlayT = -1;
  private flagFx: { t: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  private rec: Float32Array[] = [];
  private recT: number[] = [];
  private recAcc = 0;
  private replay: { a: number; b: number; f: number } | null = null;
  private replaySave: Float32Array | null = null;
  private replayHook = {
    apply: () => {
      if (!this.replay) return;
      this.replaySave = this.snapFrame(this.replaySave ?? undefined);
      const fi = Math.floor(this.replay.f), k = this.replay.f - fi;
      const tg = this.loadFrame(this.rec[fi], this.rec[Math.min(this.replay.b, fi + 1)], k);
      const cam = this.w.jumboCam;
      cam.position.set(tg.x + 10, 3.4, tg.z - 8); cam.fov = 30; cam.updateProjectionMatrix(); cam.lookAt(tg.x, 1.2, tg.z);
    },
    restore: () => { if (this.replaySave) this.loadFrame(this.replaySave); },
  };

  constructor(public w: World, public audio: Audio, public h: Hooks) {
    OFF.forEach(p => { const a = new Actor('tex', OFF_NUM[p], OFF_NAME[p]); a.role = p; this.off.set(p, a); w.scene.add(a.obj); });
    DEF.forEach(p => { const a = new Actor('ou', DEF_NUM[p], DEF_NAME[p]); a.role = p; this.def.set(p, a); w.scene.add(a.obj); });
    this.qbA = new Actor('tex', 16, 'MANNING'); this.qbA.role = 'QB'; this.qbA.setLayer(2); w.scene.add(this.qbA.obj);
    for (const r of Object.keys(REF_SPOT)) { const a = new Actor('ref', 0); a.role = r; this.refs.push(a); w.scene.add(a.obj); }
    const nums = { tex: [2, 5, 7, 9, 12, 19, 22], ou: [3, 6, 7, 9, 12, 14, 20] };
    for (const team of ['tex', 'ou'] as const) nums[team].forEach((n, i) => {
      const a = new Actor(team, n); const x = team === 'tex' ? -28.8 : 28.8;
      a.pos.set(x + (i % 2) * 0.7 * Math.sign(x), 0, -12 + i * 4);
      a.heading = a.obj.rotation.y = team === 'tex' ? Math.PI / 2 : -Math.PI / 2;
      a.data.ph = Math.random(); a.play('Idle', 0.01); a.update(0);
      this.bench.push(a); w.scene.add(a.obj);
    });
    this.coach = new Actor('coach', 0); this.coach.heading = this.coach.obj.rotation.y = Math.PI / 2; this.coach.play('Idle', 0.01); w.scene.add(this.coach.obj);
    this.toTitle();
  }

  get losZ() { return OU_GOAL_Z - this.ballOn * YD; }
  get all() { return [...this.off.values(), ...this.def.values()]; }
  get extras() { return [this.qbA, ...this.refs, this.coach, ...this.bench]; }
  private get recActors() { return [...this.off.values(), ...this.def.values(), this.qbA, ...this.refs]; }

  // ---------- flow ----------
  toTitle() {
    this.state = 'TITLE'; this.t = 0; this.menu = { page: 'home', sel: 0 };
    this.resetDrive();
    this.setupPlay();
    this.h.screen('title', this);
    this.w.mosaicTarget = 1;
    this.audio.playMusic('march_grandioso');
  }

  resetDrive() {
    Object.assign(this, { clock: 105, down: 1, toGo: 10, ballOn: 45, tex: 27, ou: 31, spikeTex: 0, spikeOU: 0, timeouts: 3, clockRunning: false, stopClock: false, entry: null });
    this.stats = { att: 0, comp: 0, yds: 0, td: 0, int: 0, sacks: 0, bestSpiral: 1, lastPlay: '', fast: 0, long: 0 };
  }

  start() {
    this.audio.start();
    this.resetDrive();
    this.h.screen('none', this);
    this.h.banner('TEXAS BALL', `OU ${this.ballOn}  |  DOWN 4  |  1:45 LEFT`);
    this.audio.playMusic('wabash', false);
    this.audio.call('intro', true, 0.6);
    this.toPresnap();
  }

  toPresnap() {
    this.state = 'PRESNAP'; this.t = 0;
    this.playIdx = this.down >= 3 && this.toGo > 7 ? 2 + Math.floor(this.rng() * 2) : Math.floor(this.rng() * PLAYS.length);
    this.setupPlay();
    this.h.plays(this.playIdx, true);
    this.h.hud(this);
    this.cadT = 2.6;
    this.audio.duck(true);
    this.w.mosaicTarget = this.rng() < (this.down >= 3 || this.clock < 30 ? 0.5 : 0.15) ? 1 : 0;
    const ord = ['', '1ST', '2ND', '3RD', '4TH'][this.down];
    const lines = this.clock < 30 ? ['FINAL SECONDS', 'GET LOUD'] : this.down === 4 ? ['4TH DOWN', 'MAKE SOME NOISE']
      : this.toGo < 3 && this.down > 1 ? [`${ord} & ${this.toGo}`, 'MAKE SOME NOISE'] : this.down === 3 ? ['3RD DOWN', 'MAKE SOME NOISE'] : null;
    if (lines) {
      const big = this.clock < 30 || this.down === 4;
      this.w.drawJumbo(lines);
      this.jumboUntil = 4;
      this.spikeTex = Math.max(this.spikeTex, big ? 0.65 : 0.4);
      this.spikeOU = Math.max(this.spikeOU, big ? 0.45 : 0.2);
      if (big) { this.audio.call(this.clock < 30 ? 'final' : 'fourth'); this.audio.play('horn', 0.6); this.audio.play('crowd_roar', 0.7, 0.95, 'crowd'); this.h.banner(this.clock < 30 ? 'FINAL SECONDS' : `4TH & ${this.toGo}`, 'STADIUM PULSE', '#BF5700'); }
      if (this.down === 3) this.waveT = 0;
    } else { this.w.jumboLive(); this.jumboUntil = 0; }
  }

  pickPlay(i: number) {
    if (this.state !== 'PRESNAP') return;
    this.playIdx = (i + PLAYS.length) % PLAYS.length;
    this.setupPlay();
    this.cadT = this.t + 0.9;
    this.h.plays(this.playIdx, true);
  }

  setupPlay() {
    this.play = PLAYS[this.playIdx];
    const z = this.losZ;
    this.qb.set(0, 1.9, z - 5 * YD);
    this.rng = mulberry(Math.floor(Math.random() * 1e9));
    this.sackT = this.play.sackTime[0] + this.rng() * (this.play.sackTime[1] - this.play.sackTime[0]);
    this.rusher = this.rng() < 0.5 ? 'DE1' : 'DE2';
    this.jumped = this.rng() < 0.15 ? ELIGIBLE[Math.floor(this.rng() * 4)] : null;
    const cr = this.rng(), long = this.down >= 3 && this.toGo >= 6;
    this.call = long ? (cr < 0.35 ? 'BLITZ' : cr < 0.6 ? 'COVER 3' : cr < 0.8 ? 'COVER 2' : 'ROBBER')
      : (cr < 0.3 ? 'MAN' : cr < 0.5 ? 'COVER 2' : cr < 0.7 ? 'COVER 3' : cr < 0.85 ? 'ROBBER' : 'BLITZ');
    this.cover = makeCoverage(this.call, this.play.coverage);
    if (this.call === 'BLITZ') { this.rusher = 'LB1'; this.sackT = Math.min(this.sackT, 2.3 + this.rng() * 0.5); }
    OFF.forEach(p => this.speedMul.set(p, 0.95 + this.rng() * 0.1));
    for (const [p, a] of this.off) {
      const [x, y] = OFF_SPOT[p];
      a.pos.set(x * YD, 0, z + y * YD); a.vel.set(0, 0, 0); a.heading = 0; a.obj.rotation.y = 0; a.data = {};
      a.play(['LT', 'LG', 'C', 'RG', 'RT'].includes(p) ? 'Stance3pt' : 'Idle', 0.01);
    }
    for (const [p, a] of this.def) {
      let [x, y] = DEF_SPOT[p];
      const man = this.cover[p]?.man;
      if (man && ['WR1', 'WR2', 'WR3'].includes(man)) x = OFF_SPOT[man][0] + (p === 'NB' ? 0.5 : 0);
      a.pos.set(x * YD, 0, z + y * YD); a.vel.set(0, 0, 0); a.heading = Math.PI; a.obj.rotation.y = Math.PI; a.data = {};
      a.play(p.startsWith('D') ? 'Stance3pt' : 'Idle', 0.01);
    }
    if (this.call === 'COVER 3') this.def.get('S2')!.pos.set(0, 0, z + 14 * YD);
    for (const r of this.refs) {
      const [x, y, h] = REF_SPOT[r.role];
      r.pos.set(x, 0, r.role === 'HL' || r.role === 'LJ' ? z : z + y * YD); r.vel.set(0, 0, 0); r.heading = r.obj.rotation.y = h; r.data = {}; r.play('Idle', 0.01);
    }
    this.qbA.pos.set(this.qb.x, 0, this.qb.z); this.qbA.heading = this.qbA.obj.rotation.y = 0; this.qbA.data = {}; this.qbA.setLayer(2); this.qbA.play('QBSet', 0.01);
    this.coach.pos.set(-27.4, 0, THREE.MathUtils.clamp(z, -20, 20)); this.coach.data = {};
    this.w.flag.visible = false; this.flagFx = null; this.deadHold = 1.8; this.fwdHold = 0; this.scrambleReq = false;
    this.all.forEach(a => a.update(0)); this.extras.forEach(a => a.update(0));
    this.ball.live = false; this.ball.target = null; this.carrier = null; this.result = null;
    this.ball.pos.set(0, 0.15, z);
    this.w.football.position.copy(this.ball.pos);
    this.w.football.rotation.set(0, 0, 0);
    this.w.football.visible = true;
    this.w.fpArm.visible = false;
    this.pressure = 0; this.armT = -1; this.aimYaw = 0;
    if (this.w.fpBall) this.w.fpBall.visible = true;
    this.w.placeChains(z, z + this.toGo * YD);
    this.qbOff.set(0, 0); this.timeScale = this.tsTarget = 1; this.continueBall = false;
    this.w.post.mat.uniforms.uDaze.value = 0;
    this.w.camera.fov = 72; this.w.camera.updateProjectionMatrix();
    this.w.fpArm.rotation.set(0, 0, 0); this.w.fpArm.position.set(0.25, -0.17, -0.7);
    this.lookAt.set(0, 1.5, z + 22);
    this.w.camera.position.copy(this.qb);
    this.w.camera.up.set(0, 1, 0);
    this.w.camera.lookAt(this.lookAt);
  }

  onTrigger(down: boolean) {
    if (down && this.state === 'OVER' && this.entry) { if (this.t > 1.3) this.entryConfirm(); return; }
    if (down && this.state === 'TITLE') { if (this.t > 0.4) this.menuSelect(); return; }
    if (down && this.state === 'OVER' && this.t > Math.max(2, this.overT + 1)) { this.toTitle(); return; }
    if (down && this.state === 'PRESNAP' && this.t > 0.6) this.snap();
    if (down && this.state === 'CUTSCENE' && this.t > 1.5) this.t = 99;
    if (down && this.state === 'SACK' && this.t > 1.6) this.t = 99;
  }

  snap() {
    this.state = 'SNAP'; this.t = 0; this.playT = 0; this.cadT = 0;
    this.rec = []; this.recT = []; this.recAcc = 0; this.replay = null; this.stopClock = false; this.clockRunning = false;
    this.h.plays(this.playIdx, false);
    this.w.mosaicTarget = 0;
    this.audio.play('cadence', 0.9);
    this.audio.duck(false);
    this.w.jumboLive();
    this.h.buzz(80, 0.6);
    this.stats.lastPlay = this.play.name;
    const line = new THREE.Vector3(0, 1, this.losZ);
    setTimeout(() => { this.sfx('hit_pads', line, 0.8); this.sfx('grunt', line, 0.7); this.sfx('grunt2', line.clone().setX(2.5), 0.5); }, 230);
  }

  private sfx(name: Clip, at: THREE.Vector3, gain = 1, rate = 1) {
    const d = at.distanceTo(this.w.camera.position);
    this.audio.play(name, gain * THREE.MathUtils.clamp(10 / Math.max(1, d), 0.15, 1), rate * (0.92 + this.rng() * 0.16));
  }

  onPumpFake() {
    if (this.state !== 'POCKET') return;
    for (const p of ['S1', 'S2', 'CB1', 'CB2'] as DefPos[]) this.def.get(p)!.data.bite = 0.5;
    this.startArm('pump');
  }

  // ---------- throw ----------
  onThrow(e: ThrowEvent, groundAim?: THREE.Vector3) {
    if (this.state !== 'POCKET') return;
    const hand = this.handPos();
    let yaw = THREE.MathUtils.degToRad(e.yawDeg) + this.camYaw();
    let th = THREE.MathUtils.degToRad(e.launchDeg);
    let v = e.speed;
    if (groundAim) {                        // mouse: aim point on the field
      const dx = groundAim.x - hand.x, dz = groundAim.z - hand.z;
      yaw = Math.atan2(dx, dz);
      const sol = solve(Math.hypot(dx, dz), -hand.y + 1.3, v);
      v = sol.v; th = sol.th;
    }
    // release quality: how close the trigger release was to peak arm speed
    const q = releaseQuality(e.source === 'auto' ? 0 : e.timingMs);
    yaw += THREE.MathUtils.degToRad((this.rng() - 0.5) * 16 * (1 - q));
    th += THREE.MathUtils.degToRad((e.timingMs > 0 ? -6 : 6) * (1 - q));
    const wobble = Math.max(e.wobble, (1 - q) * 0.45);
    // aim assist: receiver whose lead point is nearest the raw throw
    const rawR = rangeOf(v, th, hand.y - 1.3);
    let best: { a: Actor; score: number; p: THREE.Vector3; v: number; th: number; yaw: number } | null = null;
    for (const p of ELIGIBLE) {
      const a = this.off.get(p)!;
      let lead = a.pos.clone(), sol = { v, th }, R = 0, T = 0;
      for (let k = 0; k < 4; k++) {
        R = Math.hypot(lead.x - hand.x, lead.z - hand.z);
        sol = solve(R, 1.3 - hand.y, v);
        T = R / (sol.v * Math.cos(sol.th));
        lead = this.routePos(p, this.playT + T);
      }
      const ay = Math.atan2(lead.x - hand.x, lead.z - hand.z);
      const dYaw = Math.abs(Math.atan2(Math.sin(ay - yaw), Math.cos(ay - yaw)));
      const dR = Math.abs(Math.log(Math.max(1, rawR) / Math.max(1, R)));
      const score = dYaw / THREE.MathUtils.degToRad(18) + dR * 0.6;
      if (dYaw < THREE.MathUtils.degToRad(18) && dR < 0.8 && (!best || score < best.score)) best = { a, score, p: lead, v: sol.v, th: sol.th, yaw: ay };
    }
    if (best) {
      const k = this.assist * (0.3 + 0.7 * q);
      yaw = yaw + Math.atan2(Math.sin(best.yaw - yaw), Math.cos(best.yaw - yaw)) * k;
      th = th + (best.th - th) * k;
      v = v + (best.v - v) * k;
      this.ball.target = best.a;
      this.ball.aim.copy(best.p);
    } else this.ball.target = null;
    const b = this.ball;
    b.pos.copy(hand);
    b.vel.set(Math.sin(yaw) * Math.cos(th), Math.sin(th), Math.cos(yaw) * Math.cos(th)).multiplyScalar(v);
    b.wobble = wobble; b.spin = 0; b.live = true; b.throwT = 0; b.bounced = false; b.data = null; b.reach = false; b.q = q;
    this.w.football.visible = true;
    this.startArm('throw');
    this.state = 'AIR'; this.t = 0;
    this.stats.att++;
    this.stats.bestSpiral = Math.min(this.stats.bestSpiral, wobble);
    this.audio.play('whoosh', 0.9, 0.9 + v / 60);
    this.h.rumble([[30, 0.7, 320], [40, 0.3, 160]]);
    this.stats.fast = Math.max(this.stats.fast, Math.round(v * 2.237));
    this.throwT0 = this.playT;
    this.qbA.play('Throw', 0.05, 1.3, true); this.qbA.data.thrown = true;
    this.h.statCard([`${Math.round(v * 2.237)} MPH`, `${Math.round(THREE.MathUtils.radToDeg(th))}° LAUNCH`, `SPIRAL ${grade(wobble)}`,
      e.source === 'auto' ? 'AUTO' : releaseText(e.timingMs, q), `VS ${this.call}`]);
  }

  /** Debug/testing: throw to the most open eligible receiver. */
  autoThrow() {
    if (this.state !== 'POCKET') return;
    let best: Actor | null = null, bd = -1;
    for (const p of ELIGIBLE) {
      const a = this.off.get(p)!;
      const d = Math.min(...[...this.def.values()].map(x => x.pos.distanceTo(a.pos)));
      if (d > bd) { bd = d; best = a; }
    }
    const T = best!.pos.distanceTo(this.handPos()) / 18;
    const lead = this.routePos(best!.role as OffPos, this.playT + T).setY(1.3);
    this.onThrow({ speed: 20, launchDeg: 18, yawDeg: 0, wobble: 0.05, timingMs: 0, wPeak: 900, source: 'auto' }, lead);
  }

  handPos() {
    const c = this.w.camera;
    return new THREE.Vector3(0.28, -0.1, -0.5).applyQuaternion(c.quaternion).add(c.position);
  }
  camYaw() { const d = this.lookAt.clone().sub(this.w.camera.position); return Math.atan2(d.x, d.z); }

  // ---------- simulation ----------
  routePos(p: OffPos, t: number) {
    const [sx, sy] = OFF_SPOT[p];
    const pts = this.play.routes[p];
    const z0 = this.losZ;
    const out = new THREE.Vector3(sx * YD, 0, z0 + sy * YD);
    if (!pts || t <= 0) return out;
    const tt = t * (this.speedMul.get(p) ?? 1);
    let i = 1;
    while (i < pts.length - 1 && pts[i][2] < tt) i++;
    const a = pts[i - 1], b = pts[i];
    const f = (tt - a[2]) / (b[2] - a[2]);
    const x = THREE.MathUtils.clamp(sx + a[0] + (b[0] - a[0]) * f, -24, 24);
    return out.set(x * YD, 0, z0 + (sy + a[1] + (b[1] - a[1]) * f) * YD);
  }

  private moveTo(a: Actor, target: THREE.Vector3, maxV: number, dt: number) {
    const d = target.clone().sub(a.pos); d.y = 0;
    const L = d.length();
    const step = Math.min(L, maxV * dt);
    const nv = L > 1e-4 ? d.multiplyScalar(step / L / dt) : v3();
    a.vel.lerp(nv, Math.min(1, dt * 8));
    a.pos.addScaledVector(a.vel, dt);
  }

  private animByVel(a: Actor, facing: number) {
    const s = Math.hypot(a.vel.x, a.vel.z);
    if (s < 0.4) { a.play('Idle', 0.25); a.heading = facing; return; }
    const back = Math.cos(Math.atan2(a.vel.x, a.vel.z) - facing) < -0.3;
    if (back) { a.play('Backpedal', 0.2, s / 3.5); a.heading = facing; }
    else { a.play('Run', 0.2, Math.max(0.6, s / 6.5)); a.heading = Math.atan2(a.vel.x, a.vel.z); }
  }

  step(dtReal: number) {
    this.timeScale += (this.tsTarget - this.timeScale) * Math.min(1, dtReal * 10);
    this.tsTarget = 1;
    const dt = dtReal * this.timeScale;
    this.t += dt;
    const s = this.state;
    if (s === 'TITLE' || s === 'OVER') {
      const a = this.t * 0.07;
      this.w.camera.position.set(Math.sin(a) * 55, 48, Math.cos(a) * 75);
      this.w.camera.lookAt(0, 0, 0);
    }
    if (s === 'PRESNAP') this.presnapIdle();
    if (s === 'PRESNAP' && this.cadT && this.t > this.cadT) {   // QB barks the cadence once the play is set
      this.cadT = 0;
      this.audio.play(`qb_cadence_${Math.floor(this.rng() * 4)}` as Clip, 1.1);
    }
    if (s === 'SNAP') {
      const f = Math.min(1, this.t / 0.35);
      const hand = this.handPos();
      this.ball.pos.set(0, 0.2, this.losZ).lerp(hand, f);
      this.ball.pos.y += Math.sin(f * Math.PI) * 0.4;
      this.w.football.position.copy(this.ball.pos);
      if (f >= 1) { this.w.football.visible = false; this.w.fpArm.visible = true; this.state = 'POCKET'; this.t = 0; }
    }
    if (LIVE.includes(s)) { this.playT += dt; this.simPlayers(dt); this.simRefs(dt); if (s !== 'SACK' && s !== 'TACKLED') this.separate(); }
    if (s === 'DEAD' && this.t > 0.35 && this.t - dt <= 0.35)   // play's over: everyone not involved settles
      [...this.all, ...this.refs].forEach(a => { if (['Run', 'Backpedal', 'Rush', 'Block'].includes(a.current)) { a.vel.set(0, 0, 0); a.play('Idle', 0.6); } });
    if (s === 'PRESNAP' && this.clockRunning) {
      this.clock -= dtReal;
      if ((this.hudT += dtReal) > 0.2) { this.hudT = 0; this.h.hud(this); }
      if (this.clock <= 0) { this.clock = 0; this.gameOver(false, 'TIME EXPIRED'); }
    }
    if (s === 'POCKET') this.pocket(dt);
    if (s === 'AIR') this.air(dt);
    if (s === 'RUN') this.run(dt);
    if (s === 'SACK') this.sack(dt);
    if (s === 'SCRAMBLE') this.scramble(dt);
    if (s === 'TACKLED') this.tackled(dt);
    if (s === 'DEAD' && this.t > this.deadHold) this.applyResult();
    if (s === 'CUTSCENE') this.cutscene(dt);
    if (s === 'OVER' && this.t > 1 && this.t - dt <= 1) this.h.screen('over', this);
    this.w.post.mat.uniforms.uFlash.value *= Math.max(0, 1 - dtReal * 4);
    this.updatePulse(dtReal);
    this.updateCamera(dt);
    const live = LIVE.includes(s);
    if (live && (this.hudT += dtReal) > 0.2) { this.hudT = 0; this.h.hud(this); }
    const cam = this.w.camera;
    const fov = this.timeScale < 0.7 && (s === 'AIR' || s === 'RUN') ? 46 : 72;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dtReal * 5); cam.updateProjectionMatrix(); }
    if (s !== 'SACK') this.w.post.mat.uniforms.uDaze.value = Math.max(0, this.w.post.mat.uniforms.uDaze.value - dtReal * 0.7);
    this.simQB();
    this.sideline(dtReal);
    this.all.forEach(a => a.update(dt));
    this.extras.forEach(a => a.update(dt));
    this.updateArm(dt);
    if (this.flagFx) {
      const f = this.flagFx; f.t += dt;
      const k = THREE.MathUtils.clamp((f.t - 0.36) / 0.7, 0, 1);
      this.w.flag.visible = f.t > 0.36;
      this.w.flag.position.lerpVectors(f.from, f.to, k).y += Math.sin(k * Math.PI) * 2.4;
      this.w.flag.rotation.set(k * 9, k * 4, 0);
      if (k >= 1) this.w.flag.rotation.set(0, 1, 0);
    }
    if (LIVE.includes(this.state) && !this.replay && (this.recAcc += dt) >= 1 / 30) {
      this.recAcc -= 1 / 30;
      if (this.rec.length < 900) { this.rec.push(this.snapFrame()); this.recT.push(this.playT); }
    }
    if (this.replay) {
      if (this.w.jumboMode !== 'replay') this.replay = null;
      else { this.replay.f += dtReal * 30 * 0.55; if (this.replay.f >= this.replay.b) this.replay.f = this.replay.a; }
    }
  }

  private separate() {
    const A = [...this.all, ...this.refs].filter(a => !a.data.done && a !== this.carrier);
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
      const a = A[i], b = A[j], dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 0.75) { const k = (0.75 - d) / d * 0.5; a.pos.x -= dx * k; a.pos.z -= dz * k; b.pos.x += dx * k; b.pos.z += dz * k; }
    }
  }

  private presnapIdle() {
    this.w.camera.position.copy(this.qb);
    this.lookAt.set(0, 1.5, this.losZ + 22);
  }

  private simPlayers(dt: number) {
    const z = this.losZ;
    const t = this.playT;
    // receivers on routes (unless tracking the ball / carrying)
    for (const p of ELIGIBLE) {
      const a = this.off.get(p)!;
      if (a === this.carrier || a.data.done) continue;
      if (a === this.ball.target && this.state === 'AIR') {
        const tl = this.timeToArrival();
        const goal = tl < 1.0 ? this.ballLanding(1.35) : this.routePos(p, t + 0.05);
        this.moveTo(a, goal, 9.5, dt);
        if (a.current.startsWith('Catch')) { a.heading = Math.atan2(a.vel.x, a.vel.z); continue; }
      } else if (this.state === 'SNAP' && t < 0.1) continue;
      else {
        const goal = this.routePos(p, t + dt);
        a.vel.copy(goal).sub(a.pos).divideScalar(dt);
        a.pos.copy(goal);
      }
      this.animByVel(a, 0);
    }
    // line
    for (const p of ['LT', 'LG', 'C', 'RG', 'RT'] as OffPos[]) {
      const a = this.off.get(p)!;
      if (a.data.done) continue;
      a.pos.z = Math.max(z - 2.2 - 1.2 * this.pressure, a.pos.z - 0.6 * dt);
      a.play('Block', 0.25); a.heading = 0;
    }
    for (const p of ['DE1', 'DT1', 'DT2', 'DE2'] as DefPos[]) {
      const a = this.def.get(p)!;
      if (a.data.done || this.state === 'SCRAMBLE' || this.state === 'TACKLED') continue;
      if (p === this.rusher && t > this.sackT - 0.8 && this.state === 'POCKET') {
        const qbp = this.w.camera.position.clone().setY(0);
        this.moveTo(a, qbp, 6.8, dt);
        a.play('Run', 0.15, 1.2); a.face(qbp);
      } else {
        a.pos.z = Math.max(z - 1.6 - 1.2 * this.pressure, a.pos.z - 0.5 * dt);
        if (p === this.rusher) a.pos.x += (Math.sign(a.pos.x) * 4.2 - a.pos.x) * dt * 0.6;
        a.play('Rush', 0.25); a.heading = Math.PI;
      }
    }
    // coverage
    for (const p of ['LB1', 'LB2', 'CB1', 'CB2', 'NB', 'S1', 'S2'] as DefPos[]) {
      const a = this.def.get(p)!;
      if (a === this.carrier || a.data.done || this.state === 'SCRAMBLE' || this.state === 'TACKLED') continue;
      const c = this.cover[p] ?? {};
      if (p === this.rusher && this.state === 'POCKET' && t > this.sackT - 1.1) {
        const qbp = this.w.camera.position.clone().setY(0);
        this.moveTo(a, qbp, 7.2, dt); a.play('Run', 0.15, 1.2); a.face(qbp);
        continue;
      }
      const zone = c.rot && t > c.rot.at ? c.rot.zone : c.zone;
      if (this.ball.data?.missed) a.data.jumper = false;
      let goal: THREE.Vector3;
      let vmax = 8.6;
      if (this.state === 'RUN' && this.carrier) { goal = this.carrier.pos.clone(); vmax = 8.9; }
      else if (this.state === 'AIR' && a.data.jumper) { goal = this.ballLanding(1.3); vmax = 9.2; }
      else if (c.blitz) { goal = new THREE.Vector3(-1.8, 0, z + 0.7); vmax = 5; }
      else if (c.man) {
        const jump = this.jumped === c.man;
        if (jump) a.data.jumper = true;
        const lag = (jump ? 0.05 : c.lag ?? 0.3) + (a.data.bite ?? 0);
        goal = this.routePos(c.man, Math.max(0, t - lag));
        goal.z += (jump ? 0.3 : c.cushion ?? 1.5);
        goal.x += jump ? -Math.sign(goal.x) * 0.5 : Math.sign(goal.x || 1) * 0.8;
        if (c.man === 'RB' || c.man === 'TE') vmax = 7.6;
      } else {
        const [zx, zy] = zone ?? [0, 10];
        goal = new THREE.Vector3(zx * YD, 0, z + zy * YD);
        let near: Actor | null = null, nd = 12;
        for (const r of ELIGIBLE) { const ra = this.off.get(r)!; const d = ra.pos.distanceTo(goal); if (d < nd) { nd = d; near = ra; } }
        if (near && t > 1) goal.lerp(near.pos, 0.6);
        if (a.data.bite > 0) goal.z -= 4;
        vmax = 7.4;
      }
      if (a.data.bite > 0) a.data.bite -= dt;
      if (t > 0.15) this.moveTo(a, goal, vmax, dt);
      if (a.current !== 'Swat') this.animByVel(a, Math.PI);
      if (this.state === 'AIR' && a.data.jumper) a.face(this.ball.pos);
    }
  }

  private pocket(dt: number) {
    const drop = Math.min(1, this.t / 0.8);
    this.qbOff.x = THREE.MathUtils.clamp(this.qbOff.x - this.stick[0] * 2.6 * dt, -2.2, 2.2);
    this.qbOff.y = THREE.MathUtils.clamp(this.qbOff.y + this.stick[1] * 2.0 * dt, -1.4, 1.0);
    const moving = Math.hypot(this.stick[0], this.stick[1]) > 0.2;
    this.w.camera.position.set(this.qb.x + this.qbOff.x, this.qb.y + Math.sin(this.t * (moving ? 11 : 9)) * (moving ? 0.035 : 0.02 * (1 - drop)),
      this.qb.z - 1.4 * drop + this.qbOff.y);
    if (this.rng() < dt * 1.5) this.sfx(this.rng() < 0.5 ? 'grunt' : 'grunt2', new THREE.Vector3((this.rng() - 0.5) * 6, 1, this.losZ), 0.45);
    this.pressure = THREE.MathUtils.clamp(1 - (this.sackT - this.playT) / 1.5, 0, 1);
    const hr = 1.4 + 2 * this.pressure, pr = this.pressure;
    if (pr > 0 && Math.floor((this.t - dt) * hr) !== Math.floor(this.t * hr)) this.h.rumble([[45, 0.35 + 0.5 * pr, 90], [80, 0, 90], [40, 0.25 + 0.4 * pr, 75]]);
    this.fwdHold = this.stick[1] > 0.75 && this.qbOff.y >= 0.95 ? this.fwdHold + dt : 0;
    if (this.fwdHold > 0.35 || this.scrambleReq) { this.scrambleReq = false; return this.startScramble(); }
    const r = this.def.get(this.rusher)!;
    const cam = this.w.camera.position;
    const dr = Math.hypot(r.pos.x - cam.x, r.pos.z - cam.z);
    if (dr < 3.2 && this.playT > this.sackT - 0.8) this.tsTarget = 0.45;
    if (dr < 1.3) this.startSack();
  }

  private startSack() {
    this.state = 'SACK'; this.t = 0;
    const r = this.def.get(this.rusher)!;
    const cam = this.w.camera.position;
    const dir = cam.clone().sub(r.pos).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
    dir.normalize();
    // two nearest teammates come over to celebrate
    const mates = [...this.def.values()].filter(d => d !== r).sort((a, b) => a.pos.distanceTo(r.pos) - b.pos.distanceTo(r.pos)).slice(0, 2);
    this.sackFx = { dir, start: cam.clone(), fwd: dir.clone().negate(), hit: 0, mates };
    this.w.drawJumbo(['SACK!'], '#841617', '#FDF9D8');
    r.data.done = true;
    r.face(cam);
    r.play('Tackle', 0.08, 1.1, true);
    this.w.shake = 0.3;
    this.w.post.mat.uniforms.uFlash.value = 0.3;
    this.sfx('helmet_hit', cam, 1.2); this.sfx('hit_pads', cam, 1.1); this.sfx('grunt2', cam, 1.1);
    this.audio.play('crowd_roar', 0.6, 0.9, 'crowd');
    this.audio.call('sack', true, 0.9);
    this.h.rumble([[260, 1, 140], [60, 0, 0], [120, 0.8, 90], [200, 0.45, 70], [300, 0.2, 60]], true);
    this.qbA.pos.set(cam.x, 0, cam.z); this.qbA.face(r.pos); this.qbA.play('Fall', 0.08, 1, true); this.qbA.data.down = true;
    this.sackPlayT = this.playT;
    this.coachReact('DropReact');
    this.spikeOU = 0.95;
    const fumble = this.rng() < 0.12, lost = fumble && this.rng() < 0.5;
    this.stats.sacks++;
    this.result = { kind: lost ? 'fumble' : 'sack', yards: -7, time: this.playT, why: fumble ? (lost ? 'lost' : 'recovered') : '' };
    this.continueBall = fumble;
    if (fumble) { this.ball.pos.copy(this.handPos()); this.ball.vel.set((this.rng() - 0.5) * 4, 3, (this.rng() - 0.5) * 4); this.w.football.visible = true; }
  }

  /** First person: knocked backward, look up at the sky, helmet slams the turf and bounces, rusher stands over you. */
  private sack(dt: number) {
    const fx = this.sackFx, cam = this.w.camera, t = this.t;
    const r = this.def.get(this.rusher)!;
    const fall = Math.min(1, t / 0.55);
    let y = THREE.MathUtils.lerp(1.9, 0.26, fall * fall);
    let pitch = fall * 1.15;
    if (t > 0.55 && fx.hit === 0) {
      fx.hit = 1;
      this.sfx('thud', cam.position, 1.3); this.sfx('helmet_hit', cam.position, 0.8, 0.8);
      this.w.shake = 0.28; this.w.post.mat.uniforms.uDaze.value = 1;
      this.h.buzz(250, 1); this.audio.muffle(1.8); this.audio.play('ear_ring', 0.45);
    }
    if (t > 0.55) { const k = (t - 0.55) / 0.32; if (k < 1) { y = 0.26 + Math.sin(k * Math.PI) * 0.2; pitch = 1.15 - Math.sin(k * Math.PI) * 0.25; } }
    if (t > 0.87 && fx.hit === 1) { fx.hit = 2; this.sfx('thud', cam.position, 0.8, 1.2); this.w.shake = 0.12; this.h.buzz(120, 0.7); }
    if (t > 1.0 && fx.hit === 2) {
      fx.hit = 3;
      const k = this.result!.kind, why = this.result!.why;
      this.h.banner(k === 'fumble' ? 'FUMBLE' : 'SACKED', k === 'fumble' ? 'OKLAHOMA RECOVERS' : why === 'recovered' ? 'TEXAS RECOVERS' : '-7 YARDS', '#841617');
    }
    const slide = Math.min(1, t / 0.7);
    const pos = fx.start.clone().addScaledVector(fx.dir, 1.6 * (1 - (1 - slide) ** 2));
    cam.position.set(pos.x, y, pos.z);
    const look = cam.position.clone().addScaledVector(fx.fwd, Math.cos(pitch) * 5).add(new THREE.Vector3(0, Math.sin(pitch) * 5, 0));
    // after the bounce: sit up and watch the celebration over you
    const spot = fx.start.clone().addScaledVector(fx.dir, 1.6).addScaledVector(fx.fwd, 1.5).setY(0);
    if (t > 1.25) {
      const sit = Math.min(1, (t - 1.6) / 0.8);
      if (sit > 0) cam.position.y = THREE.MathUtils.lerp(0.26, 0.85, sit * sit * (3 - 2 * sit));
      const group = spot.clone().setY(1.3);
      look.lerp(t < 1.9 ? r.pos.clone().setY(1.7) : group, Math.min(1, (t - 1.25) * 1.5));
    }
    this.lookAt.copy(look);
    const roll = Math.sin(fall * 1.2) * 0.3 * (t > 1.25 ? Math.max(0, 1 - (t - 1.25)) : 1);
    cam.up.set(-fx.fwd.z * Math.sin(roll), Math.cos(roll), fx.fwd.x * Math.sin(roll));
    if (t < 0.6) r.pos.copy(cam.position).setY(0).addScaledVector(fx.fwd, 0.95 - t * 0.25);
    else if (t > 1.1 && !r.data.cel) {
      r.data.cel = 1;
      r.pos.copy(spot); r.face(cam.position); r.play('HornsDown', 0.9, 1, true);
      this.sfx('grunt', r.pos, 0.6, 0.8);
    }
    if (r.data.cel === 1 && t > 1.9) { r.data.cel = 2; r.play('SackDance', 0.25, 1.2); this.audio.playMusic('boomer_sooner', false, 0.8); this.w.jumboLive(); }
    fx.mates.forEach((m, i) => {
      m.data.done = true;
      const side = (i === 0 ? 1 : -1);
      const tgt = spot.clone().add(new THREE.Vector3(fx.fwd.z * side, 0, -fx.fwd.x * side).multiplyScalar(i === 0 ? 0.8 : 1.7)).addScaledVector(fx.fwd, i === 0 ? 0.15 : 0.6);
      if (t > 1.0 && t < 2.6) { this.moveTo(m, tgt, 7.5, dt); if (m.vel.length() > 0.5) { m.play('Run', 0.2, 1.1); m.heading = Math.atan2(m.vel.x, m.vel.z); } }
      if (t > 2.6 && !m.data.bump) { m.data.bump = 1; m.vel.set(0, 0, 0); if (i === 0) m.pos.lerp(r.pos.clone().add(m.pos.clone().sub(r.pos).setLength(0.8)), 1); m.face(r.pos); m.play('ChestBump', 0.15, 1, true); if (i === 0) { r.face(m.pos); r.play('ChestBump', 0.15, 1, true); r.data.cel = 3; this.audio.play('crowd_roar', 0.5, 0.9, 'crowd'); } setTimeout(() => this.sfx('hit_pads', m.pos, 0.7, 1.2), 450); }
      if (t > 3.6 && m.data.bump === 1) { m.data.bump = 2; m.face(cam.position); m.play(i === 0 ? 'Celebrate' : 'HornsDown', 0.3, 1, i !== 0); }
    });
    if (r.data.cel === 3 && t > 4.0) { r.data.cel = 4; r.face(cam.position); r.play('Flex', 0.25); }
    if (t > 3.4 && this.sackPlayT >= 0) { this.startReplay(this.sackPlayT - 2.2, this.sackPlayT + 1.0); this.sackPlayT = -1; }
    // QB's own arm flails up on the hit, then drops out of view
    this.w.fpArm.visible = t < 0.8;
    this.w.fpArm.rotation.x = -fall * 1.4;
    this.w.fpArm.position.y = -0.17 + fall * 0.25;
    if (t < 0.3) this.tsTarget = 0.4;
    if (t > 5.2) this.toDead();
  }

  private timeToArrival() {
    const b = this.ball;
    const h = b.pos.y - 1.35;
    const disc = b.vel.y * b.vel.y + 2 * G * h;
    return disc < 0 ? 0 : (b.vel.y + Math.sqrt(disc)) / G;
  }

  private ballLanding(y: number) {
    const b = this.ball;
    const h = b.pos.y - y;
    const disc = Math.max(0, b.vel.y * b.vel.y + 2 * G * h);
    const T = (b.vel.y + Math.sqrt(disc)) / G;
    return new THREE.Vector3(b.pos.x + b.vel.x * T, 0, b.pos.z + b.vel.z * T);
  }

  private air(dt: number) {
    const b = this.ball;
    if (b.target && this.timeToArrival() < 0.7) this.tsTarget = 0.3;
    b.vel.y -= G * dt;
    b.pos.addScaledVector(b.vel, dt);
    b.throwT += dt;
    b.spin += dt * 60;
    const fb = this.w.football;
    fb.position.copy(b.pos);
    const dir = b.vel.clone().normalize();
    fb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    fb.rotateZ(b.spin);
    if (b.wobble > 0.1) fb.rotateX(Math.sin(b.throwT * 14) * b.wobble * 0.6);
    const tg = b.target;
    if (tg && !b.reach && this.timeToArrival() < 0.42) {
      b.reach = true;
      const T = Math.hypot(tg.pos.x - b.pos.x, tg.pos.z - b.pos.z) / Math.max(1, Math.hypot(b.vel.x, b.vel.z));
      const yAt = b.pos.y + b.vel.y * T - 0.5 * G * T * T;
      tg.play(yAt > 1.85 ? 'CatchHigh' : yAt < 0.95 ? 'CatchLow' : 'CatchChest', 0.12, 1.15, true);
      tg.data.done = false;
      const d = [...this.def.values()].sort((p, q) => p.pos.distanceTo(tg.pos) - q.pos.distanceTo(tg.pos))[0];
      if (d.pos.distanceTo(tg.pos) < 2.2) { d.face(b.pos); d.play('Swat', 0.1, 1.1, true); }
    }
    // catch / INT check: closest player in range gets the first chance
    const chest = (a: Actor) => a.pos.clone().setY(1.35).distanceTo(b.pos);
    const defs = [...this.def.values()];
    let who: Actor | null = null, wd = 99;
    if (b.pos.y > 0.4 && b.pos.y < 2.9) {
      for (const p of ELIGIBLE) { const r = this.off.get(p)!; const d = chest(r); if (d < 1.35 && d < wd) { wd = d; who = r; } }
      if (b.vel.y < 0 && b.pos.y < 2.5) for (const d of defs) { const dd = chest(d); if (dd < 1.0 && dd < wd) { wd = dd; who = d; } }
    }
    if (who && who.team === 'tex') return this.resolveCatch(who, wd, defs, chest);
    if (who && who.team === 'ou' && !b.data?.missed) {
      const r = this.rng();
      if (r < (who.data.jumper ? 0.6 : 0.35) + 0.25 * b.wobble) return this.intercept(who);
      if (r < 0.85) return this.breakup(who, b.target);
      (b as any).data = { missed: true };
    }
    if (b.pos.y < 0.12) {
      if (!b.bounced) { b.bounced = true; b.vel.multiplyScalar(0.35); b.vel.y = Math.abs(b.vel.y) * 0.6; b.pos.y = 0.12; this.incomplete('INCOMPLETE'); }
    }
  }

  private catchBall(r: Actor) {
    this.state = 'RUN'; this.t = 0;
    this.carrier = r;
    this.ball.live = false;
    if (!r.current.startsWith('Catch')) r.play('CatchChest', 0.08, 1.4, true);
    this.stats.comp++;
    const [a, b] = this.play.yac[r.role as OffPos] ?? [1, 6];
    const contested = [...this.def.values()].some(d => d.pos.distanceTo(r.pos) < 2);
    this.yacGoal = r.pos.z + (a + this.rng() * (b - a)) * YD * (contested ? 0.4 : 1);
    this.audio.play('catch_thud', 1);
    if (contested) { this.sfx('hit_pads', r.pos, 1); this.sfx('grunt2', r.pos, 0.9); }
    this.audio.play('crowd_roar', 0.7, 1, 'crowd');
    this.h.buzz(60, 0.6); setTimeout(() => this.h.buzz(60, 0.6), 120);
    if (contested) setTimeout(() => this.h.rumble([[90, 0.8, 110]]), 260);
    this.spikeTex = Math.min(1, 0.45 + (r.pos.z - this.losZ) / 30);
  }

  private intercept(d: Actor) {
    this.state = 'RUN'; this.t = 0;
    this.carrier = d;
    d.play('CatchHigh', 0.1, 1.4, true);
    this.stats.int++;
    this.result = { kind: 'int', yards: 0, time: this.playT, why: d.role };
    this.yacGoal = d.pos.z - 12;
    this.audio.play('crowd_roar', 0.8, 0.85, 'crowd');
    this.audio.playMusic('boomer_sooner', false);
    this.audio.call('int', true);
    this.coachReact('DropReact');
    this.spikeOU = 1;
    this.w.drawJumbo(['INTERCEPTED'], '#841617', '#FDF9D8');
    this.h.banner('INTERCEPTED', `#${d.number} ${d.name}`, '#841617');
    this.h.rumble([[600, 0.7, 55]], true);
  }

  private incomplete(why: string, vel?: THREE.Vector3) {
    if (vel) this.ball.vel.copy(vel);
    this.state = 'DEAD'; this.t = 0;
    this.result = { kind: 'inc', yards: 0, time: this.playT, why };
    this.audio.play('whistle', 0.7);
    this.audio.play('crowd_ooh', 0.8, 1, 'crowd');
    this.spikeOU = 0.35;
    this.h.banner('INCOMPLETE', why);
    this.continueBall = true;
    this.clockRunning = false;
    if (why === 'INCOMPLETE' || why === 'OUT OF BOUNDS') this.audio.call('inc');
    this.refSignal('inc', this.ball.pos);
  }
  private continueBall = false;

  private run(dt: number) {
    const c = this.carrier!;
    const isInt = this.result?.kind === 'int';
    if (this.t < 0.45) this.tsTarget = 0.3;
    if (this.t < 0.45) { c.vel.multiplyScalar(0.9); c.pos.addScaledVector(c.vel, dt); }
    else {
      const goal = new THREE.Vector3(c.pos.x * 0.98, 0, isInt ? c.pos.z - 10 : c.pos.z + 10);
      this.moveTo(c, goal, 8.4, dt);
      c.play('RunBall', 0.2, 1.3); c.face(goal);
    }
    this.ball.pos.copy(c.pos).add(new THREE.Vector3(0.25, 1.15, 0.1));
    this.w.football.position.copy(this.ball.pos);
    if (!isInt && c.pos.z >= OU_GOAL_Z + 0.5) return this.touchdown(c);
    const oob = Math.abs(c.pos.x) > HALF_W;
    const done = isInt ? c.pos.z <= this.yacGoal || this.t > 2.6 : c.pos.z >= this.yacGoal || oob;
    if (done && this.t > 0.6) {
      const tackler = [...(isInt ? this.off.values() : this.def.values())].sort((a, b) => a.pos.distanceTo(c.pos) - b.pos.distanceTo(c.pos))[0];
      if (!oob) {
        const step = c.pos.clone().add(new THREE.Vector3(0.4, 0, isInt ? -0.6 : 0.7)).sub(tackler.pos);
        if (step.length() > 0.6) step.setLength(0.6);
        tackler.pos.add(step); tackler.face(c.pos); tackler.play('Tackle', 0.1, 1, true); tackler.data.done = true;
      }
      c.play('Fall', 0.1, 1, true); c.data.done = true;
      c.vel.set(0, 0, 0);
      this.sfx('hit_pads', c.pos, 1); this.sfx('helmet_hit', c.pos, 0.6);
      this.sfx(this.rng() < 0.5 ? 'grunt' : 'grunt2', c.pos, 0.9);
      this.audio.play('whistle', 0.6);
      this.w.shake = 0.08;
      if (isInt) { this.startReplay(this.throwT0 - 0.8); this.toDead(); return; }
      const yards = Math.round((c.pos.z - this.losZ) / YD);
      this.result = { kind: 'catch', yards, time: this.playT, oob };
      this.stats.yds += yards; this.stats.long = Math.max(this.stats.long, yards);
      const first = yards >= this.toGo;
      this.h.banner(first ? 'FIRST DOWN' : `+${yards} YARDS`, `#${c.number} ${c.name}`, '#BF5700');
      this.audio.call(first && yards >= 15 ? 'big' : first ? 'first' : 'catch');
      if (first) { this.audio.play('horn', 0.7); this.spikeTex = Math.max(this.spikeTex, 0.7); this.refSignal('first', c.pos); }
      if (yards >= 15) { this.startReplay(this.throwT0 - 0.8); this.deadHold = 3.2; }
      else if (first) { this.w.drawJumbo(['FIRST', 'DOWN']); this.jumboUntil = this.t + 3.5; }
      this.toDead();
    }
  }

  /** Ball reached a Texas receiver: separation from the nearest defender decides catch, drop, breakup, pick or flag. */
  private resolveCatch(r: Actor, wd: number, defs: Actor[], chest: (a: Actor) => number) {
    const b = this.ball;
    if (Math.abs(r.pos.x) >= HALF_W) return this.incomplete('OUT OF BOUNDS', b.vel.clone().multiplyScalar(0.6));
    const d = defs.slice().sort((p, q) => p.pos.distanceTo(r.pos) - q.pos.distanceTo(r.pos))[0];
    const sep = d.pos.distanceTo(r.pos);
    const inPhase = chest(d) < wd + 0.35;            // defender has as good a shot at the ball as the receiver
    const v = b.vel.length();
    const bad = 0.3 * b.wobble + 0.2 * (1 - b.q) + 0.25 * Math.max(0, (v - 24) / 6);
    const x = this.rng();
    if (sep < 1.1 && !inPhase && x < 0.13) return this.flag(d, r);
    let pInt: number, pPbu: number, pDrop: number;
    if (sep < 1.0) { pInt = (inPhase ? 0.34 : 0.12) + bad; pPbu = 0.36; pDrop = 0.1; }
    else if (sep < 2.0) { pInt = (inPhase ? 0.12 : 0.04) + bad * 0.6; pPbu = 0.22; pDrop = 0.1; }
    else { pInt = 0; pPbu = 0; pDrop = 0.05 + bad; }
    const y = this.rng();
    if (y < pInt) return this.intercept(d);
    if (y < pInt + pPbu) return this.breakup(d, r);
    if (y < pInt + pPbu + pDrop) return this.drop(r);
    this.catchBall(r);
  }

  private breakup(d: Actor, r: Actor | null) {
    const b = this.ball;
    d.face(b.pos); d.play('Swat', 0.06, 1.3, true); d.data.done = true;
    if (r) { r.play('DropReact', 0.15, 1, true); r.data.done = true; r.vel.multiplyScalar(0.3); }
    this.sfx('hit_pads', b.pos, 1); this.sfx('grunt2', b.pos, 0.8);
    this.spikeOU = 0.6;
    this.audio.call('pbu');
    this.startReplay(this.throwT0 - 0.6); this.deadHold = 3;
    this.incomplete('BROKEN UP', new THREE.Vector3((this.rng() - 0.5) * 5, 4 + this.rng() * 2, -b.vel.z * 0.15));
  }

  private drop(r: Actor) {
    const b = this.ball;
    r.play('DropReact', 0.1, 1, true); r.data.done = true; r.vel.multiplyScalar(0.3);
    this.sfx('catch_thud', b.pos, 0.7, 1.2);
    this.audio.call('drop');
    this.coachReact('DropReact');
    this.incomplete('DROPPED', new THREE.Vector3((this.rng() - 0.5) * 2.5, 3.2, b.vel.z * 0.08));
  }

  /** Defensive pass interference: spot foul (15 max), automatic first down. */
  private flag(d: Actor, r: Actor) {
    const b = this.ball;
    d.face(r.pos); d.play('Tackle', 0.08, 1.2, true); d.data.done = true;
    r.play('Fall', 0.08, 1, true); r.data.done = true; r.vel.set(0, 0, 0);
    this.sfx('hit_pads', r.pos, 1.1); this.sfx('grunt', r.pos, 0.9);
    const yards = Math.max(1, Math.min(15, Math.round((r.pos.z - this.losZ) / YD)));
    this.state = 'DEAD'; this.t = 0;
    this.result = { kind: 'pi', yards, time: this.playT, why: d.role };
    b.vel.set((this.rng() - 0.5) * 3, 2.5, b.vel.z * 0.1); this.continueBall = true;
    this.audio.play('whistle', 0.8);
    this.audio.play('crowd_roar', 0.7, 1.05, 'crowd');
    this.spikeTex = Math.max(this.spikeTex, 0.6);
    this.w.drawJumbo(['FLAG', 'PASS INTERFERENCE'], '#E8C21E', '#111');
    this.jumboUntil = this.t + 3;
    this.audio.call('flag', true, 0.5);
    this.clockRunning = false;
    this.refSignal('pi', r.pos);
    this.h.rumble([[60, 0.6, 250], [60, 0, 0], [60, 0.6, 250]]);
    this.startReplay(this.throwT0 - 0.6); this.deadHold = 3;
    this.h.banner('FLAG', `PASS INTERFERENCE · #${d.number} ${d.name} · ${yards} YDS, AUTO 1ST`, '#C9A400');
  }

  // ---------- first-person arm ----------
  private startArm(kind: 'throw' | 'pump') {
    this.armT = 0; this.armKind = kind;
    this.armFrom.p.copy(this.w.fpArm.position); this.armFrom.q.copy(this.w.fpArm.quaternion);
    this.w.fpArm.visible = true;
  }

  private updateArm(dt: number) {
    const A = this.w.fpArm, s = this.state;
    if (s === 'SACK') return;
    if (this.armT >= 0) {
      this.armT += dt;
      const keys = this.armKind === 'throw' ? THROW_KEYS : PUMP_KEYS;
      if (this.armKind === 'throw' && this.w.fpBall) this.w.fpBall.visible = this.armT < 0.035;
      let i = 0;
      while (i < keys.length - 1 && keys[i + 1].t <= this.armT) i++;
      const a = keys[i], nb = keys[Math.min(keys.length - 1, i + 1)];
      const f = nb === a ? 1 : THREE.MathUtils.smoothstep((this.armT - a.t) / (nb.t - a.t), 0, 1);
      const pa = i === 0 ? this.armFrom.p : a.p, qa = i === 0 ? this.armFrom.q : a.q;
      A.position.lerpVectors(pa, nb.p, f);
      A.quaternion.slerpQuaternions(qa, nb.q, f);
      if (this.armT >= keys[keys.length - 1].t) { this.armT = -1; if (this.armKind === 'throw') A.visible = false; }
      return;
    }
    if (s === 'SNAP') {
      const k = THREE.MathUtils.smoothstep(this.t / 0.35, 0, 1);
      A.visible = true;
      if (this.w.fpBall) this.w.fpBall.visible = k >= 1;
      A.position.set(ARM_REST.x + 0.05 * (1 - k), ARM_REST.y - 0.3 * (1 - k), ARM_REST.z + 0.1 * (1 - k));
      A.quaternion.setFromEuler(new THREE.Euler(-0.6 * (1 - k), 0, 0));
      return;
    }
    if (s !== 'POCKET') return;
    if (this.w.fpBall) this.w.fpBall.visible = true;
    // hand orientation drives the arm; tipping the hand back cocks the ball up beside the helmet
    const e = new THREE.Euler().setFromQuaternion(this.handQ, 'YXZ');
    const cock = THREE.MathUtils.clamp(e.x / 1.1, 0, 1);
    const yaw = THREE.MathUtils.clamp(e.y, -0.7, 0.7);
    const breathe = Math.sin(this.t * 2.2) * 0.004;
    const tp = new THREE.Vector3(ARM_REST.x + 0.06 * cock - 0.12 * yaw, ARM_REST.y + 0.2 * cock + breathe, ARM_REST.z + 0.3 * cock);
    const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x * 0.85 + 0.3 * cock, yaw * 0.8, e.z * 0.6 - 0.3 * cock, 'YXZ'));
    const k = Math.min(1, dt * 28);
    A.position.lerp(tp, k);
    A.quaternion.slerp(tq, k);
  }

  private toDead() { this.state = 'DEAD'; this.t = 0; this.w.fpArm.visible = false; }

  private touchdown(c: Actor) {
    const yards = Math.round((OU_GOAL_Z - this.losZ) / YD);
    this.stats.yds += yards; this.stats.td++;
    this.result = { kind: 'td', yards, time: this.playT };
    this.state = 'CUTSCENE'; this.t = 0; this.tdT = this.playT;
    this.stats.long = Math.max(this.stats.long, yards);
    this.audio.call('td', true, 0.4);
    this.refSignal('td', c.pos);
    this.coachReact('Celebrate', 6);
    c.play('Celebrate', 0.2); c.vel.set(0, 0, 0); c.data.done = true;
    this.tex += 7;
    this.clock = Math.max(1, this.clock - Math.ceil(this.playT));
    this.h.banner('TOUCHDOWN', 'TEXAS', '#BF5700');
    this.h.hud(this);
    this.audio.play('cannon', 1);
    this.audio.play('crowd_roar', 1, 1, 'crowd');
    this.audio.playMusic('texas_fight', false, 1);
    this.w.drawJumbo(['TOUCHDOWN', 'TEXAS']);
    this.jumboUntil = 99;
    this.spikeTex = 1.3;
    this.w.post.mat.uniforms.uFlash.value = 0.25;
    this.h.rumble([[220, 1, 180], [120, 0, 0], [220, 1, 180], [120, 0, 0], [400, 1, 120]], true);
    for (const p of ELIGIBLE) if (this.off.get(p) !== c && this.off.get(p)!.pos.distanceTo(c.pos) < 25) { this.off.get(p)!.data.done = true; this.off.get(p)!.play('Celebrate', 0.3); }
    for (const d of this.def.values()) { d.vel.set(0, 0, 0); d.data.done = true; if (d.current === 'Run' || d.current === 'Backpedal') d.play('Idle', 0.4); }
  }

  private cutscene(dt: number) {
    const c = this.carrier!;
    const a = 0.6 + this.t * 0.35;
    const cam = this.w.camera;
    const r = 7 - Math.min(3, this.t);
    cam.position.lerp(new THREE.Vector3(c.pos.x + Math.sin(a) * r, 1.4 + this.t * 0.25, c.pos.z + Math.cos(a) * r), Math.min(1, dt * 3));
    this.lookAt.lerp(c.pos.clone().setY(1.3), Math.min(1, dt * 4));
    cam.up.set(0, 1, 0);
    if (this.t > 2.2 && this.t - dt <= 2.2) { this.startReplay(this.tdT - 4.5, this.tdT + 1); if (!this.replay) this.w.jumboLive(); }
    if (this.t > 3) this.w.mosaicTarget = 1;
    if (this.t > 7.5) this.gameOver(true);
  }

  private applyResult() {
    const r = this.result!;
    this.w.camera.up.set(0, 1, 0);
    if (r.kind === 'int' || r.kind === 'fumble') return this.gameOver(false, r.kind === 'int' ? 'INTERCEPTED' : 'FUMBLE LOST');
    this.clock -= Math.ceil(r.time);
    this.clockRunning = !this.stopClock && ((r.kind === 'catch' || r.kind === 'run') && !r.oob || r.kind === 'sack');
    if (r.kind === 'pi') {
      this.ballOn = Math.max(1, r.yards >= this.ballOn ? Math.ceil(this.ballOn / 2) : this.ballOn - r.yards);
      this.down = 1; this.toGo = Math.min(10, this.ballOn);
      if (this.clock <= 0) this.clock = 1;   // a game can't end on a defensive foul
      this.clockRunning = false;
      return this.toPresnap();
    }
    this.ballOn = Math.min(99, this.ballOn - r.yards);
    if (r.yards >= this.toGo) { this.down = 1; this.toGo = Math.min(10, this.ballOn); }
    else { this.down++; this.toGo -= r.yards; }
    if (this.clock <= 0) { this.clock = 0; return this.gameOver(false, 'TIME EXPIRED'); }
    if (this.down > 4) return this.gameOver(false, 'TURNOVER ON DOWNS');
    if (r.yards >= 10 || r.kind === 'catch') this.audio.playMusic('wabash', false, 0.8);
    this.toPresnap();
  }

  overReason = '';
  win = false;
  private gameOver(win: boolean, why = '') {
    this.state = 'OVER'; this.t = 0;
    this.win = win; this.overReason = why;
    this.entry = this.stats.att > 0 ? { letters: [0, 0, 0], idx: 0 } : null; this.overT = 0; this.savedRank = -1;
    this.audio.call(win ? 'win' : 'lose', true, 0.8);
    this.h.hud(this);
    if (win) this.audio.playMusic('eyes_of_texas', false);
    else { this.audio.play('crowd_boo', 0.6, 1, 'crowd'); if (why !== 'INTERCEPTED') this.audio.playMusic('boomer_sooner', false); }
    if (!this.replay) this.w.jumboLive();
  }

  // ---------- leaderboard ----------
  board(): BoardRow[] { try { return JSON.parse(localStorage.getItem('rrqb_board') || '[]'); } catch { return []; } }
  entryStep(d: number) {
    if (!this.entry) return;
    const e = this.entry; e.letters[e.idx] = (e.letters[e.idx] + d + 26) % 26;
    this.h.screen('over', this); this.h.rumble([[25, 0.3, 200]]);
  }
  entryType(ch: string) {
    if (!this.entry) return;
    this.entry.letters[this.entry.idx] = ch.toUpperCase().charCodeAt(0) - 65;
    this.entryConfirm();
  }
  entryConfirm() {
    const e = this.entry; if (!e) return;
    e.idx++;
    if (e.idx >= 3) {
      const row: BoardRow = { n: String.fromCharCode(...e.letters.map(l => 65 + l)), r: this.rating(), yds: this.stats.yds, td: this.stats.td, win: this.win };
      const list = [...this.board(), row].sort((a, b) => b.r - a.r || b.yds - a.yds).slice(0, 10);
      this.savedRank = list.indexOf(row);
      localStorage.setItem('rrqb_board', JSON.stringify(list));
      this.entry = null; this.overT = this.t;
      this.audio.play('horn', 0.5);
    }
    this.h.screen('over', this);
  }
  bestSpiralGrade() { return this.stats.att ? grade(this.stats.bestSpiral) : '-'; }

  // ---------- two-minute drill ----------
  callTimeout() {
    if (this.timeouts <= 0 || !['PRESNAP', 'DEAD'].includes(this.state)) return;
    if (this.state === 'PRESNAP' && !this.clockRunning) return;
    this.timeouts--; this.clockRunning = false; this.stopClock = true;
    this.audio.play('whistle', 0.7); this.audio.call('timeout', true);
    this.h.banner('TIMEOUT', `TEXAS · ${this.timeouts} LEFT`, '#BF5700'); this.h.hud(this);
    this.h.rumble([[50, 0.5, 200], [60, 0, 0], [50, 0.5, 200]]);
  }
  spike() {
    if (this.state !== 'PRESNAP' || this.t < 0.6) return;
    this.h.plays(this.playIdx, false);
    this.playT = 0;
    this.audio.play('cadence', 0.9); this.audio.duck(false);
    this.ball.pos.set(this.qb.x, 0.15, this.qb.z + 1); this.w.football.position.copy(this.ball.pos);
    this.result = { kind: 'inc', yards: 0, time: 1, why: 'SPIKE' };
    this.clockRunning = false; this.stopClock = true;
    this.state = 'DEAD'; this.t = 0;
    this.audio.call('spike', true); this.audio.play('whistle', 0.6);
    this.h.banner('SPIKE', 'CLOCK STOPPED', '#BF5700');
    this.refSignal('inc', this.ball.pos);
    this.qbA.play('Throw', 0.05, 1.4, true); this.qbA.data.thrown = true;
  }

  private startScramble() {
    this.state = 'SCRAMBLE'; this.t = 0;
    this.scr.pos.copy(this.w.camera.position).setY(0); this.scr.vel.set(0, 0, 0);
    const left = [...this.def.values()].filter(d => d.pos.x > this.scr.pos.x).length;
    this.scr.side = Math.abs(this.stick[0]) > 0.3 ? -Math.sign(this.stick[0]) : left > 5.5 ? -1 : 1;
    this.w.fpArm.visible = false; this.w.football.visible = false;
    this.qbA.play('RunBall', 0.15, 1.2);
    this.audio.call('scramble', true); this.audio.play('crowd_roar', 0.5, 1, 'crowd');
    this.spikeTex = Math.max(this.spikeTex, 0.5);
    this.h.rumble([[60, 0.5, 140]]);
  }

  private scramble(dt: number) {
    const p = this.scr.pos;
    // first 0.6 s: roll out toward the stick side (or the open edge) to clear the line
    const roll = this.t < 0.6 ? this.scr.side * (1 - this.t / 0.6) : 0;
    const lat = THREE.MathUtils.clamp(-this.stick[0] + roll * 1.4, -1.4, 1.4);
    this.scr.vel.set(lat * 4.5, 0, (this.t < 0.6 ? 3.5 : 6.8) + Math.max(0, this.stick[1]) * 0.6);
    for (const o of this.off.values()) {   // own blockers give way instead of the camera clipping through them
      const d = o.pos.clone().sub(p).setY(0), L = d.length();
      if (L < 1.4) { o.pos.addScaledVector(d.normalize(), (1.4 - L)); o.vel.set(0, 0, 0); }
    }
    p.addScaledVector(this.scr.vel, dt);
    const cam = this.w.camera;
    cam.position.set(p.x, 1.82 + Math.abs(Math.sin(this.t * 9.5)) * 0.07, p.z);
    this.lookAt.set(p.x + lat * 3, 1.5, p.z + 12);
    this.qbA.pos.copy(p); this.qbA.heading = Math.atan2(this.scr.vel.x, this.scr.vel.z);
    if (Math.floor((this.t - dt) * 2.6) !== Math.floor(this.t * 2.6)) this.h.rumble([[35, 0.3, 120]]);
    for (const d of this.def.values()) {
      if (d.data.done) continue;
      const lead = p.clone().addScaledVector(this.scr.vel, 0.35);
      this.moveTo(d, lead, d.role.startsWith('D') ? 5.6 : 7.4, dt); d.play('Run', 0.2, 1.2); d.face(lead);
      if (d.pos.distanceTo(p) < 1.05 && this.t > 0.45) return this.startTackled(d);
    }
    if (p.z >= OU_GOAL_Z + 0.5) { this.qbA.setLayer(0); this.carrier = this.qbA; return this.touchdown(this.qbA); }
    if (Math.abs(p.x) > HALF_W) this.endRun(p, true);
  }

  private startTackled(d: Actor) {
    this.state = 'TACKLED'; this.t = 0;
    d.face(this.scr.pos); d.play('Tackle', 0.08, 1.2, true); d.data.done = true;
    this.qbA.play('DiveTackled', 0.08, 1, true); this.qbA.data.down = true;
    const p = this.w.camera.position;
    this.sfx('hit_pads', p, 1.2); this.sfx('helmet_hit', p, 0.8); this.sfx('grunt2', p, 1);
    this.w.shake = 0.25; this.w.post.mat.uniforms.uFlash.value = 0.2;
    this.h.rumble([[200, 1, 130], [80, 0, 0], [180, 0.5, 80]], true);
    this.audio.play('whistle', 0.6);
  }

  private tackled(dt: number) {
    const k = Math.min(1, this.t / 0.45), p = this.scr.pos, cam = this.w.camera;
    if (this.t < 0.45) p.z += 2.2 * dt;
    cam.position.set(p.x, THREE.MathUtils.lerp(1.85, 0.35, k * k), p.z);
    this.lookAt.set(p.x, cam.position.y - Math.sin(k * 1.1) * 4, p.z + Math.cos(k * 1.1) * 4);
    if (this.t > 0.45 && this.t - dt <= 0.45) { this.sfx('thud', cam.position, 1.1); this.w.shake = 0.15; this.w.post.mat.uniforms.uDaze.value = 0.4; }
    if (this.t > 1.3) this.endRun(p, false);
  }

  private endRun(p: THREE.Vector3, oob: boolean) {
    const yards = Math.round((p.z - this.losZ) / YD);
    this.result = { kind: 'run', yards, time: this.playT, oob };
    this.stats.long = Math.max(this.stats.long, yards);
    const first = yards >= this.toGo;
    this.h.banner(first ? 'FIRST DOWN' : yards >= 0 ? `+${yards} YARDS` : `${yards} YARDS`, '#16 MANNING' + (oob ? ' · OUT OF BOUNDS' : ''), '#BF5700');
    if (first) { this.audio.play('horn', 0.7); this.audio.call('first'); this.refSignal('first', p); }
    this.audio.play('whistle', 0.6);
    this.state = 'DEAD'; this.t = 0; this.w.fpArm.visible = false;
    this.w.camera.up.set(0, 1, 0);
  }

  // ---------- officials, sideline, jumbotron QB ----------
  private simRefs(dt: number) {
    const z = this.losZ;
    const focus = this.carrier?.pos ?? (this.state === 'AIR' ? this.ball.pos.clone().setY(0)
      : this.state === 'SCRAMBLE' || this.state === 'TACKLED' ? this.scr.pos : new THREE.Vector3(0, 0, z));
    for (const r of this.refs) {
      if (r.data.done) continue;
      let g: THREE.Vector3;
      if (r.role === 'HL' || r.role === 'LJ') g = new THREE.Vector3(r.role === 'HL' ? -25.8 : 25.8, 0, Math.max(z, focus.z - 2));
      else if (r.role === 'BJ') {
        let deep = z + 20 * YD;
        for (const p of ELIGIBLE) deep = Math.max(deep, this.off.get(p)!.pos.z + 6);
        g = new THREE.Vector3(focus.x * 0.3, 0, Math.min(deep, OU_GOAL_Z + 9));
      } else g = new THREE.Vector3(r.role === 'R' ? -4 : 5, 0, z - 12 * YD + (this.state === 'RUN' ? (focus.z - z) * 0.6 : 0));
      if (this.state === 'RUN' && r.pos.distanceTo(focus) < 7 && r.role !== 'HL' && r.role !== 'LJ') g = r.pos.clone();
      this.moveTo(r, g, 6.5, dt);
      this.animByVel(r, Math.atan2(focus.x - r.pos.x, focus.z - r.pos.z));
    }
  }

  private refSignal(kind: 'td' | 'inc' | 'first' | 'pi', at: THREE.Vector3) {
    const near = [...this.refs].sort((a, b) => a.pos.distanceTo(at) - b.pos.distanceTo(at));
    const anim = { td: 'RefTD', inc: 'RefIncomplete', first: 'RefFirstDown', pi: 'RefFlag' }[kind];
    const who = kind === 'td' ? near.slice(0, 3) : kind === 'first' ? [near.find(r => r.role === 'HL' || r.role === 'LJ')!] : [near[0]];
    const cam = this.w.camera.position;
    for (const r of who) {
      r.data.done = true; r.vel.set(0, 0, 0);
      r.heading = kind === 'first' ? 0 : Math.atan2(cam.x - r.pos.x, cam.z - r.pos.z);
      r.play(anim, 0.15, 1, kind !== 'inc');
    }
    if (kind === 'pi') {
      const r = who[0];
      this.flagFx = { t: 0, from: r.pos.clone().setY(2.1), to: at.clone().setY(0.03) };
      setTimeout(() => r.play('RefPI', 0.2), 1300);
    }
  }

  private coachReact(anim: string, sec = 3) { this.coach.play(anim, 0.2, 1, anim !== 'Celebrate'); this.coach.data.left = sec; }

  private sideline(dtReal: number) {
    if ((this.benchT -= dtReal) > 0) return;
    this.benchT = 0.4;
    for (const b of this.bench) {
      const hype = b.team === 'tex' ? this.hypeTex : this.hypeOU;
      const on = hype > 0.72 + b.data.ph * 0.15;
      b.play(on ? (b.team === 'tex' ? 'Celebrate' : 'Flex') : 'Idle', 0.4, 0.8 + b.data.ph * 0.4);
    }
    if (this.coach.data.left !== undefined && (this.coach.data.left -= 0.4) <= 0) { delete this.coach.data.left; this.coach.play('Idle', 0.5); }
  }

  private simQB() {
    const q = this.qbA, s = this.state;
    if (!['PRESNAP', 'SNAP', 'POCKET', 'AIR', 'RUN', 'DEAD'].includes(s) || q.data.down) return;
    const c = this.w.camera.position;
    q.pos.set(c.x, 0, c.z); q.heading = this.camYaw();
    if (q.data.thrown) return;
    const moving = s === 'POCKET' && Math.hypot(this.stick[0], this.stick[1]) > 0.2;
    q.play(moving ? 'Run' : 'QBSet', 0.2, moving ? 0.7 : 1);
  }

  // ---------- instant replay ----------
  private snapFrame(out?: Float32Array) {
    const A = this.recActors;
    let n = 11;
    for (const a of A) n += 5 + a.bones.length * 7;
    const f = out && out.length === n ? out : new Float32Array(n);
    let i = 0;
    for (const a of A) {
      const o = a.obj;
      f[i++] = o.position.x; f[i++] = o.position.y; f[i++] = o.position.z; f[i++] = o.rotation.y; f[i++] = o.visible ? 1 : 0;
      for (const b of a.bones) {
        f[i++] = b.position.x; f[i++] = b.position.y; f[i++] = b.position.z;
        f[i++] = b.quaternion.x; f[i++] = b.quaternion.y; f[i++] = b.quaternion.z; f[i++] = b.quaternion.w;
      }
    }
    const fb = this.w.football, jt = this.jumboCamTarget;
    f.set([fb.position.x, fb.position.y, fb.position.z, fb.quaternion.x, fb.quaternion.y, fb.quaternion.z, fb.quaternion.w, fb.visible ? 1 : 0, jt.x, jt.y, jt.z], i);
    return f;
  }

  private loadFrame(a: Float32Array, b?: Float32Array, k = 0) {
    const v = (j: number) => (b ? a[j] + (b[j] - a[j]) * k : a[j]);
    let i = 0;
    for (const ac of this.recActors) {
      const o = ac.obj;
      o.position.set(v(i), v(i + 1), v(i + 2));
      const r0 = a[i + 3], r1 = b ? b[i + 3] : r0;
      o.rotation.y = r0 + Math.atan2(Math.sin(r1 - r0), Math.cos(r1 - r0)) * k;
      o.visible = a[i + 4] > 0.5;
      i += 5;
      for (const bn of ac.bones) { bn.position.set(v(i), v(i + 1), v(i + 2)); bn.quaternion.set(v(i + 3), v(i + 4), v(i + 5), v(i + 6)).normalize(); i += 7; }
    }
    const fb = this.w.football;
    fb.position.set(v(i), v(i + 1), v(i + 2)); fb.quaternion.set(v(i + 3), v(i + 4), v(i + 5), v(i + 6)).normalize(); fb.visible = a[i + 7] > 0.5;
    return new THREE.Vector3(v(i + 8), v(i + 9), v(i + 10));
  }

  private startReplay(t0: number, t1 = this.playT) {
    if (this.rec.length < 10) return;
    let a = this.recT.findIndex(t => t >= t0); if (a < 0) a = 0;
    let b = this.recT.length - 1; while (b > a && this.recT[b] > t1) b--;
    if (b - a < 8) return;
    this.replay = { a, b, f: a };
    this.w.replayHook = this.replayHook;
    this.w.jumboReplay();
    this.jumboUntil = 0;
  }

  rating() {
    const s = this.stats;
    if (!s.att) return 0;
    const c = (a: number) => Math.max(0, Math.min(2.375, a));
    const r = (c((s.comp / s.att - 0.3) * 5) + c((s.yds / s.att - 3) * 0.25) + c(s.td / s.att * 20) + c(2.375 - s.int / s.att * 25)) / 6 * 100;
    return Math.round(r * 10) / 10;
  }

  // ---------- pulse + cameras ----------
  private updatePulse(dt: number) {
    const drive = 1 - this.ballOn / 45;
    const late = this.down >= 3 ? 0.2 : 0;
    const playing = this.state !== 'TITLE' && this.state !== 'OVER';
    const clutchT = (this.down === 4 ? 0.3 : 0) + (this.toGo < 3 && this.down > 1 ? 0.15 : 0) + (this.clock < 30 ? 0.3 : this.clock < 60 ? 0.12 : 0);
    const clutchO = (this.down === 4 ? 0.25 : 0) + (this.clock < 30 ? 0.2 : 0);
    let tex = playing ? 0.25 + 0.25 * drive + late + 0.15 * this.pressure + clutchT : 0.3;
    let ou = playing ? 0.18 + (this.down >= 3 ? 0.18 : 0) + 0.2 * this.pressure + clutchO : 0.2;
    if (this.state === 'OVER') { tex = this.win ? 1 : 0.05; ou = this.win ? 0.05 : 1; }
    this.spikeTex = Math.max(0, this.spikeTex - dt / 7);
    this.spikeOU = Math.max(0, this.spikeOU - dt / 6);
    const tgtT = Math.min(1, tex + this.spikeTex), tgtO = Math.min(1, ou + this.spikeOU);
    this.hypeTex += (tgtT - this.hypeTex) * Math.min(1, dt * 3);
    this.hypeOU += (tgtO - this.hypeOU) * Math.min(1, dt * 3);
    this.w.setPulse(this.hypeTex, this.hypeOU, performance.now() / 1000);
    if (this.waveT >= 0) {
      this.waveT += dt;
      this.w.crowdUniforms.uWave.value = -Math.PI + this.waveT * 1.4;
      if (this.waveT > 4.6) { this.waveT = -1; this.w.crowdUniforms.uWave.value = -10; }
    }
    this.audio.pulse(Math.max(this.hypeTex, this.hypeOU), this.state === 'POCKET' ? this.pressure : 0);
    this.w.post.mat.uniforms.uPressure.value = this.state === 'POCKET' ? this.pressure : 0;
    if (this.jumboUntil && this.t > this.jumboUntil && this.state !== 'CUTSCENE') { this.jumboUntil = 0; this.w.jumboLive(); }
  }

  private updateCamera(dt: number) {
    const cam = this.w.camera;
    const s = this.state;
    if (s === 'POCKET' || s === 'SNAP') {
      const look = new THREE.Vector3(Math.sin(this.aimYaw) * 22, 1.5, this.losZ + Math.cos(this.aimYaw) * 22);
      this.lookAt.lerp(look, Math.min(1, dt * 10));
    } else if (s === 'AIR') {
      const base = new THREE.Vector3(0, 1.5, this.losZ + 22);
      const tg = this.ball.target;
      const focus = tg && this.timeScale < 0.7 ? tg.pos.clone().setY(1.4).lerp(this.ball.pos, 0.4) : base.lerp(this.ball.pos, 0.55);
      this.lookAt.lerp(focus, Math.min(1, dt * 6));
    } else if ((s === 'RUN' || s === 'DEAD') && this.carrier) {
      this.lookAt.lerp(this.carrier.pos.clone().setY(1.2), Math.min(1, dt * 4));
    }
    if ((s === 'DEAD' || s === 'SACK') && this.continueBall && this.ball.pos.y > 0.05) {
      const b = this.ball;
      b.vel.y -= G * dt; b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y < 0.12) { b.pos.y = 0.12; b.vel.multiplyScalar(0.5); b.vel.y = Math.abs(b.vel.y) * 0.4; }
      this.w.football.position.copy(b.pos);
    }
    if (s !== 'TITLE' && s !== 'OVER') cam.lookAt(this.lookAt);
    // jumbotron broadcast camera: high sideline, follows the ball
    const focus = this.state === 'SACK' ? this.def.get(this.rusher)!.pos : this.state === 'RUN' || this.state === 'CUTSCENE' ? this.carrier?.pos ?? this.ball.pos : this.ball.live ? this.ball.pos : new THREE.Vector3(0, 0, this.losZ + 4);
    this.jumboCamTarget.lerp(focus, Math.min(1, dt * 3));
    const close = this.state === 'CUTSCENE' || (this.state === 'SACK' && this.t > 1.9);
    this.w.jumboCam.position.set(close ? this.jumboCamTarget.x + 9 : 58, close ? 3 : 24, this.jumboCamTarget.z - (close ? 6 : 10));
    this.w.jumboCam.fov = close ? 34 : 28;
    this.w.jumboCam.updateProjectionMatrix();
    this.w.jumboCam.lookAt(this.jumboCamTarget.x, 1, this.jumboCamTarget.z);
  }
}

const ARM_REST = new THREE.Vector3(0.25, -0.17, -0.7);
type ArmKey = { t: number; p: THREE.Vector3; q: THREE.Quaternion };
const armKey = (t: number, p: [number, number, number], r: [number, number, number]): ArmKey =>
  ({ t, p: new THREE.Vector3(...p), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ')) });
// release -> whip over the top -> pronated follow-through across the body to the left hip
const THROW_KEYS: ArmKey[] = [armKey(0, [0, 0, 0], [0, 0, 0]), armKey(0.06, [0.16, 0.03, -0.92], [-0.25, 0.1, -0.35]),
  armKey(0.15, [0.03, -0.2, -0.82], [-0.9, 0.35, -0.9]), armKey(0.3, [-0.2, -0.48, -0.62], [-1.35, 0.6, -1.25]),
  armKey(0.5, [-0.3, -0.9, -0.5], [-1.5, 0.6, -1.3])];
const PUMP_KEYS: ArmKey[] = [armKey(0, [0, 0, 0], [0, 0, 0]), armKey(0.09, [0.2, -0.02, -0.86], [-0.2, 0.05, -0.15]),
  armKey(0.28, [0.25, -0.17, -0.7], [0, 0, 0])];

/** Launch angle (low arc) to cover horizontal range R with height change h at speed v; raises v if out of reach. */
export function solve(R: number, h: number, v: number) {
  const g = G;
  const vmin2 = g * (h + Math.sqrt(h * h + R * R));
  if (v * v < vmin2 * 1.02) v = Math.sqrt(vmin2 * 1.05);
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * R * R + 2 * h * v2);
  const th = Math.atan((v2 - Math.sqrt(Math.max(0, disc))) / (g * Math.max(0.5, R)));
  return { v, th };
}
function rangeOf(v: number, th: number, h: number) {
  const vy = v * Math.sin(th), vx = v * Math.cos(th);
  const T = (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, h))) / G;
  return vx * T;
}

/** 1 = released right at peak arm speed (0..40 ms after), falls to 0 by ~150 ms off. */
export function releaseQuality(timingMs: number) {
  const err = Math.max(0, Math.abs(timingMs - 15) - 30);
  return Math.max(0, 1 - err / 120);
}
function releaseText(t: number, q: number) {
  if (q > 0.85) return 'RELEASE PERFECT';
  return `RELEASE ${Math.abs(Math.round(t))} MS ${t > 15 ? 'LATE' : 'EARLY'}`;
}
