/** Web Audio graph: music / crowd / sfx buses -> compressor. Crowd opens up (gain + low-pass) with the pulse. */
const CLIPS = ['crowd_bed', 'crowd_roar', 'crowd_ooh', 'crowd_boo', 'texas_fight', 'eyes_of_texas', 'wabash', 'march_grandioso',
  'boomer_sooner', 'cannon', 'whistle', 'hit_pads', 'whoosh', 'catch_thud', 'heartbeat', 'horn', 'cadence',
  'grunt', 'grunt2', 'helmet_hit', 'thud', 'ear_ring'] as const;
export type Clip = typeof CLIPS[number];

export class Audio {
  ctx = new AudioContext({ latencyHint: 'interactive' });
  buf = new Map<string, AudioBuffer>();
  master = this.ctx.createDynamicsCompressor();
  music = this.ctx.createGain();
  crowd = this.ctx.createGain();
  sfx = this.ctx.createGain();
  crowdLP = this.ctx.createBiquadFilter();
  heart = this.ctx.createGain();
  private musicSrc: { src: AudioBufferSourceNode; g: GainNode } | null = null;
  private musicName = '';
  private started = false;
  private muffleUntil = 0;
  /** Dazed after a sack: crowd goes muffled for a moment. */
  muffle(sec: number) { this.muffleUntil = this.ctx.currentTime + sec; }

  constructor() {
    this.crowdLP.type = 'lowpass';
    this.crowd.connect(this.crowdLP).connect(this.master);
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.heart.connect(this.master);
    this.heart.gain.value = 0;
    this.master.connect(this.ctx.destination);
    this.music.gain.value = 0.55;
  }

  async load() {
    await Promise.all(CLIPS.map(async n => {
      try {
        const r = await fetch(`audio/${n}.ogg`);
        if (r.ok) this.buf.set(n, await this.ctx.decodeAudioData(await r.arrayBuffer()));
      } catch { /* missing clip: silent */ }
    }));
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.ctx.resume();
    this.loop('crowd_bed', this.crowd, 1);
    this.loop('heartbeat', this.heart, 1);
  }

  private loop(name: string, bus: AudioNode, gain: number) {
    const b = this.buf.get(name);
    if (!b) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(bus);
    s.start();
  }

  play(name: Clip, gain = 1, rate = 1, bus: 'sfx' | 'crowd' = 'sfx') {
    const b = this.buf.get(name);
    if (!b || !this.started) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(bus === 'sfx' ? this.sfx : this.crowd);
    s.start();
  }

  playMusic(name: Clip, loop = true, gain = 1) {
    if (this.musicName === name || !this.started) return;
    this.stopMusic();
    const b = this.buf.get(name);
    if (!b) return;
    const src = this.ctx.createBufferSource();
    src.buffer = b; src.loop = loop;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, this.ctx.currentTime + 0.6);
    src.connect(g).connect(this.music);
    src.start();
    src.onended = () => { if (this.musicSrc?.src === src) { this.musicSrc = null; this.musicName = ''; } };
    this.musicSrc = { src, g };
    this.musicName = name;
  }

  stopMusic(fade = 0.8) {
    if (!this.musicSrc) return;
    const { src, g } = this.musicSrc;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + fade);
    src.stop(t + fade + 0.05);
    this.musicSrc = null; this.musicName = '';
  }

  duck(on: boolean) { this.music.gain.setTargetAtTime(on ? 0.22 : 0.55, this.ctx.currentTime, 0.3); }

  /** hype 0..1, pressure 0..1 */
  pulse(hype: number, pressure: number) {
    const t = this.ctx.currentTime;
    this.crowd.gain.setTargetAtTime(Math.pow(10, (-14 + 14 * hype) / 20) * 1.6, t, 0.25);
    this.crowdLP.frequency.setTargetAtTime(t < this.muffleUntil ? 320 : 1200 * Math.pow(10, hype), t, t < this.muffleUntil ? 0.05 : 0.4);
    this.heart.gain.setTargetAtTime(pressure > 0.35 ? (pressure - 0.35) * 1.4 : 0, t, 0.1);
  }
}
