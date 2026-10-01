// Inset: every neuron of the FlyWire brain as an ink stipple, with the mushroom-body neurons in colour. Kenyon cells
// that the current smell turns on flash; so do the dopamine neurons when they fire.
import * as THREE from "three";
import { PAM, PPL1 } from "../mb/circuit.ts";
import type { ReadyInfo } from "../mb/protocol.ts";

const VERT = /* glsl */ `
  attribute float kind;
  attribute float lastT;
  uniform float now;
  uniform float px;
  uniform float bgAlpha;
  varying vec4 vColor;
  void main() {
    float a = exp(-max(0.0, now - lastT) / 320.0);
    vec3 ink = vec3(0.11, 0.10, 0.09);
    vec3 c;
    float alpha;
    float size;
    if (kind < 0.5) { c = ink; alpha = bgAlpha; size = 1.0; }
    else if (kind < 1.5) { c = mix(vec3(0.78, 0.53, 0.12), ink, a); alpha = 0.55 + 0.45 * a; size = 1.5 + 1.4 * a; }
    else if (kind < 2.5) { c = vec3(0.12, 0.48, 0.30); alpha = 0.45 + 0.55 * a; size = 2.0 + 2.6 * a; }
    else { c = vec3(0.77, 0.24, 0.17); alpha = 0.45 + 0.55 * a; size = 2.4 + 2.6 * a; }
    vColor = vec4(c, alpha);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = px * size;
  }
`;
const FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d);
    if (r > 0.25) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * smoothstep(0.25, 0.12, r));
  }
`;

export class BrainView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 1, 10, 10000);
  private readonly material: THREE.ShaderMaterial;
  private readonly group = new THREE.Group();
  private mbLast: Float32Array | null = null;
  private mbAttr: THREE.BufferAttribute | null = null;
  /** index into the MB point set of every KC and DAN */
  private kcAt: Int32Array = new Int32Array(0);
  private danAt: Int32Array = new Int32Array(0);
  private danCluster: Int8Array = new Int8Array(0);
  private t0 = performance.now();
  private ready = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { now: { value: 0 }, px: { value: 1 }, bgAlpha: { value: 0.045 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(this.group);
  }

  async load(base: string, info: ReadyInfo): Promise<void> {
    const res = await fetch(`${base}data/${info.brain.file}`);
    let buf = await res.arrayBuffer();
    const head = new Uint8Array(buf, 0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) {
      buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    }
    const n = info.neurons;
    const q = new Int16Array(buf, 0, n * 3);
    const s = info.brain.scale;
    // FlyWire: x to the fly's left, y ventral, z posterior; seen from the front, dorsal up
    const pos = (i: number, out: Float32Array, at: number) => {
      out[at] = -q[3 * i] * s;
      out[at + 1] = -q[3 * i + 1] * s;
      out[at + 2] = -q[3 * i + 2] * s;
    };
    const inMb = new Uint8Array(n);
    for (const id of info.kc.id) inMb[id] = 1;
    for (const id of info.dan.id) inMb[id] = 1;

    const bgPos = new Float32Array(n * 3);
    let nb = 0;
    for (let i = 0; i < n; i++) if (!inMb[i]) pos(i, bgPos, 3 * nb++);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(bgPos.subarray(0, 3 * nb), 3));
    bg.setAttribute("kind", new THREE.BufferAttribute(new Float32Array(nb), 1));
    bg.setAttribute("lastT", new THREE.BufferAttribute(new Float32Array(nb).fill(-1e9), 1));

    const m = info.kc.n + info.dan.n;
    const mbPos = new Float32Array(m * 3);
    const kind = new Float32Array(m);
    this.kcAt = new Int32Array(info.kc.n);
    this.danAt = new Int32Array(info.dan.n);
    this.danCluster = info.dan.cluster;
    let k = 0;
    info.kc.id.forEach((id, j) => {
      pos(id, mbPos, 3 * k);
      kind[k] = 1;
      this.kcAt[j] = k++;
    });
    info.dan.id.forEach((id, j) => {
      pos(id, mbPos, 3 * k);
      kind[k] = info.dan.cluster[j] === PAM ? 2 : info.dan.cluster[j] === PPL1 ? 3 : 0;
      this.danAt[j] = k++;
    });
    const mb = new THREE.BufferGeometry();
    mb.setAttribute("position", new THREE.BufferAttribute(mbPos, 3));
    mb.setAttribute("kind", new THREE.BufferAttribute(kind, 1));
    this.mbLast = new Float32Array(m).fill(-1e9);
    this.mbAttr = new THREE.BufferAttribute(this.mbLast, 1);
    this.mbAttr.setUsage(THREE.DynamicDrawUsage);
    mb.setAttribute("lastT", this.mbAttr);

    const bgPts = new THREE.Points(bg, this.material);
    const mbPts = new THREE.Points(mb, this.material);
    mbPts.renderOrder = 1;
    this.group.add(bgPts, mbPts);
    this.ready = true;
    this.resize();
  }

  resize(): void {
    const c = this.renderer.domElement;
    const w = Math.max(1, c.clientWidth);
    const h = Math.max(1, c.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // fit the ~1000 x 600 um brain
    const t = Math.tan((this.camera.fov * Math.PI) / 360);
    const dist = Math.max(1050 / (2 * t * this.camera.aspect), 620 / (2 * t));
    this.camera.position.set(0, 0, dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.material.uniforms.px.value = Math.max(1, Math.min(2.2, h / 200)) * this.renderer.getPixelRatio();
    // the same 138,639 dots on a smaller canvas pile up darker: thin them out
    this.material.uniforms.bgAlpha.value = 0.05 * Math.max(0.3, Math.min(1.2, (w * h) / (420 * 300)));
  }

  /** Kenyon cells active for the current smell */
  flashKcs(kcs: Int32Array, now: number): void {
    if (!this.mbLast) return;
    for (const k of kcs) this.mbLast[this.kcAt[k]] = now - this.t0;
    this.mbAttr!.needsUpdate = true;
  }

  /** dopamine: > 0 the PAM neurons fire, < 0 the PPL1 neurons */
  flashDopamine(d: number, now: number): void {
    if (!this.mbLast || d === 0) return;
    const want = d > 0 ? PAM : PPL1;
    this.danAt.forEach((at, j) => {
      if (this.danCluster[j] === want) this.mbLast![at] = now - this.t0;
    });
    this.mbAttr!.needsUpdate = true;
  }

  render(now: number): void {
    if (!this.ready) return;
    const t = (now - this.t0) / 1000;
    this.group.rotation.y = Math.sin(t * 0.22) * 0.55;
    this.group.rotation.x = 0.12 + Math.sin(t * 0.13) * 0.06;
    this.material.uniforms.now.value = now - this.t0;
    this.renderer.render(this.scene, this.camera);
  }
}
