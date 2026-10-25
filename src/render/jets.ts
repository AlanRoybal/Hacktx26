import * as THREE from 'three';

/** Pre-game flyover: four procedural fighters in a finger-four, flying +z over midfield with afterburner glow. */
export class Jets {
  group = new THREE.Group();
  private now = 0;
  private t0 = -1e9;
  private glows: THREE.Mesh[] = [];
  static readonly SPEED = 75;
  static readonly ALT = 48;

  constructor() {
    const gray = new THREE.MeshStandardMaterial({ color: '#7d858e', roughness: 0.55, metalness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: '#23282f', roughness: 0.25, metalness: 0.4 });
    const glow = new THREE.MeshBasicMaterial({ color: '#ffb35a', transparent: true, opacity: 0.9, toneMapped: false, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const flat = (pts: number[][], m: THREE.Material) => {
      const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
      return new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false }), m);
    };
    for (const [x, z] of [[0, 0], [-8, -7], [8, -7], [16, -14]]) {
      const s = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.75, 12, 12), gray); body.rotation.x = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4.5, 12), gray); nose.rotation.x = Math.PI / 2; nose.position.z = 8.25;
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), dark); canopy.scale.set(1, 0.8, 2.8); canopy.position.set(0, 0.6, 4);
      const wing = flat([[0, 3.5], [-5.2, -2.2], [-5.2, -3.2], [5.2, -3.2], [5.2, -2.2]], gray); wing.rotation.x = Math.PI / 2; wing.position.y = 0.1;
      const stab = flat([[0, -3.6], [-2.6, -6.4], [2.6, -6.4]], gray); stab.rotation.x = Math.PI / 2; stab.position.y = 0.1;
      const fin = flat([[0, 0], [-3.4, 0], [-5.6, 3], [-4.6, 3]], gray); fin.rotation.y = Math.PI / 2; fin.position.set(-0.09, 0.4, -2.2);
      const burner = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.2, 10, 1, true), glow); burner.rotation.x = -Math.PI / 2; burner.position.z = -7.6;
      [body, nose, wing, stab, fin].forEach(m => (m.castShadow = true));
      s.add(body, nose, canopy, wing, stab, fin, burner);
      s.position.set(x, 0, z);
      this.glows.push(burner);
      this.group.add(s);
    }
    this.group.visible = false;
  }

  /** Formation leader passes over midfield `lead` seconds from now. */
  fly(lead: number) { this.t0 = this.now + lead; }

  update(t: number) {
    this.now = t;
    const k = t - this.t0;
    this.group.visible = Math.abs(k) < 6;
    if (!this.group.visible) return;
    this.group.position.set(10, Jets.ALT, Jets.SPEED * k);
    this.glows.forEach((g, i) => g.scale.set(1, 0.8 + 0.3 * Math.sin(t * 40 + i), 1));
  }
}
