import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Jets } from './jets';
import { Beams } from './beams';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const YD = 0.9144;
export const OU_GOAL_Z = 50 * YD;           // three +z = toward the OU end zone (blender -y)
const PYLON_X = 24.4;
const SUN_DIR = new THREE.Vector3(-0.7, 0.42, -0.5).normalize();
const PROP_SPOTS: Record<string, [number, number, number]> = {   // three x, z, yaw
  goalpost_home: [0, 60 * YD, Math.PI], goalpost_away: [0, -60 * YD, 0],
  pylon_0: [-PYLON_X, 50 * YD, 0], pylon_1: [PYLON_X, 50 * YD, 0], pylon_2: [-PYLON_X, 60 * YD, 0], pylon_3: [PYLON_X, 60 * YD, 0],
  pylon_4: [-PYLON_X, -50 * YD, 0], pylon_5: [PYLON_X, -50 * YD, 0], pylon_6: [-PYLON_X, -60 * YD, 0], pylon_7: [PYLON_X, -60 * YD, 0],
  chains: [26, 0, Math.PI], down_marker: [-26, 0, 0], bench_texas: [-31.5, 0, 0], bench_ou: [31.5, 0, Math.PI],
  smokey: [-27, 58 * YD, THREE.MathUtils.degToRad(-120)],
};
const INTERNAL_W = 960, INTERNAL_H = 540;

const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
export const loadGLB = (n: string) => loader.loadAsync(`models/${n}.glb`);
export function loadTex(n: string, repeat = false) {
  const t = texLoader.load(`textures/${n}`);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Low-res render + one post pass: Bayer dither, posterize, grain, vignette, pocket-pressure red edge. */
const TRAIL_N = 32;

function makePost() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: null }, uTime: { value: 0 }, uPressure: { value: 0 }, uFlash: { value: 0 }, uDaze: { value: 0 }, uTunnel: { value: 0 },
      uRes: { value: new THREE.Vector2(INTERNAL_W, INTERNAL_H) }, uPixel: { value: 1 }, tUI: { value: null }, uUI: { value: 0 },
      uUIRes: { value: new THREE.Vector2(640, 360) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `
      uniform sampler2D tScene, tUI; uniform float uTime, uPressure, uFlash, uPixel, uDaze, uUI, uTunnel; uniform vec2 uRes, uUIRes; varying vec2 vUv;
      float bayer(vec2 p){ int x=int(mod(p.x,4.)), y=int(mod(p.y,4.)); int i=x+y*4;
        int m[16]=int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5); return float(m[i])/16.-.5; }
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        vec3 c = texture2D(tScene, vUv).rgb;
        if (uDaze > .01) {   // double vision + desaturate after a hit
          vec3 c2 = texture2D(tScene, vUv + vec2(.018, .006) * uDaze * (1. + .4*sin(uTime*7.))).rgb;
          c = mix(c, (c + c2) * .5, uDaze);
          c = mix(c, vec3(dot(c, vec3(.3,.59,.11))), uDaze * .6);
        }
        if (uTunnel > .01) {   // clutch tunnel vision: edges blur, drain and close in
          vec2 dv = vUv - .5;
          float e = smoothstep(mix(.55, .08, uTunnel), mix(.75, .45, uTunnel), length(dv * vec2(1.3, 1.))) * min(1., uTunnel * 1.25);
          vec3 bl = (texture2D(tScene, vUv + dv * .09 * e).rgb + texture2D(tScene, vUv - dv * .09 * e).rgb
            + texture2D(tScene, vUv + vec2(dv.y, -dv.x) * .07 * e).rgb) / 3.;
          c = mix(c, bl, e);
          c = mix(c, vec3(dot(c, vec3(.3,.59,.11))), e * .6);
          c *= 1. - e * .93;
        }
        if (uUI > .5) {   // menu UI: chunky pixels, eroded print, row tear, then the same dither and grain as the scene
          vec2 d0 = vUv - .5;
          c *= mix(.7, .22, smoothstep(.0, .7, length(d0)));
          vec2 q = floor(vUv * uUIRes);
          float row = q.y, tear = step(.997, h(vec2(row * .37, floor(uTime * 9.))));
          q.x += tear * floor((h(vec2(row, floor(uTime * 9.))) - .5) * 14.);
          vec4 u = texture2D(tUI, (q + .5) / uUIRes);
          float wear = h(floor(q / 2.) + 7.3), scratch = step(.993, h(vec2(floor(q.x / 1.), floor(q.y / 40.))));
          vec3 uc = u.rgb / max(u.a, .001);
          float ink = step(.4, u.a) * step(.12, max(uc.r, max(uc.g, uc.b)));   // letters get the worn print, dark backing panels stay clean
          float thick = step(.4, texture2D(tUI, (q + vec2(2.5, .5)) / uUIRes).a) * step(.4, texture2D(tUI, (q + vec2(-1.5, .5)) / uUIRes).a)
            * step(.4, texture2D(tUI, (q + vec2(.5, 2.5)) / uUIRes).a) * step(.4, texture2D(tUI, (q + vec2(.5, -1.5)) / uUIRes).a);
          float a = mix(u.a, mix(1., step(.05, wear) * (1. - scratch * .6), thick), ink);   // thin small-print strokes stay solid
          uc *= mix(1., .86 + .14 * h(floor(q / 3.) + 1.7), ink);
          uc *= .9 + .1 * mod(q.y, 2.);
          vec4 ur = texture2D(tUI, (q + vec2(1.5, .5)) / uUIRes);
          c += vec3(.35, 0., 0.) * step(.4, ur.a) * (1. - ink) * (1. - u.a) * .6;
          c = mix(c, uc, a);
        }
        if (uPixel > .5) {
          vec2 px = floor(vUv*uRes);
          float lv = 32.;
          c = floor(c*lv + bayer(px)*0.9 + .5)/lv;
          c += (h(px + fract(uTime)*91.) - .5) * mix(.045, .012, step(.5, uUI));
        }
        vec2 d = vUv - .5;
        float vig = smoothstep(.85, .25, length(d*vec2(1.1,1.)));
        c *= mix(.55, 1., vig);
        c *= 1. - uDaze * .75 * (1. - vig * .7);
        c = mix(c, vec3(.6,.02,.02), uPressure * (1.-vig) * .7);
        c += uFlash;
        gl_FragColor = vec4(c, 1.);
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  return { mat, scene, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
}

interface CrowdPart { mesh: THREE.InstancedMesh; }

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 600);
  rt = new THREE.WebGLRenderTarget(INTERNAL_W, INTERNAL_H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, samples: 0 });
  post = makePost();
  uiCanvas = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
  uiCtx = this.uiCanvas.getContext('2d')!;
  uiTex = (() => { const t = new THREE.CanvasTexture(this.uiCanvas); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.premultiplyAlpha = false; return t; })();
  showUI(on: boolean) { this.post.mat.uniforms.uUI.value = on ? 1 : 0; this.post.mat.uniforms.tUI.value = this.uiTex; if (on) this.uiTex.needsUpdate = true; }
  // jumbotron: second camera into its own target, shown on the 'screen' mesh
  jumboCam = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 400);
  jumboRT = new THREE.WebGLRenderTarget(512, 288);
  jumboMode: 'live' | 'graphic' | 'replay' = 'live';
  /** Swaps actors to a recorded frame for the jumbotron render, then puts them back. */
  replayHook: { apply(): void; restore(): void } | null = null;
  private replayTag!: THREE.Mesh;
  flag!: THREE.Mesh;
  jumboGraphic!: THREE.CanvasTexture;
  private jumboCanvas = document.createElement('canvas');
  private screenMat!: THREE.MeshBasicMaterial;
  private ribbonMats: THREE.MeshBasicMaterial[] = [];
  private fairLights: THREE.MeshStandardMaterial[] = [];
  private rrrLogo = (() => { const i = new Image(); i.src = 'textures/rrr_Allstate_Red_River_Rivalry_logo.png'; return i; })();
  private ribbonTex = { calm: loadTex('ribbon_calm.png', true), hype: loadTex('ribbon_hype.png', true) };
  private lampShow: THREE.MeshStandardMaterial[] = [];
  private lamp: THREE.MeshStandardMaterial[] = [];
  private beamFx = new Beams();
  private showLights: THREE.SpotLight[] = [];
  private towerLights: THREE.SpotLight[] = [];
  crowd: CrowdPart[] = [];
  jets = new Jets();
  crowdUniforms = { uTime: { value: 0 }, uHypeTex: { value: 0 }, uHypeOU: { value: 0 }, uWave: { value: -10 } };
  mosaicU = { value: 0 };
  mosaicTarget = 1;
  props!: GLTF;
  football!: THREE.Object3D;
  fpArm!: THREE.Group;
  private armMats = new Map<string, [THREE.MeshStandardMaterial, THREE.Color]>();
  fpBall: THREE.Object3D | null = null;
  /** Static stadium (stands, crowd, lights, props). Turned 180° so a 1v1 offense drives toward the other end. */
  env = new THREE.Group();
  flipped = false;
  /** OU QB: white road jersey, crimson gloves and wristband. */
  setArmTeam(team: 'tex' | 'ou') {
    const OU: Record<string, string> = { jersey: '#EDEAE2', gloves: '#841617', wristband: '#841617', skin: '#C08A64' };
    for (const [n, [m, c]] of this.armMats) {
      if (team === 'ou' && OU[n]) m.color.set(OU[n]); else m.color.copy(c);
    }
  }
  setFlip(f: boolean) { this.flipped = f; this.env.rotation.y = f ? Math.PI : 0; this.env.updateMatrixWorld(true); }
  placeChains(losZ: number, firstDownZ: number) {
    const c = this.propObjs.get('chains'), d = this.propObjs.get('down_marker');
    if (c) c.position.z = this.flipped ? -firstDownZ : firstDownZ - 10 * YD;
    if (d) d.position.z = this.flipped ? -losZ : losZ;
  }
  propObjs = new Map<string, THREE.Object3D>();
  shake = 0;
  pixel = true;
  frame = 0;

  private fx: { pts: THREE.Points; vel: Float32Array; age: number; life: number; grav: number }[] = [];
  private fxT = 0;
  private fxTex?: THREE.Texture;
  /** Particle burst: fireworks (fast, falling, additive) or tunnel smoke (slow, rising). */
  burst(pos: THREE.Vector3, color: string, n = 140, speed = 10, grav = -5, size = 1.4, life = 2.2, additive = true) {
    const p = new Float32Array(n * 3), v = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p.set([pos.x, pos.y, pos.z], i * 3);
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = speed * (0.6 + Math.random() * 0.4);
      v.set([r * Math.cos(a) * sp, u * sp, r * Math.sin(a) * sp], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.fxTex ??= (() => {
      const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d')!;
      const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c);
    })();
    const m = new THREE.PointsMaterial({ color, size, map: this.fxTex, transparent: true, opacity: 1, fog: !additive, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false;
    this.scene.add(pts); this.fx.push({ pts, vel: v, age: 0, life, grav });
  }
  clearFx() {
    this.fx.forEach(f => { this.scene.remove(f.pts); f.pts.geometry.dispose(); (f.pts.material as THREE.Material).dispose(); });
    this.fx = [];
  }
  private updateFx(t: number) {
    const dt = Math.min(0.05, Math.max(0, t - this.fxT)); this.fxT = t;
    this.fx = this.fx.filter(f => {
      f.age += dt;
      const a = f.pts.geometry.attributes.position as THREE.BufferAttribute, P = a.array as Float32Array;
      for (let i = 0; i < P.length; i += 3) { f.vel[i + 1] += f.grav * dt; f.vel[i] *= 0.985; f.vel[i + 2] *= 0.985; P[i] += f.vel[i] * dt; P[i + 1] += f.vel[i + 1] * dt; P[i + 2] += f.vel[i + 2] * dt; }
      a.needsUpdate = true;
      (f.pts.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - f.age / f.life);
      if (f.age < f.life) return true;
      this.scene.remove(f.pts); f.pts.geometry.dispose(); (f.pts.material as THREE.Material).dispose(); return false;
    });
  }
  quality: 'low' | 'high' = 'high';
  /** Low: no shadow map, 60% of the crowd instances, smaller internal render target. */
  setQuality(q: 'low' | 'high') {
    this.quality = q;
    const low = q === 'low';
    this.towerLights.forEach((L, i) => { L.castShadow = !low && i === 0; });
    this.renderer.shadowMap.enabled = !low;
    for (const c of this.crowd) {
      const full = (c.mesh.userData.full ??= c.mesh.count) as number;
      c.mesh.count = low ? Math.floor(full * 0.6) : full;
    }
    this.rt.setSize(low ? 800 : INTERNAL_W, low ? 450 : INTERNAL_H);
    this.post.mat.uniforms.uRes.value.set(low ? 800 : INTERNAL_W, low ? 450 : INTERNAL_H);
    this.scene.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
  }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#E8B98C');
    this.scene.fog = new THREE.FogExp2('#E2B48C', 0.0032);
    this.scene.add(this.jets.group);
    this.scene.add(this.camera);
    this.scene.add(this.env);
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  async load(onProgress: (s: string) => void) {
    onProgress('stadium');
    const [stadium, props, ball, arm, seats, fair] = await Promise.all([
      loadGLB('stadium'), loadGLB('props'), loadGLB('football'), loadGLB('fp_arm'),
      fetch('models/crowd_seats.json').then(r => r.json()), loadGLB('fair')]);
    this.props = props;
    fair.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      let bt = false; m.traverseAncestors(a => { bt ||= a.name === 'big_tex'; });
      if (bt || m.name.startsWith('big_tex')) { mat.fog = false; mat.emissive.copy(mat.color); mat.emissiveMap = mat.map; mat.emissiveIntensity = 0.04; return; }
      if (mat.emissiveIntensity > 0 && mat.emissive.getHex()) { mat.fog = false; mat.emissiveIntensity = 4; this.fairLights.push(mat); }
    });
    this.env.add(fair.scene);
    for (const [x, z, c] of [[52, 150, '#FFE9C8'], [92, 152, '#FFD9A8'], [70, 140, '#FFFFFF']] as const) {   // Big Tex floodlights from the fairgrounds
      const L = new THREE.SpotLight(c, 1600, 140, THREE.MathUtils.degToRad(22), 0.5, 1.2);
      L.position.set(x, 3, z); L.target.position.set(70, 30, 175);
      this.env.add(L, L.target);
    }
    stadium.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.receiveShadow = m.name === 'field' || m.name === 'apron';
      const mat = m.material as THREE.MeshStandardMaterial;
      const name = mat.name;
      if (['screen', 'screen_ribbon', 'ribbon', 'screen_north'].includes(m.name)) {   // glTF v-down -> GL v-up for canvas/RT textures
        const uv = m.geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      }
      if (name === 'beam') {
        m.visible = false;   // replaced by Beams shafts
      } else if (name === 'screen' || name === 'screen_north') {
        const s = new THREE.MeshBasicMaterial({ map: name === 'screen' ? this.jumboRT.texture : loadTex('jumbo_idle.png'), fog: false, toneMapped: false });
        if (name === 'screen') this.screenMat = s;
        m.material = s;
      } else if (name === 'ribbon' || name === 'ribbon_jumbo') {
        const s = new THREE.MeshBasicMaterial({ map: this.ribbonTex.calm, fog: false, toneMapped: false });
        if (name === 'ribbon_jumbo') s.map = this.ribbonTex.calm.clone();
        m.material = s; this.ribbonMats.push(s);
      } else if (name === 'lamp' || name === 'lamp_show') {
        mat.fog = false; mat.emissiveIntensity = 6;
        (name === 'lamp' ? this.lamp : this.lampShow).push(mat);
      } else if (name === 'field') {
        mat.map!.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      }
    });
    this.env.add(stadium.scene);
    // jumbotron graphic canvas (TOUCHDOWN, 3RD DOWN, MAKE SOME NOISE)
    this.jumboCanvas.width = 640; this.jumboCanvas.height = 360;
    this.jumboGraphic = new THREE.CanvasTexture(this.jumboCanvas);
    this.jumboGraphic.colorSpace = THREE.SRGBColorSpace;
    const tc = document.createElement('canvas'); tc.width = 256; tc.height = 64;
    const tx = tc.getContext('2d')!;
    tx.fillStyle = '#BF5700'; tx.fillRect(0, 0, 256, 64); tx.fillStyle = '#fff'; tx.font = '900 46px Impact, sans-serif';
    tx.textAlign = 'center'; tx.textBaseline = 'middle'; tx.fillText('REPLAY', 128, 34);
    const tagTex = new THREE.CanvasTexture(tc); tagTex.colorSpace = THREE.SRGBColorSpace;
    this.replayTag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), new THREE.MeshBasicMaterial({ map: tagTex, depthTest: false, fog: false, toneMapped: false }));
    this.replayTag.position.set(-0.2, 0.17, -1);
    this.replayTag.renderOrder = 20; this.replayTag.layers.set(2); this.replayTag.visible = false;
    this.jumboCam.layers.enable(2);
    this.jumboCam.add(this.replayTag);
    this.scene.add(this.jumboCam);
    this.flag = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.32), new THREE.MeshStandardMaterial({ color: '#F2C21B', emissive: '#4a3a00', roughness: 0.8 }));
    this.flag.castShadow = true; this.flag.visible = false;
    this.scene.add(this.flag);
    // props
    for (const n of ['goalpost_home', 'goalpost_away', 'pylon_0', 'pylon_1', 'pylon_2', 'pylon_3', 'pylon_4', 'pylon_5', 'pylon_6', 'pylon_7',
      'chains', 'down_marker', 'bench_texas', 'bench_ou', 'smokey']) {
      const o = props.scene.getObjectByName(n);
      if (!o) continue;
      const c = o.clone();
      // blender (x, y, z) -> three (x, z, -y); goalposts sit on the end lines with the base behind
      const at = PROP_SPOTS[n] ?? [0, 0, 0];
      c.position.set(at[0], 0, at[1]);
      c.rotation.set(0, at[2], 0);
      this.propObjs.set(n, c);
      this.env.add(c);
    }
    this.football = ball.scene.getObjectByName('football')!;
    this.football.traverse(o => { (o as THREE.Mesh).castShadow = true; });
    this.scene.add(this.football);
    this.initTrail();
    // first-person arm: blender object coords -> camera space (same transform the Blender preview used)
    const R = new THREE.Matrix4().set(-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1)
      .multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(55)))
      .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-18)));
    const Cinv = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
    const inner = new THREE.Group();
    inner.add(arm.scene);
    inner.applyMatrix4(new THREE.Matrix4().multiplyMatrices(R, Cinv));
    this.fpBall = arm.scene.getObjectByName('fp_ball') ?? null;
    this.fpArm = new THREE.Group();
    this.fpArm.add(inner);
    this.fpArm.position.set(0.25, -0.17, -0.7);
    this.fpArm.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.fog = false; m.renderOrder = 10;
      this.armMats.set(mat.name, [mat, mat.color.clone()]);
    });
    this.camera.add(this.fpArm);
    onProgress('crowd');
    this.buildCrowd(seats.seats as number[][]);
    this.buildLights(stadium.scene);
  }

  private buildLights(stadium: THREE.Object3D) {
    this.scene.add(new THREE.HemisphereLight('#FFE2BD', '#6A5A40', 2.0));
    const sun = new THREE.DirectionalLight('#FFC78A', 4.5);   // late afternoon: low sun in the west, long shadows across the field
    sun.position.copy(SUN_DIR).multiplyScalar(160);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 420 });
    this.scene.add(sun, sun.target);
    const sky = new Sky(); sky.scale.setScalar(550);
    const su = sky.material.uniforms;
    su.turbidity.value = 9; su.rayleigh.value = 2.6; su.mieCoefficient.value = 0.01; su.mieDirectionalG.value = 0.85; su.sunPosition.value.copy(SUN_DIR);
    this.scene.add(sky);
    this.beamFx.group.visible = false;
    const SHOW = [[-30, -92, 14], [25, -94, 14], [-60, -30, 12], [60, -35, 12], [-58, 30, 12], [58, 40, 12], [-20, 95, 14], [30, 92, 14]]
      .map(([x, y, z]) => new THREE.Vector3(x, z, -y));
    this.env.add(this.beamFx.group);
    let glow: THREE.Texture | undefined;
    for (let i = 0; i < 4; i++) {
      const lamps = stadium.getObjectByName(`tower_${i}_lamps`)!;
      const head = new THREE.Box3().setFromObject(lamps).getCenter(new THREE.Vector3());
      const L = new THREE.SpotLight('#FFF0D6', 1500, 260, THREE.MathUtils.degToRad(30), 0.5, 1.6);
      L.position.copy(head);
      L.target.position.set(head.x * 0.15, 0, head.z * 0.35);
            this.env.add(L, L.target);
      this.towerLights.push(L);
      glow = this.beamFx.addTower(head, L.target.position, glow);
      for (const tg of [...SHOW].sort((a, b) => a.distanceTo(head) - b.distanceTo(head)).slice(0, 2)) {
        const S = new THREE.SpotLight('#FF6A14', 0, 200, THREE.MathUtils.degToRad(14), 0.35, 1.2);
        S.position.copy(head);
        S.target.position.copy(tg);
        S.userData.base = tg.clone();
        this.env.add(S, S.target);
        this.showLights.push(S);
        this.beamFx.addSpot();
      }
    }
  }

  /** One InstancedMesh per crowd primitive. Hype pose = glTF morph 'hype' blended per fan in the vertex shader,
   * driven by the team's pulse uniform, a per-fan threshold, a jump and a wave front. */
  private buildCrowd(seats: number[][]) {
    const rnd = mulberry(7);
    const base = seats.length;
    const extra: number[][] = [];
    for (const [team, x0] of [[0, -22], [1, 6]] as const)
      for (let r = 0; r < 5; r++) for (let c = 0; c < 14; c++) extra.push([x0 + c * 1.15 + (r % 2) * 0.5, 56.8 + r * 0.95, 0, Math.PI, team]);
    const bandIdx = extra.map((_, i) => base + i);
    const cheerStart = base + extra.length;
    for (const [team, x, yaw] of [[0, -26.6, Math.PI / 2], [1, 26.6, -Math.PI / 2]] as const)
      for (let k = 0; k < 8; k++) extra.push([x, -27 - k * 2.3, 0, yaw, team]);
    const cheerIdx = extra.slice(bandIdx.length).map((_, i) => cheerStart + i);
    const all = seats.concat(extra);
    const signIdx: number[] = [], fanIdx: number[] = [], jerseyIdx: number[] = [], cowboyIdx: number[] = [];
    seats.slice(0, base).forEach((_, i) => { const r = rnd(); (r < 0.12 ? signIdx : r < 0.27 ? jerseyIdx : r < 0.37 ? cowboyIdx : fanIdx).push(i); });
    const HAIR = ['#1A120C', '#3B2414', '#6B4A2B', '#0E0E0E', '#A8803F'].map(c => new THREE.Color(c));
    const PANTS = ['#2E3A4E', '#1C2230', '#5A5246', '#20201E'].map(c => new THREE.Color(c));
    const HATS = ['#C8A672', '#1A1A1A', '#EDE6D6', '#6B4A2B', '#D9C08F'].map(c => new THREE.Color(c));
    const JERSEY_NUMS = [[16, 16, 1, 8, 0, 3], [10, 10, 1, 4, 8, 2]];
    const teamCol = [new THREE.Color('#BF5700'), new THREE.Color('#841617')];
    const shirtCol = (team: number) => { const r = rnd(); return r < 0.72 ? teamCol[team] : r < 0.9 ? new THREE.Color('#E8E4DA') : new THREE.Color('#1A1A1A'); };
    seats = all;
    const build = (name: string, idx: number[], colorFn?: (team: number, k: number) => THREE.Color, hatFn?: (team: number) => THREE.Color) => {
      const tmpl = this.props.scene.getObjectByName(name)!;
      const meshes: THREE.Mesh[] = [];
      tmpl.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const mats: THREE.Matrix4[] = [], phase = new Float32Array(idx.length * 4), shirts: THREE.Color[] = [], hats: THREE.Color[] = [];
      const cell = new Float32Array(idx.length * 2);
      idx.forEach((si, k) => {
        const [x, y, z, yaw, team] = seats[si];
        const s = 0.9 + rnd() * 0.18;
        mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, z, -y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
          new THREE.Vector3(s, s, s)));
        phase.set([rnd() * 6.28, rnd() * 0.6, team, Math.atan2(-y, x)], k * 4);
        if (name === 'crowd_jersey') {
          const n = JERSEY_NUMS[team][Math.floor(rnd() * 6)];
          cell.set([(n % 10 - 6) / 10, (Math.floor(n / 10) - 1) / 10], k * 2);
          shirts.push(teamCol[team]);
        } else {
          cell.set([0.25 * Math.floor(rnd() * 4), -0.5 * team], k * 2);
          shirts.push(colorFn ? colorFn(team, k) : shirtCol(team));
        }
        hats.push(hatFn ? hatFn(team) : HATS[Math.floor(rnd() * HATS.length)]);
      });
      for (const m of meshes) {
        const g = m.geometry.clone();
        const delta = g.morphAttributes.position?.[0];
        g.setAttribute('aHype', delta ? delta.clone() : new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
        g.morphAttributes = {};
        g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 4));
        g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2));
        const src = m.material as THREE.MeshStandardMaterial;
        const isSign = src.name === 'crowd_sign', isSkin = src.name === 'crowd_skin', own = ['crowd_hair', 'crowd_pants', 'crowd_shoe'].includes(src.name);
        const mat = new THREE.MeshLambertMaterial({ map: src.map, color: isSign ? '#ffffff' : src.color });
        mat.onBeforeCompile = sh => {
          Object.assign(sh.uniforms, this.crowdUniforms);
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', `#include <common>
              attribute vec3 aHype; attribute vec4 aPhase; attribute vec2 aCell;
              uniform float uTime, uHypeTex, uHypeOU, uWave;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              float hp = aPhase.z > .5 ? uHypeOU : uHypeTex;
              float wave = exp(-pow((aPhase.w - uWave) * 3., 2.));
              float w = clamp((hp - aPhase.y) * 2.5, 0., 1.);
              w = max(w, wave);
              transformed += aHype * w;
              transformed.y += w * abs(sin(uTime * (7. + 2. * aPhase.y) + aPhase.x)) * .22 + wave * .3;`)
            .replace('#include <uv_vertex>', `#include <uv_vertex>
              #ifdef USE_MAP
              vMapUv += aCell;
              #endif`);
        };
        mat.customProgramCacheKey = () => 'crowd' + (isSign ? 's' : '');
        const im = new THREE.InstancedMesh(g, mat, idx.length);
        const white = new THREE.Color('#F2EEE6');
        mats.forEach((M, k) => {
          im.setMatrixAt(k, M);
          if (src.name === 'crowd_hat' || src.name === 'crowd_pom') im.setColorAt(k, hats[k]);
          else if (own) im.setColorAt(k, src.name === 'crowd_hair' ? HAIR[k % HAIR.length] : src.name === 'crowd_pants' ? PANTS[k % PANTS.length] : new THREE.Color('#F2F0EA'));
          else if (src.name === 'crowd_number' || src.name === 'crowd_stripe') im.setColorAt(k, white);
          else if (!isSign && !isSkin) im.setColorAt(k, shirts[k]);
        });
        if (isSkin) idx.forEach((_, k) => im.setColorAt(k, new THREE.Color(['#8A5A3C', '#C08A64', '#5E3B26', '#D9A784'][k % 4]).multiplyScalar(2.2)));
        im.frustumCulled = false;
        this.env.add(im);
        this.crowd.push({ mesh: im });
      }
    };
    build('crowd_unit', fanIdx);
    build('crowd_sign', signIdx);
    build('crowd_jersey', jerseyIdx);
    build('crowd_cowboy', cowboyIdx);
    const white = new THREE.Color('#EDE9E0');
    build('crowd_cowboy', bandIdx, team => teamCol[team], team => team ? new THREE.Color('#841617') : white);
    build('crowd_cheer', cheerIdx, team => teamCol[team], team => (rnd() < 0.5 ? new THREE.Color('#F2EEE6') : teamCol[team]));
    this.buildMosaic(seats.slice(0, base));
  }

  /** Card stunt: the lower section of each end zone holds up cards that form the Freetail Hackers logo, all game. */
  private buildMosaic(seats: number[][]) {
    const all = seats.map(([x, y, z, yaw]) => ({ x, h: z, z: -y, yaw }));
    for (const end of [1, -1]) this.buildMosaicEnd(all.filter(p => p.z * end > 55 && Math.abs(p.x) < 21), end);
  }

  private buildMosaicEnd(pts: { x: number; h: number; z: number; yaw: number }[], end: number) {
    if (!pts.length) return;
    const h0 = Math.min(...pts.map(p => p.h)), band = 10;
    const sel = pts.filter(p => p.h < h0 + band);
    const img = new Image();
    img.src = 'textures/freetail_logo.png';
    img.onload = () => {
      const W = 48, H = 24, cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const c = cv.getContext('2d')!;
      const pad = 0.12, aw = W * (1 - 2 * pad), ah = aw * img.height / img.width;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) c.drawImage(img, W * pad + dx, (H - ah) / 2 + dy, aw, ah);   // thicken thin strokes
      const px = c.getImageData(0, 0, W, H).data;
      const g = new THREE.PlaneGeometry(0.9, 0.75);
      const delay = new Float32Array(sel.length);
      const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, toneMapped: false });
      mat.onBeforeCompile = sh => {
        sh.uniforms.uMosaic = this.mosaicU;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aDelay; uniform float uMosaic;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat mk = clamp(uMosaic * 1.8 - aDelay, 0., 1.); transformed.y *= mk; transformed.x *= min(1., mk * 3.);');
      };
      const im = new THREE.InstancedMesh(g, mat, sel.length);
      const orange = new THREE.Color('#BF5700').multiplyScalar(1.1), white = new THREE.Color('#F4EFE6').multiplyScalar(1.25);
      sel.forEach((p, k) => {
        const u = (p.x + 21) / 42, v = 1 - (p.h - h0) / band;
        const i = (Math.min(H - 1, Math.floor(v * H)) * W + Math.min(W - 1, Math.floor((end > 0 ? 1 - u : u) * W))) * 4;
        const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        const pos = new THREE.Vector3(p.x, p.h + 1.2, p.z).addScaledVector(fwd, 0.3);
        im.setMatrixAt(k, new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(1, 1, 1)));
        im.setColorAt(k, px[i + 3] > 110 ? white : orange);
        delay[k] = (1 - v) * 0.6 + Math.random() * 0.15;
      });
      g.setAttribute('aDelay', new THREE.InstancedBufferAttribute(delay, 1));
      im.frustumCulled = false;
      this.env.add(im);
    };
  }

  drawJumbo(lines: string[], bg = '#BF5700', fg = '#FFFFFF') {
    const c = this.jumboCanvas.getContext('2d')!;
    c.fillStyle = bg; c.fillRect(0, 0, 640, 360);
    c.fillStyle = 'rgba(0,0,0,.18)';
    for (let y = 0; y < 360; y += 6) c.fillRect(0, y, 640, 2);
    c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
    lines.forEach((l, i) => {
      const size = lines.length === 1 ? 120 : 96;
      c.font = `900 ${size}px Oswald, Impact, sans-serif`;
      c.fillText(l, 320, 180 + (i - (lines.length - 1) / 2) * size * 1.05, 600);
    });
    if (this.rrrLogo.complete && this.rrrLogo.naturalWidth) c.drawImage(this.rrrLogo, 8, 8, 72, 72);
    this.jumboGraphic.needsUpdate = true;
    this.jumboMode = 'graphic';
    this.screenMat.map = this.jumboGraphic;
  }
  jumboLive() { this.jumboMode = 'live'; this.screenMat.map = this.jumboRT.texture; }
  jumboReplay() { this.jumboMode = 'replay'; this.screenMat.map = this.jumboRT.texture; }

  /** Stadium pulse visuals. tex/ou are 0..1 crowd energy for each half. */
  setPulse(tex: number, ou: number, t: number) {
    const u = this.crowdUniforms;
    u.uTime.value = t; u.uHypeTex.value = tex; u.uHypeOU.value = ou;
    this.mosaicU.value += (this.mosaicTarget - this.mosaicU.value) * 0.035;
    const peak = Math.max(tex, ou);
    const strobe = peak > 0.78 ? (Math.sin(t * 22) > 0 ? 1 : 0.15) : 1;
    this.fairLights.forEach((m, i) => { m.emissiveIntensity = 3 + 2.5 * (0.5 + 0.5 * Math.sin(t * (2 + peak * 6) + i)); });
    const showCol = new THREE.Color(ou > tex ? '#C41E1E' : '#FF5A00');
    for (const m of this.lampShow) { m.emissive.copy(peak > 0.55 ? showCol : new THREE.Color('#FFF3DC')); m.emissiveIntensity = peak > 0.55 ? 8 * strobe : 6; }
    for (const m of this.lamp) m.emissiveIntensity = 6 + 6 * peak;
    for (const L of this.towerLights) L.intensity = 1500 * (1 + 0.35 * peak);
    this.beamFx.update(t, peak, strobe, showCol, this.showLights);
    this.showLights.forEach((S, i) => {
      S.color.copy(showCol);
      S.intensity = peak > 0.55 ? 60000 * (peak - 0.4) * strobe : 0;
      const b = S.userData.base as THREE.Vector3;
      S.target.position.set(b.x + Math.sin(t * 1.3 + i) * 14, b.y, b.z + Math.cos(t * 1.1 + i) * 10);
    });
    const hype = peak > 0.6;
    this.ribbonMats.forEach((m, i) => {
      const tx = hype ? this.ribbonTex.hype : this.ribbonTex.calm;
      if (i === 0 || this.ribbonMats.length === 1) { if (m.map !== tx) m.map = tx; tx.offset.x = -t * (hype ? 0.25 : 0.05); }
      else m.map = tx;
    });
  }

  /** Ball in flight: a fading camera-facing ribbon plus a soft glow, sized up with distance so it reads at 960x540. */
  ballFlying = false;
  private trail: { mesh: THREE.Mesh; glow: THREE.Sprite; pts: THREE.Vector3[]; last: THREE.Vector3; fade: number } | null = null;
  private initTrail() {
    const N = TRAIL_N, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false }));
    mesh.frustumCulled = false; mesh.visible = false;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d')!, gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(0.3, 'rgba(255,200,140,.45)'); gr.addColorStop(1, 'rgba(255,160,90,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false }));
    glow.visible = false;
    this.scene.add(mesh, glow);
    this.trail = { mesh, glow, pts: [], last: this.football.position.clone(), fade: 0 };
  }
  private updateTrail() {
    const T = this.trail; if (!T) return;
    const p = this.football.position, step = p.distanceTo(T.last), now = performance.now() / 1000;
    const dt = Math.max(1 / 240, Math.min(0.2, now - ((T as any).tPrev ?? now - 1 / 60))); (T as any).tPrev = now;
    const flying = this.ballFlying && this.football.visible && step < 4;
    if (step >= 4) T.pts = [];
    T.last.copy(p);
    if (flying) { T.fade = 1; if (!T.pts.length || T.pts[0].distanceTo(p) > 0.28) { T.pts.unshift(p.clone()); if (T.pts.length > TRAIL_N) T.pts.pop(); } else T.pts[0].copy(p); }
    else { T.fade = Math.max(0, T.fade - dt * 3); if (T.fade === 0) T.pts = []; }
    const n = T.pts.length, on = n > 1 && T.fade > 0;
    T.mesh.visible = on; T.glow.visible = on;
    if (!on) return;
    const cam = this.camera.position, pos = T.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = T.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const tan = new THREE.Vector3(), side = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < TRAIL_N; i++) {
      const q = T.pts[Math.min(i, n - 1)], q2 = T.pts[Math.min(i + 1, n - 1)], q0 = T.pts[Math.min(n - 1, Math.max(0, i - 1))];
      tan.subVectors(q0, q2); if (tan.lengthSq() < 1e-6) tan.set(0, 0, 1);
      side.crossVectors(tan, v.subVectors(q, cam)).normalize();
      const k = i < n ? 1 - i / (n - 1 || 1) : 0, w = 0.08 * Math.max(1, q.distanceTo(cam) / 12) * (0.3 + 0.7 * k);
      pos.setXYZ(i * 2, q.x + side.x * w, q.y + side.y * w, q.z + side.z * w);
      pos.setXYZ(i * 2 + 1, q.x - side.x * w, q.y - side.y * w, q.z - side.z * w);
      const a = k * k * 0.75 * T.fade;
      col.setXYZ(i * 2, a, a * 0.86, a * 0.66); col.setXYZ(i * 2 + 1, a, a * 0.86, a * 0.66);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    T.glow.position.copy(p);
    T.glow.scale.setScalar(0.9 * Math.max(1, p.distanceTo(cam) / 10));
    (T.glow.material as THREE.SpriteMaterial).opacity = 0.7 * T.fade;
  }

  render(t: number) {
    this.updateFx(t);
    this.jets.update(t);
    this.updateTrail();
    this.frame++;
    this.renderer.info.reset();
    const replay = this.jumboMode === 'replay' && this.replayHook;
    if ((this.jumboMode === 'live' || replay) && this.frame % 2 === 0) {
      const vis = this.fpArm.visible;
      this.fpArm.visible = false;
      this.replayTag.visible = !!replay;
      if (replay) this.replayHook!.apply();
      this.renderer.setRenderTarget(this.jumboRT);
      this.renderer.render(this.scene, this.jumboCam);
      if (replay) this.replayHook!.restore();
      this.fpArm.visible = vis;
    }
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    this.camera.position.x += sx; this.camera.position.y += sy;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.camera.position.x -= sx; this.camera.position.y -= sy;
    this.shake *= 0.9;
    this.renderer.setRenderTarget(null);
    this.post.mat.uniforms.tScene.value = this.rt.texture;
    this.post.mat.uniforms.uTime.value = t;
    this.post.mat.uniforms.uPixel.value = this.pixel ? 1 : 0;
    this.renderer.render(this.post.scene, this.post.cam);
  }
}

export function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
