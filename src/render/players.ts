import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGLB, loadTex } from './world';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type Team = 'tex' | 'ou';
const OU_COLORS: Record<string, string> = {
  jersey: '#EDEAE2', pants: '#E8DFC0', helmet: '#841617', facemask: '#EDEAE2', socks: '#841617',
  gloves: '#841617', skin: '#C08A64', numbers: '#841617',
};
const BASE_NUMBER = 16;   // number baked into the GLB decal UVs (10x10 atlas)

let gltf: GLTF;
const teamMats: Record<Team, Map<string, THREE.Material>> = { tex: new Map(), ou: new Map() };

export async function loadPlayerAsset() {
  gltf = await loadGLB('player');
  gltf.scene.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (mat.name === 'jersey') (mat as THREE.MeshStandardMaterial).color.set('#D8680E');   // reads burnt orange under the night lights
      teamMats.tex.set(mat.name, mat);
      const c = mat.clone() as THREE.MeshStandardMaterial;
      if (OU_COLORS[mat.name]) c.color.set(OU_COLORS[mat.name]);
      if (mat.name === 'helmet_logo') { const t = loadTex('logo_ou_hd.png'); t.flipY = false; c.map = t; }
      teamMats.ou.set(mat.name, c);
    }
  });
}

export class Actor {
  obj: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions = new Map<string, THREE.AnimationAction>();
  current = '';
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  heading = 0;
  role = '';
  data: Record<string, any> = {};

  constructor(public team: Team, public number: number, public name = '') {
    this.obj = SkeletonUtils.clone(gltf.scene);
    this.obj.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.frustumCulled = false;
      const swap = (mat: THREE.Material) => {
        let out = teamMats[team].get(mat.name) ?? mat;
        if (mat.name === 'name_plate') {
          const nm = (out as THREE.MeshStandardMaterial).clone();
          const cv = document.createElement('canvas');
          cv.width = 512; cv.height = 96;
          const c = cv.getContext('2d')!;
          c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.font = '900 78px Impact, "Arial Black", sans-serif';
          c.fillText(name, 256, 52, 500);
          const tex = new THREE.CanvasTexture(cv);
          tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
          nm.map = tex;
          out = nm;
        }
        if (mat.name === 'numbers') {
          const nm = (out as THREE.MeshStandardMaterial).clone();
          const tex = nm.map!.clone();
          tex.offset.set((number % 10 - BASE_NUMBER % 10) / 10, (Math.floor(number / 10) - Math.floor(BASE_NUMBER / 10)) / 10);
          tex.needsUpdate = true;
          nm.map = tex;
          out = nm;
        }
        return out;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
    this.mixer = new THREE.AnimationMixer(this.obj);
    for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
  }

  play(name: string, fade = 0.2, timeScale = 1, once = false) {
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = timeScale;
    if (name === this.current) return;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.play();
    const prev = this.actions.get(this.current);
    if (prev) a.crossFadeFrom(prev, fade, false);
    a.time = once ? 0 : Math.random() * a.getClip().duration;
    this.current = name;
  }

  face(target: THREE.Vector3) { this.heading = Math.atan2(target.x - this.pos.x, target.z - this.pos.z); }

  update(dt: number) {
    this.obj.position.copy(this.pos);
    let d = this.heading - this.obj.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.obj.rotation.y += d * Math.min(1, dt * 10);
    this.mixer.update(dt);
  }
}
