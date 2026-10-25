import * as THREE from 'three';
import { Madgwick } from './fusion';
import type { InputListener, Sample, ThrowEvent } from './types';

const NINTENDO = 0x057e, JC_L = 0x2006, JC_R = 0x2007;
const ACC = 0.000244;   // g / LSB
const GYR = 0.06103;    // deg/s / LSB
const NEUTRAL = [0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40];
const RING = 400;

/** Joy-Con sensor frame -> game hand frame (x right, y up, -z forward when held like a ball).
 * VERIFY ON DEVICE: if the hand moves on the wrong axis, change this mapping only. */
const SENSOR_TO_HAND = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

export class JoyCon {
  samples: Sample[] = [];
  head = 0;
  fusion = new Madgwick();
  bias = [0, 0, 0];
  trig = false;
  lastReport = 0;
  reports = 0;
  battery = 0;
  stick = [0, 0];
  shoulder = false;
  /** face = A (R) / down (L), menu = plus (R) / minus (L), stickClick = stick press */
  btn = { face: false, menu: false, stickClick: false };
  private counter = 0;
  private tPrev = 0;
  private calib: number[][] = [];
  isLeft: boolean;

  constructor(public dev: HIDDevice, private emit: (jc: JoyCon, s: Sample) => void) {
    this.isLeft = dev.productId === JC_L;
  }

  async start() {
    if (!this.dev.opened) await this.dev.open();
    this.dev.addEventListener('inputreport', e => this.onReport(e as HIDInputReportEvent));
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
    await this.sub(0x40, [0x01]); await wait(60);   // IMU on
    await this.sub(0x48, [0x01]); await wait(60);   // vibration on
    await this.sub(0x03, [0x30]); await wait(60);   // standard full mode, 0x30 @ ~66 Hz
  }

  private sub(cmd: number, args: number[]) {
    const d = new Uint8Array(10 + args.length);
    d[0] = this.counter++ & 0x0f;
    d.set(NEUTRAL, 1);
    d[9] = cmd;
    d.set(args, 10);
    return this.dev.sendReport(0x01, d);
  }

  rumble(freqLow: number, freqHigh: number, amp: number) {
    const d = new Uint8Array(9);
    d[0] = this.counter++ & 0x0f;
    const enc = encodeRumble(freqLow, freqHigh, amp);
    d.set(enc, 1);
    d.set(enc, 5);
    this.dev.sendReport(0x10, d).catch(() => {});
  }

  private patT = 0;
  buzz(ms: number, amp = 0.8, f = 160) {
    clearTimeout(this.patT);
    this.rumble(f, f * 2, amp);
    this.patT = window.setTimeout(() => this.rumble(160, 320, 0), ms);
  }

  /** Sequence of [ms, amp, freq] steps (amp 0 = gap). */
  pattern(steps: [number, number, number][]) {
    clearTimeout(this.patT);
    let i = 0;
    const next = () => {
      if (i >= steps.length) { this.rumble(160, 320, 0); return; }
      const [ms, amp, f] = steps[i++];
      this.rumble(f, f * 2, amp);
      this.patT = window.setTimeout(next, ms);
    };
    next();
  }

  private onReport(e: HIDInputReportEvent) {
    if (e.reportId !== 0x30) return;
    const now = performance.now();
    const d = e.data;
    this.lastReport = now;
    this.reports++;
    this.battery = d.getUint8(1) >> 5;
    const right = d.getUint8(2), left = d.getUint8(4);
    const trig = this.isLeft ? (left & 0x80) !== 0 : (right & 0x80) !== 0;
    this.shoulder = this.isLeft ? (left & 0x40) !== 0 : (right & 0x40) !== 0;
    const shared = d.getUint8(3);
    this.btn = this.isLeft
      ? { face: (left & 0x01) !== 0, menu: (shared & 0x01) !== 0, stickClick: (shared & 0x08) !== 0 }
      : { face: (right & 0x08) !== 0, menu: (shared & 0x02) !== 0, stickClick: (shared & 0x04) !== 0 };
    const so = this.isLeft ? 5 : 8;
    const sx = d.getUint8(so) | ((d.getUint8(so + 1) & 0x0f) << 8);
    const sy = (d.getUint8(so + 1) >> 4) | (d.getUint8(so + 2) << 4);
    this.stick = [(sx - 2048) / 1400, (sy - 2048) / 1400];
    for (let k = 0; k < 3; k++) {
      const o = 12 + k * 12;
      const s: Sample = {
        t: now - (2 - k) * 5,
        ax: d.getInt16(o, true) * ACC, ay: d.getInt16(o + 2, true) * ACC, az: d.getInt16(o + 4, true) * ACC,
        gx: d.getInt16(o + 6, true) * GYR - this.bias[0], gy: d.getInt16(o + 8, true) * GYR - this.bias[1],
        gz: d.getInt16(o + 10, true) * GYR - this.bias[2], trig,
      };
      if (this.isLeft) { s.gy = -s.gy; s.gz = -s.gz; s.ay = -s.ay; }
      if (this.calib.length < 300 && Math.hypot(s.gx, s.gy, s.gz) < 6) this.calib.push([s.gx, s.gy, s.gz]);
      if (this.calib.length === 300) this.finishCalib();
      const dt = this.tPrev ? Math.min(0.02, (s.t - this.tPrev) / 1000) : 0.005;
      this.tPrev = s.t;
      const r = Math.PI / 180;
      this.fusion.update(s.gx * r, s.gy * r, s.gz * r, s.ax, s.ay, s.az, dt);
      this.samples[this.head] = s;
      this.head = (this.head + 1) % RING;
      this.emit(this, s);
    }
  }

  /** Auto gyro-bias: first 1.5 s of being still. Press C to redo it. */
  private finishCalib() {
    for (let i = 0; i < 3; i++) this.bias[i] += this.calib.reduce((a, c) => a + c[i], 0) / this.calib.length;
    this.calib.push([0, 0, 0]);
  }
  recalibrate() { this.calib = []; }

  window(t0: number, t1: number) {
    const out: Sample[] = [];
    for (let i = 0; i < RING; i++) {
      const s = this.samples[(this.head + i) % RING];
      if (s && s.t >= t0 && s.t <= t1) out.push(s);
    }
    return out;
  }

  handQuat(out: THREE.Quaternion) { return out.copy(this.fusion.q).multiply(SENSOR_TO_HAND); }
}

function encodeRumble(lf: number, hf: number, amp: number): number[] {
  if (amp <= 0) return [0x00, 0x01, 0x40, 0x40];
  lf = Math.min(626, Math.max(41, lf));
  hf = Math.min(1252, Math.max(82, hf));
  amp = Math.min(1, amp);
  const hfe = (Math.round(32 * Math.log2(hf * 0.1)) - 0x60) * 4;
  const lfe = Math.round(32 * Math.log2(lf * 0.1)) - 0x40;
  let a: number;
  if (amp > 0.23) a = Math.round(Math.log2(amp * 8.7) * 32);
  else if (amp > 0.12) a = Math.round(Math.log2(amp * 17) * 16);
  else a = Math.round(((Math.log2(amp * 1000) * 32) - 96) / (5 - amp * amp) - 1);
  a = Math.max(0, Math.min(100, a));
  const hfAmp = a * 2;
  let lfAmp = 0x40 + (a >> 1);
  const odd = a & 1;
  return [hfe & 0xff, ((hfe >> 8) & 0xff) + hfAmp, (lfe & 0xff) + (odd ? 0x80 : 0), lfAmp & 0xff];
}

/** Throw detector: IDLE -> ARMED (trigger held) -> RELEASED -> COOLDOWN (600 ms). */
export class JoyConInput {
  pads = new Map<string, JoyCon>();
  active: JoyCon | null = null;
  armed = false;
  cooldownUntil = 0;
  snapYaw = 0;
  enabled = true;
  recording: Sample[] | null = null;
  lastThrow: (ThrowEvent & { tPeak: number }) | null = null;
  private tmpQ = new THREE.Quaternion();
  private q0 = new THREE.Quaternion();

  constructor(private l: InputListener) {}

  get supported() { return 'hid' in navigator; }

  async connect(gesture = false) {
    if (!this.supported) return;
    const hid = navigator.hid;
    let devs = await hid.getDevices();
    if (gesture) {
      for (const pid of [JC_R, JC_L]) {
        if (devs.some(d => d.productId === pid)) continue;
        try { devs = devs.concat(await hid.requestDevice({ filters: [{ vendorId: NINTENDO, productId: pid }] })); } catch { /* none */ }
      }
    }
    for (const d of devs) {
      if (d.vendorId !== NINTENDO || this.pads.has(String(d.productId))) continue;
      const jc = new JoyCon(d, (j, s) => this.onSample(j, s));
      this.pads.set(String(d.productId), jc);
      await jc.start().catch(err => console.warn('joycon start', err));
    }
    hid.onconnect = () => this.connect(false);
  }

  /** Whichever trigger the player holds becomes the throwing hand; stalled pad hands off after 2 s. */
  private onSample(jc: JoyCon, s: Sample) {
    if (this.recording) this.recording.push({ ...s, t: Math.round(s.t * 10) / 10 });
    const want = (this as any).preferHand as string | undefined;
    if (want === 'R' || want === 'L') { const match = [...this.pads.values()].some(p => p.isLeft === (want === 'L') && performance.now() - p.lastReport < 300); if (match && jc.isLeft !== (want === 'L')) return; }
    const stale = !this.active || performance.now() - this.active.lastReport > 2000;
    if ((stale || (s.trig && !this.armed)) && this.active !== jc && (s.trig || stale)) this.active = jc;
    if (jc !== this.active || !this.enabled) return;
    const now = performance.now();
    if (s.trig && !this.armed && now > this.cooldownUntil) { this.armed = true; this.l.onTrigger(true); }
    else if (!s.trig && this.armed) { this.armed = false; this.l.onTrigger(false); this.release(jc, s.t); this.cooldownUntil = now + 600; }
  }

  recenter() {
    if (this.active) this.active.handQuat(this.q0);
    this.snapYaw = 0;
  }

  /** Hand orientation relative to the snap, in the camera's frame. */
  relativeHand(out: THREE.Quaternion) {
    if (!this.active) return out.identity();
    this.active.handQuat(this.tmpQ);
    return out.copy(this.q0).invert().multiply(this.tmpQ);
  }

  connected() { return this.active ? performance.now() - this.active.lastReport < 150 : false; }

  private release(jc: JoyCon, tr: number) {
    const W = jc.window(tr - 250, tr + 1);
    if (W.length < 5) return;
    let wPeak = 0, tPeak = tr, iPeak = 0;
    W.forEach((s, i) => { const w = Math.hypot(s.gx, s.gy, s.gz); if (w > wPeak) { wPeak = w; tPeak = s.t; iPeak = i; } });
    if (wPeak < 250) { this.l.onPumpFake(); return; }
    // wobble: gyro energy off the main rotation axis around the peak
    const ax = new THREE.Vector3(W[iPeak].gx, W[iPeak].gy, W[iPeak].gz).normalize();
    let off = 0, n = 0;
    for (const s of W) if (s.t > tPeak - 60 && s.t < tPeak + 30) {
      const g = new THREE.Vector3(s.gx, s.gy, s.gz);
      off += g.sub(ax.clone().multiplyScalar(g.dot(ax))).lengthSq(); n++;
    }
    const wobble = Math.min(1, Math.sqrt(off / Math.max(1, n)) / wPeak);
    const rel = this.relativeHand(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(rel);
    const yawRel = Math.atan2(-fwd.x, -fwd.z) * 180 / Math.PI;
    const pitchRel = Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 180 / Math.PI;
    const timing = tr - tPeak;
    const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    let speed = 9 + 18 * sm(250, 1600, wPeak);
    let launch = Math.min(50, Math.max(3, 8 + 0.9 * pitchRel));
    const terr = Math.max(0, Math.abs(timing) - 40);
    speed *= 1 - Math.min(0.2, terr / 400);
    launch += Math.sign(timing) * -Math.min(10, terr / 12);
    if (wobble > 0.35) speed *= 0.85;
    const ev: ThrowEvent = { speed, launchDeg: launch, yawDeg: Math.max(-55, Math.min(55, 1.6 * yawRel)), wobble, timingMs: timing, wPeak, source: 'joycon' };
    this.lastThrow = { ...ev, tPeak };
    this.l.onThrow(ev);
  }

  buzz(ms: number, amp = 0.8) { this.active?.buzz(ms, amp); }
  /** Rumble pattern on the throwing Joy-Con, or on every live Joy-Con for big moments. */
  pattern(steps: [number, number, number][], both = false) {
    const now = performance.now();
    for (const p of both ? this.pads.values() : this.active ? [this.active] : []) if (now - p.lastReport < 300) p.pattern(steps);
  }
}
