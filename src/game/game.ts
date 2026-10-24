import * as THREE from 'three';
import { World, YD, OU_GOAL_Z, mulberry } from '../render/world';
import { Actor } from '../render/players';
import { PLAYS, OFF_SPOT, DEF_SPOT, OFF_NUM, DEF_NUM, ELIGIBLE, type Play, type OffPos, type DefPos } from './plays';
import type { ThrowEvent } from '../input/types';
import type { Audio } from '../audio';

export type State = 'TITLE' | 'PRESNAP' | 'SNAP' | 'POCKET' | 'AIR' | 'RUN' | 'SACK' | 'DEAD' | 'CUTSCENE' | 'OVER';
type Result = { kind: 'catch' | 'inc' | 'int' | 'sack' | 'fumble' | 'td'; yards: number; time: number; oob?: boolean; why?: string };

export interface Hooks {
  banner(text: string, sub?: string, color?: string): void;
  hud(g: Game): void;
  buzz(ms: number, amp?: number): void;
  statCard(lines: string[]): void;
  screen(kind: 'title' | 'over' | 'none', g: Game): void;
  plays(sel: number, show: boolean): void;
}

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
  stats = { att: 0, comp: 0, yds: 0, td: 0, int: 0, sacks: 0, bestSpiral: 1, lastPlay: '' };
  playIdx = 0;
  play: Play = PLAYS[0];
  off = new Map<OffPos, Actor>();
  def = new Map<DefPos, Actor>();
  qb = v3();
  ball = { pos: v3(), vel: v3(), spin: 0, wobble: 0, live: false, target: null as Actor | null, aim: v3(), throwT: 0, bounced: false, data: null as { missed: boolean } | null };
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
  armSwing = -1;
  lookAt = v3();
  handQ = new THREE.Quaternion();
  aimYaw = 0;          // camera look-off from the controller (rad)
  rng = mulberry(Date.now() & 0xffff);
  private jumboUntil = 0;
  private jumboCamTarget = v3();

  constructor(public w: World, public audio: Audio, public h: Hooks) {
    OFF.forEach(p => { const a = new Actor('tex', OFF_NUM[p]); a.role = p; this.off.set(p, a); w.scene.add(a.obj); });
    DEF.forEach(p => { const a = new Actor('ou', DEF_NUM[p]); a.role = p; this.def.set(p, a); w.scene.add(a.obj); });
    this.toTitle();
  }

  get losZ() { return OU_GOAL_Z - this.ballOn * YD; }
  get all() { return [...this.off.values(), ...this.def.values()]; }

  // ---------- flow ----------
  toTitle() {
    this.state = 'TITLE'; this.t = 0;
    this.resetDrive();
    this.setupPlay();
    this.h.screen('title', this);
    this.audio.playMusic('march_grandioso');
  }

  resetDrive() {
    Object.assign(this, { clock: 105, down: 1, toGo: 10, ballOn: 45, tex: 27, ou: 31, spikeTex: 0, spikeOU: 0 });
    this.stats = { att: 0, comp: 0, yds: 0, td: 0, int: 0, sacks: 0, bestSpiral: 1, lastPlay: '' };
  }

  start() {
    this.audio.start();
    this.resetDrive();
    this.h.screen('none', this);
    this.h.banner('TEXAS BALL', `OU ${this.ballOn}  |  DOWN 4  |  1:45 LEFT`);
    this.audio.playMusic('wabash', false);
    this.toPresnap();
  }

  toPresnap() {
    this.state = 'PRESNAP'; this.t = 0;
    this.playIdx = this.down >= 3 && this.toGo > 7 ? 2 + Math.floor(this.rng() * 2) : Math.floor(this.rng() * PLAYS.length);
    this.setupPlay();
    this.h.plays(this.playIdx, true);
    this.h.hud(this);
    this.audio.duck(true);
    if (this.down >= 3) {
      this.w.drawJumbo([`${['', '1ST', '2ND', '3RD', '4TH'][this.down]} DOWN`, 'MAKE SOME NOISE']);
      this.jumboUntil = 4;
      this.spikeTex = Math.max(this.spikeTex, 0.35);
      this.waveT = 0;
    } else { this.w.jumboLive(); this.jumboUntil = 0; }
  }

  pickPlay(i: number) {
    if (this.state !== 'PRESNAP') return;
    this.playIdx = (i + PLAYS.length) % PLAYS.length;
    this.setupPlay();
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
    OFF.forEach(p => this.speedMul.set(p, 0.95 + this.rng() * 0.1));
    for (const [p, a] of this.off) {
      const [x, y] = OFF_SPOT[p];
      a.pos.set(x * YD, 0, z + y * YD); a.vel.set(0, 0, 0); a.heading = 0; a.obj.rotation.y = 0; a.data = {};
      a.play(['LT', 'LG', 'C', 'RG', 'RT'].includes(p) ? 'Stance3pt' : 'Idle', 0.01);
    }
    for (const [p, a] of this.def) {
      let [x, y] = DEF_SPOT[p];
      const man = this.play.coverage[p]?.man;
      if (man && ['WR1', 'WR2', 'WR3'].includes(man)) x = OFF_SPOT[man][0] + (p === 'NB' ? 0.5 : 0);
      a.pos.set(x * YD, 0, z + y * YD); a.vel.set(0, 0, 0); a.heading = Math.PI; a.obj.rotation.y = Math.PI; a.data = {};
      a.play(p.startsWith('D') ? 'Stance3pt' : 'Idle', 0.01);
    }
    this.all.forEach(a => a.update(0));
    this.ball.live = false; this.ball.target = null; this.carrier = null; this.result = null;
    this.ball.pos.set(0, 0.15, z);
    this.w.football.position.copy(this.ball.pos);
    this.w.football.rotation.set(0, 0, 0);
    this.w.football.visible = true;
    this.w.fpArm.visible = false;
    this.pressure = 0; this.armSwing = -1; this.aimYaw = 0;
    this.lookAt.set(0, 1.5, z + 22);
    this.w.camera.position.copy(this.qb);
    this.w.camera.up.set(0, 1, 0);
    this.w.camera.lookAt(this.lookAt);
  }

  onTrigger(down: boolean) {
    if (down && (this.state === 'TITLE' || (this.state === 'OVER' && this.t > 2))) return this.start();
    if (down && this.state === 'PRESNAP' && this.t > 0.6) this.snap();
    if (down && this.state === 'CUTSCENE' && this.t > 1.5) this.t = 99;
  }

  snap() {
    this.state = 'SNAP'; this.t = 0; this.playT = 0;
    this.h.plays(this.playIdx, false);
    this.audio.play('cadence', 0.9);
    this.audio.duck(false);
    this.w.jumboLive();
    this.h.buzz(80, 0.6);
    this.stats.lastPlay = this.play.name;
  }

  onPumpFake() {
    if (this.state !== 'POCKET') return;
    for (const p of ['S1', 'S2', 'CB1', 'CB2'] as DefPos[]) this.def.get(p)!.data.bite = 0.5;
    this.armSwing = 0.3;
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
      const k = this.assist;
      yaw = yaw + Math.atan2(Math.sin(best.yaw - yaw), Math.cos(best.yaw - yaw)) * k;
      th = th + (best.th - th) * k;
      v = v + (best.v - v) * k;
      this.ball.target = best.a;
      this.ball.aim.copy(best.p);
    } else this.ball.target = null;
    const b = this.ball;
    b.pos.copy(hand);
    b.vel.set(Math.sin(yaw) * Math.cos(th), Math.sin(th), Math.cos(yaw) * Math.cos(th)).multiplyScalar(v);
    b.wobble = e.wobble; b.spin = 0; b.live = true; b.throwT = 0; b.bounced = false; b.data = null;
    this.w.football.visible = true;
    this.w.fpArm.visible = true;
    this.armSwing = 0;
    this.state = 'AIR'; this.t = 0;
    this.stats.att++;
    this.stats.bestSpiral = Math.min(this.stats.bestSpiral, e.wobble);
    this.audio.play('whoosh', 0.9, 0.9 + v / 60);
    this.h.buzz(40, 0.5);
    const grade = e.wobble < 0.08 ? 'A' : e.wobble < 0.16 ? 'B' : e.wobble < 0.3 ? 'C' : 'DUCK';
    this.h.statCard([`${Math.round(v * 2.237)} MPH`, `${Math.round(THREE.MathUtils.radToDeg(th))}° LAUNCH`, `SPIRAL ${grade}`,
      e.source === 'joycon' ? `RELEASE ${Math.abs(Math.round(e.timingMs))} MS ${e.timingMs > 0 ? 'LATE' : 'EARLY'}` : e.source.toUpperCase()]);
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

  step(dt: number) {
    this.t += dt;
    const s = this.state;
    if (s === 'TITLE' || s === 'OVER') {
      const a = this.t * 0.07;
      this.w.camera.position.set(Math.sin(a) * 55, 48, Math.cos(a) * 75);
      this.w.camera.lookAt(0, 0, 0);
    }
    if (s === 'PRESNAP') this.presnapIdle();
    if (s === 'SNAP') {
      const f = Math.min(1, this.t / 0.35);
      const hand = this.handPos();
      this.ball.pos.set(0, 0.2, this.losZ).lerp(hand, f);
      this.ball.pos.y += Math.sin(f * Math.PI) * 0.4;
      this.w.football.position.copy(this.ball.pos);
      if (f >= 1) { this.w.football.visible = false; this.w.fpArm.visible = true; this.state = 'POCKET'; this.t = 0; }
    }
    if (['SNAP', 'POCKET', 'AIR', 'RUN', 'SACK'].includes(s)) { this.playT += dt; this.simPlayers(dt); }
    if (s === 'POCKET') this.pocket(dt);
    if (s === 'AIR') this.air(dt);
    if (s === 'RUN') this.run(dt);
    if (s === 'SACK') this.sack(dt);
    if (s === 'DEAD' && this.t > 1.8) this.applyResult();
    if (s === 'CUTSCENE') this.cutscene(dt);
    if (s === 'OVER' && this.t > 1 && this.t - dt <= 1) this.h.screen('over', this);
    if (s !== 'SACK') this.w.post.mat.uniforms.uFlash.value *= Math.max(0, 1 - dt * 3);
    this.updatePulse(dt);
    this.updateCamera(dt);
    this.all.forEach(a => a.update(dt));
    if (this.armSwing >= 0) {
      this.armSwing += dt / 0.28;
      const k = Math.sin(Math.min(1, this.armSwing) * Math.PI);
      this.w.fpArm.position.set(0.25, -0.17 + 0.12 * k, -0.7 - 0.35 * k);
      this.w.fpArm.rotation.x = -1.0 * k;
      if (this.armSwing > 0.5 && this.state !== 'POCKET') this.w.fpArm.visible = this.armSwing < 1;
      if (this.armSwing >= 1) { this.armSwing = -1; this.w.fpArm.position.set(0.25, -0.17, -0.7); this.w.fpArm.rotation.x = 0; }
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
      if (a.data.done) continue;
      if (p === this.rusher && t > this.sackT - 0.8 && this.state === 'POCKET') {
        this.moveTo(a, this.qb.clone().setY(0), 6.8, dt);
        a.play('Run', 0.15, 1.2); a.face(this.qb);
      } else {
        a.pos.z = Math.max(z - 1.6 - 1.2 * this.pressure, a.pos.z - 0.5 * dt);
        if (p === this.rusher) a.pos.x += (Math.sign(a.pos.x) * 4.2 - a.pos.x) * dt * 0.6;
        a.play('Rush', 0.25); a.heading = Math.PI;
      }
    }
    // coverage
    for (const p of ['LB1', 'LB2', 'CB1', 'CB2', 'NB', 'S1', 'S2'] as DefPos[]) {
      const a = this.def.get(p)!;
      if (a === this.carrier || a.data.done) continue;
      const c = this.play.coverage[p] ?? {};
      if (this.ball.data?.missed) a.data.jumper = false;
      let goal: THREE.Vector3;
      let vmax = 8.6;
      if (this.state === 'RUN' && this.carrier) { goal = this.carrier.pos.clone(); vmax = 8.9; }
      else if (this.state === 'AIR' && a.data.jumper) { goal = this.ballLanding(1.3); vmax = 9.2; }
      else if (c.man) {
        const jump = this.jumped === c.man;
        if (jump) a.data.jumper = true;
        const lag = (jump ? 0.05 : c.lag ?? 0.3) + (a.data.bite ?? 0);
        goal = this.routePos(c.man, Math.max(0, t - lag));
        goal.z += (jump ? 0.3 : c.cushion ?? 1.5);
        goal.x += jump ? -Math.sign(goal.x) * 0.5 : Math.sign(goal.x || 1) * 0.8;
        if (c.man === 'RB' || c.man === 'TE') vmax = 7.6;
      } else {
        const [zx, zy] = c.zone ?? [0, 10];
        goal = new THREE.Vector3(zx * YD, 0, z + zy * YD);
        let near: Actor | null = null, nd = 12;
        for (const r of ELIGIBLE) { const ra = this.off.get(r)!; const d = ra.pos.distanceTo(goal); if (d < nd) { nd = d; near = ra; } }
        if (near && t > 1) goal.lerp(near.pos, 0.6);
        if (a.data.bite > 0) goal.z -= 4;
        vmax = 7.4;
      }
      if (a.data.bite > 0) a.data.bite -= dt;
      if (t > 0.15) this.moveTo(a, goal, vmax, dt);
      this.animByVel(a, Math.PI);
      if (this.state === 'AIR' && a.data.jumper) a.face(this.ball.pos);
    }
  }

  private pocket(dt: number) {
    const drop = Math.min(1, this.t / 0.8);
    this.w.camera.position.set(this.qb.x, this.qb.y + Math.sin(this.t * 9) * 0.02 * (1 - drop), this.qb.z - 1.4 * drop);
    this.pressure = THREE.MathUtils.clamp(1 - (this.sackT - this.playT) / 1.5, 0, 1);
    if (this.pressure > 0 && Math.floor((this.t - dt) * (2 + 5 * this.pressure)) !== Math.floor(this.t * (2 + 5 * this.pressure)))
      this.h.buzz(50, 0.3 + 0.5 * this.pressure);
    const r = this.def.get(this.rusher)!;
    const cam = this.w.camera.position;
    if (Math.hypot(r.pos.x - cam.x, r.pos.z - cam.z) < 1.3) this.startSack();
  }

  private startSack() {
    this.state = 'SACK'; this.t = 0;
    const r = this.def.get(this.rusher)!;
    r.play('Tackle', 0.1, 1, true);
    this.w.shake = 0.35;
    this.w.post.mat.uniforms.uFlash.value = 0.35;
    this.audio.play('hit_pads', 1);
    this.audio.play('crowd_roar', 0.5, 0.9, 'crowd');
    this.h.buzz(300, 1);
    this.spikeOU = 0.9;
    this.w.fpArm.visible = false;
    const fumble = this.rng() < 0.12, lost = fumble && this.rng() < 0.5;
    this.stats.sacks++;
    this.result = { kind: lost ? 'fumble' : 'sack', yards: -7, time: this.playT + 5 };
    this.h.banner(lost ? 'FUMBLE' : 'SACKED', lost ? 'OKLAHOMA RECOVERS' : fumble ? 'TEXAS RECOVERS' : '-7 YARDS', '#841617');
  }

  private sack(dt: number) {
    const f = Math.min(1, this.t / 0.5);
    const cam = this.w.camera;
    cam.position.y = THREE.MathUtils.lerp(cam.position.y, 0.45, f * 0.3);
    cam.up.set(Math.sin(f * 0.9), Math.cos(f * 0.9), 0);
    this.w.post.mat.uniforms.uFlash.value *= 0.9;
    for (const p of ['DE1', 'DE2'] as DefPos[]) this.def.get(p)!.vel.multiplyScalar(0.9);
    if (this.t > 0.6 && this.result?.kind === 'fumble') this.def.get(this.rusher)!.play('HornsDown', 0.3);
    if (this.t > 1.3) this.toDead();
    void dt;
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
    // catch / INT check: closest player in range gets the first chance
    const chest = (a: Actor) => a.pos.clone().setY(1.35).distanceTo(b.pos);
    const defs = [...this.def.values()];
    let who: Actor | null = null, wd = 99;
    if (b.pos.y > 0.4 && b.pos.y < 2.9) {
      for (const p of ELIGIBLE) { const r = this.off.get(p)!; const d = chest(r); if (d < 1.35 && d < wd) { wd = d; who = r; } }
      if (b.vel.y < 0 && b.pos.y < 2.5) for (const d of defs) { const dd = chest(d); if (dd < 1.0 && dd < wd) { wd = dd; who = d; } }
    }
    if (who && who.team === 'tex') {
      const r = who;
      const closeDef = defs.filter(d => d.pos.distanceTo(r.pos) < 1.2);
      const contest = closeDef.length > 0 ? 1 : 0;
      const v = b.vel.length();
      const defCloser = closeDef.some(d => chest(d) < wd);
      if (contest && defCloser && this.rng() < 0.25 + 0.3 * b.wobble) return this.intercept(closeDef[0]);
      const pCatch = 0.95 - 0.25 * b.wobble - 0.3 * Math.max(0, (v - 24) / 6) - 0.3 * contest;
      if (Math.abs(r.pos.x) >= HALF_W) return this.incomplete('OUT OF BOUNDS');
      if (this.rng() < pCatch) return this.catchBall(r);
      return this.incomplete(contest ? 'BROKEN UP' : 'DROPPED');
    }
    if (who && who.team === 'ou' && !b.data?.missed) {
      const r = this.rng();
      if (r < (who.data.jumper ? 0.55 : 0.25)) return this.intercept(who);
      if (r < 0.75) return this.incomplete('BROKEN UP');
      (b as any).data = { missed: true };
    }
    if (b.pos.y < 0.12) {
      if (!b.bounced) { b.bounced = true; b.vel.multiplyScalar(0.35); b.vel.y = Math.abs(b.vel.y) * 0.6; b.pos.y = 0.12; this.incomplete('INCOMPLETE', false); }
    }
  }

  private catchBall(r: Actor) {
    this.state = 'RUN'; this.t = 0;
    this.carrier = r;
    this.ball.live = false;
    r.play('CatchHigh', 0.1, 1.4, true);
    this.stats.comp++;
    const [a, b] = this.play.yac[r.role as OffPos] ?? [1, 6];
    const contested = [...this.def.values()].some(d => d.pos.distanceTo(r.pos) < 2);
    this.yacGoal = r.pos.z + (a + this.rng() * (b - a)) * YD * (contested ? 0.4 : 1);
    this.audio.play('catch_thud', 1);
    this.audio.play('crowd_roar', 0.7, 1, 'crowd');
    this.h.buzz(60, 0.6); setTimeout(() => this.h.buzz(60, 0.6), 120);
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
    this.spikeOU = 1;
    this.w.drawJumbo(['INTERCEPTED'], '#841617', '#FDF9D8');
    this.h.banner('INTERCEPTED', `#${d.number} ${d.role}`, '#841617');
    this.h.buzz(300, 1);
  }

  private incomplete(why: string, stopBall = true) {
    if (stopBall) { this.ball.vel.multiplyScalar(-0.2); this.ball.vel.y = 2; }
    this.state = 'DEAD'; this.t = 0;
    this.result = { kind: 'inc', yards: 0, time: this.playT, why };
    this.audio.play('whistle', 0.7);
    this.audio.play('crowd_ooh', 0.8, 1, 'crowd');
    this.spikeOU = 0.35;
    this.h.banner('INCOMPLETE', why);
    this.continueBall = !stopBall;
  }
  private continueBall = false;

  private run(dt: number) {
    const c = this.carrier!;
    const isInt = this.result?.kind === 'int';
    if (this.t < 0.35) { c.vel.multiplyScalar(0.85); c.pos.addScaledVector(c.vel, dt); }
    else {
      const goal = new THREE.Vector3(c.pos.x * 0.98, 0, isInt ? c.pos.z - 10 : c.pos.z + 10);
      this.moveTo(c, goal, 8.4, dt);
      c.play('Run', 0.15, 1.3); c.face(goal);
    }
    this.ball.pos.copy(c.pos).add(new THREE.Vector3(0.25, 1.15, 0.1));
    this.w.football.position.copy(this.ball.pos);
    if (!isInt && c.pos.z >= OU_GOAL_Z + 0.5) return this.touchdown(c);
    const oob = Math.abs(c.pos.x) > HALF_W;
    const done = isInt ? c.pos.z <= this.yacGoal || this.t > 2.6 : c.pos.z >= this.yacGoal || oob;
    if (done && this.t > 0.6) {
      const tackler = [...(isInt ? this.off.values() : this.def.values())].sort((a, b) => a.pos.distanceTo(c.pos) - b.pos.distanceTo(c.pos))[0];
      if (!oob) { tackler.pos.copy(c.pos).add(new THREE.Vector3(0.4, 0, isInt ? -0.6 : 0.7)); tackler.face(c.pos); tackler.play('Tackle', 0.1, 1, true); tackler.data.done = true; }
      c.play('Fall', 0.1, 1, true); c.data.done = true;
      c.vel.set(0, 0, 0);
      this.audio.play('hit_pads', 0.9);
      this.audio.play('whistle', 0.6);
      this.w.shake = 0.08;
      if (isInt) { this.toDead(); return; }
      const yards = Math.round((c.pos.z - this.losZ) / YD);
      this.result = { kind: 'catch', yards, time: this.playT + (oob ? 0 : 6), oob };
      this.stats.yds += yards;
      const first = yards >= this.toGo;
      this.h.banner(first ? 'FIRST DOWN' : `+${yards} YARDS`, `${c.role} #${c.number}`, '#BF5700');
      if (first) { this.audio.play('horn', 0.7); this.w.drawJumbo(['FIRST', 'DOWN']); this.jumboUntil = this.t + 3.5; this.spikeTex = Math.max(this.spikeTex, 0.7); }
      this.toDead();
    }
  }

  private toDead() { this.state = 'DEAD'; this.t = 0; this.w.fpArm.visible = false; }

  private touchdown(c: Actor) {
    const yards = Math.round((OU_GOAL_Z - this.losZ) / YD);
    this.stats.yds += yards; this.stats.td++;
    this.result = { kind: 'td', yards, time: this.playT };
    this.state = 'CUTSCENE'; this.t = 0;
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
    for (const t of [0, 450, 900]) setTimeout(() => this.h.buzz(260, 1), t);
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
    if (this.t > 2.2) this.w.jumboMode = 'live';   // jumbotron shows the celebration cam
    if (this.t > 2.2 && this.t < 2.3) this.w.jumboLive();
    if (this.t > 7.5) this.gameOver(true);
  }

  private applyResult() {
    const r = this.result!;
    this.w.camera.up.set(0, 1, 0);
    if (r.kind === 'int' || r.kind === 'fumble') return this.gameOver(false, r.kind === 'int' ? 'INTERCEPTED' : 'FUMBLE LOST');
    this.clock -= Math.ceil(r.time);
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
    this.h.hud(this);
    if (win) this.audio.playMusic('eyes_of_texas', false);
    else { this.audio.play('crowd_boo', 0.6, 1, 'crowd'); if (why !== 'INTERCEPTED') this.audio.playMusic('boomer_sooner', false); }
    this.w.jumboLive();
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
    let tex = playing ? 0.25 + 0.25 * drive + late + 0.15 * this.pressure : 0.3;
    let ou = playing ? 0.18 + (this.down >= 3 ? 0.18 : 0) + 0.2 * this.pressure : 0.2;
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
      this.lookAt.lerp(base.lerp(this.ball.pos, 0.55), Math.min(1, dt * 6));
    } else if ((s === 'RUN' || s === 'DEAD') && this.carrier) {
      this.lookAt.lerp(this.carrier.pos.clone().setY(1.2), Math.min(1, dt * 4));
    }
    if (s === 'DEAD' && this.continueBall && this.ball.pos.y > 0.05) {
      const b = this.ball;
      b.vel.y -= G * dt; b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y < 0.12) { b.pos.y = 0.12; b.vel.multiplyScalar(0.5); b.vel.y = Math.abs(b.vel.y) * 0.4; }
      this.w.football.position.copy(b.pos);
    }
    if (s !== 'TITLE' && s !== 'OVER') cam.lookAt(this.lookAt);
    if (s === 'POCKET' && this.w.fpArm.visible && this.armSwing < 0) this.w.fpArm.quaternion.slerp(this.handQ, 1);
    // jumbotron broadcast camera: high sideline, follows the ball
    const focus = this.state === 'RUN' || this.state === 'CUTSCENE' ? this.carrier?.pos ?? this.ball.pos : this.ball.live ? this.ball.pos : new THREE.Vector3(0, 0, this.losZ + 4);
    this.jumboCamTarget.lerp(focus, Math.min(1, dt * 3));
    const close = this.state === 'CUTSCENE';
    this.w.jumboCam.position.set(close ? this.jumboCamTarget.x + 9 : 58, close ? 3 : 24, this.jumboCamTarget.z - (close ? 6 : 10));
    this.w.jumboCam.fov = close ? 34 : 28;
    this.w.jumboCam.updateProjectionMatrix();
    this.w.jumboCam.lookAt(this.jumboCamTarget.x, 1, this.jumboCamTarget.z);
  }
}

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
