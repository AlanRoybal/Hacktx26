import * as THREE from 'three';

/** Volumetric-looking light shafts: soft-edged cones with a bright core, distance falloff and drifting haze,
 *  plus glare sprites on every lamp. Cones are unit length along -Y and scaled to their throw distance. */
const VERT = /* glsl */`
varying vec3 vWorld; varying vec3 vN; varying vec3 vV; varying float vAlong;
void main() {
  vAlong = -position.y;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
varying vec3 vWorld; varying vec3 vN; varying vec3 vV; varying float vAlong;
float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  float core = pow(abs(dot(vN, vV)), 2.5);                         // bright center, feathered silhouette edge
  float fall = 1.0 / (1.0 + vAlong * 9.0) * (1.0 - smoothstep(0.55, 1.0, vAlong));
  vec3 q = vWorld * 0.07 + vec3(uTime * 0.05, -uTime * 0.03, uTime * 0.04);
  float haze = 0.45 + 0.9 * (0.65 * noise(q) + 0.35 * noise(q * 2.7 + 11.0));
  float specks = step(0.985, noise(vWorld * 1.6 + vec3(0.0, uTime * 0.4, 0.0))) * 1.5;   // dust catching the light
  float ground = smoothstep(0.0, 8.0, vWorld.y);
  float near = smoothstep(3.0, 25.0, distance(cameraPosition, vWorld));
  float a = uOpacity * core * fall * (haze + specks) * ground * near;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

function cone(r0: number, r1: number) {
  const g = new THREE.CylinderGeometry(r0, r1, 1, 40, 12, true);
  g.translate(0, -0.5, 0);
  return g;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, 'rgba(255,246,225,.85)');
  g.addColorStop(0.35, 'rgba(255,225,180,.22)'); g.addColorStop(1, 'rgba(255,210,160,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const WARM = new THREE.Color('#FFEED2');

interface Shaft { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; show: boolean; base: number }

export class Beams {
  readonly group = new THREE.Group();
  private shafts: Shaft[] = [];
  private glares: { s: THREE.Sprite; show: boolean }[] = [];
  private spots: Shaft[] = [];
  private time = { value: 0 };

  private shaft(r0: number, r1: number, opacity: number, show: boolean) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, uniforms: { uColor: { value: WARM.clone() }, uOpacity: { value: opacity }, uTime: this.time }
    });
    const mesh = new THREE.Mesh(cone(r0, r1), mat);
    mesh.renderOrder = 5; mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, mat, show, base: opacity };
  }

  private static aim(m: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
    const d = to.clone().sub(from);
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(DOWN, d.clone().normalize());
    m.scale.set(1, d.length(), 1);
  }

  /** One tower: a 6x3 lamp bank at `head` aimed at `target`. Odd columns are the color-changing show lamps. */
  addTower(head: THREE.Vector3, target: THREE.Vector3, glow: THREE.Texture = glowTexture()) {
    const dir = target.clone().sub(head).normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    for (let c = 0; c < 6; c++) {
      const show = c % 2 === 1;
      const off = right.clone().multiplyScalar(-6.25 + c * 2.5);
      const from = head.clone().add(off);
      const to = target.clone().add(right.clone().multiplyScalar((c - 2.5) * 9)).add(new THREE.Vector3(0, 0, (c % 3 - 1) * 6));
      const s = this.shaft(1.4, 14 + (c % 3) * 3, 0.16, show);
      Beams.aim(s.mesh, from, to);
      this.shafts.push(s);
      for (let r = 0; r < 3; r++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: WARM, blending: THREE.AdditiveBlending,
          depthWrite: false, transparent: true, fog: false, toneMapped: false }));
        sp.position.copy(from).add(up.clone().multiplyScalar(-2.2 + r * 2.2)).add(dir.clone().multiplyScalar(-0.6));
        sp.scale.setScalar(5.5); sp.renderOrder = 6;
        this.group.add(sp); this.glares.push({ s: sp, show });
      }
    }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#FFE2B8', blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.35, fog: false, toneMapped: false }));
    halo.position.copy(head); halo.scale.setScalar(42); halo.renderOrder = 6;
    this.group.add(halo);
    return glow;
  }

  /** Visible shaft for a sweeping show spotlight. */
  addSpot() { const s = this.shaft(0.8, 7, 0, true); this.spots.push(s); return this.spots.length - 1; }

  update(t: number, peak: number, strobe: number, showCol: THREE.Color, spots: THREE.SpotLight[]) {
    this.time.value = t;
    const showOn = peak > 0.55;
    for (const s of this.shafts) {
      const lit = s.show && showOn;
      s.mat.uniforms.uColor.value.copy(lit ? showCol : WARM);
      s.mat.uniforms.uOpacity.value = s.base * (1 + 0.6 * peak) * (lit ? strobe : 1);
    }
    for (const g of this.glares) {
      const lit = g.show && showOn;
      (g.s.material as THREE.SpriteMaterial).color.copy(lit ? showCol : WARM);
      g.s.material.opacity = lit ? strobe : 1;
    }
    spots.forEach((S, i) => {
      const s = this.spots[i]; if (!s) return;
      Beams.aim(s.mesh, S.position, S.target.position);
      s.mat.uniforms.uColor.value.copy(showCol);
      s.mat.uniforms.uOpacity.value = S.intensity > 0 ? 0.5 * strobe * Math.min(1, (peak - 0.4) * 2) : 0;
    });
  }
}
