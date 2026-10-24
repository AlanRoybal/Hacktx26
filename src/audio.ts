/** Web Audio graph: music / crowd / sfx buses -> compressor. Crowd opens up (gain + low-pass) with the pulse. */
const CLIPS = ['crowd_bed', 'crowd_roar', 'crowd_ooh', 'crowd_boo', 'texas_fight', 'eyes_of_texas', 'wabash', 'march_grandioso',
  'boomer_sooner', 'cannon', 'whistle', 'hit_pads', 'whoosh', 'catch_thud', 'heartbeat', 'horn', 'cadence',
  'grunt', 'grunt2', 'helmet_hit', 'thud', 'ear_ring'] as const;
export type Clip = typeof CLIPS[number];
// broadcast calls: public/audio/call_<kind>_<i>.ogg
const CALLS = { td: 3, int: 2, sack: 2, big: 2, catch: 2, first: 2, drop: 2, pbu: 2, inc: 1, flag: 1, fourth: 2, final: 1,
  scramble: 1, timeout: 1, spike: 1, intro: 1, win: 1, lose: 1 };
export type Call = keyof typeof CALLS;
const CALL_FILES = Object.entries(CALLS).flatMap(([k, n]) => Array.from({ length: n }, (_, i) => `call_${k}_${i}`));

export class Audio {
  ctx = new AudioContext({ latencyHint: 'interactive' });
  buf = new Map<string, AudioBuffer>();
  master = this.ctx.createDynamicsCompressor();
  music = this.ctx.createGain();
  crowd = this.ctx.createGain();
  sfx = this.ctx.createGain();
  crowdLP = this.ctx.createBiquadFilter();
  heart = this.ctx.createGain();
  voice = this.ctx.createGain();
  private voiceSrc: AudioBufferSourceNode | null = null;
  private voiceUntil = 0;
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
    this.voice.connect(this.master);
    this.voice.gain.value = 1.35;
    this.heart.gain.value = 0;
    this.master.connect(this.ctx.destination);
    this.music.gain.value = 0.55;
  }

  async load() {
    await Promise.all([...CLIPS, ...CALL_FILES].map(async n => {
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

  /** Play-by-play line. Lower-priority calls wait their turn instead of talking over the current one. */
  call(kind: Call, priority = false, delay = 0.15) {
    if (!this.started) return;
    const b = this.buf.get(`call_${kind}_${Math.floor(Math.random() * CALLS[kind])}`);
    if (!b) return;
    const now = this.ctx.currentTime;
    if (now < this.voiceUntil && !priority) return;
    try { this.voiceSrc?.stop(); } catch { /* already done */ }
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.connect(this.voice);
    src.start(now + delay);
    this.voiceSrc = src;
    this.voiceUntil = now + delay + b.duration;
    this.music.gain.setTargetAtTime(0.18, now, 0.15);
    this.music.gain.setTargetAtTime(0.5, now + delay + b.duration, 0.6);
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
