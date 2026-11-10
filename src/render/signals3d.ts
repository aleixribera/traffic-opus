// Traffic signals standing at the junctions (docs/design.md, "The camera"): at every arm of a junction with lights,
// a 1930s pedestal signal on the pavement at the stop line, on the right of the traffic it holds and facing it, its
// lit lens showing what that traffic may do. The dots on the lanes (roads3d) stay: they say it lane by lane and read
// from straight above, where a post is a dot. Seen from a tilt, lights lying on the road alone read as coins.

import * as THREE from "three";
import { add, right, scale, type V2 } from "../core/math";
import type { Arm } from "../roads/network";
import type { Traffic } from "../sim/traffic";
import type { MergedModel } from "./models";
import { seasonal } from "./envShader";

/** A signal to stand: the junction and the arm it holds, the turns its lanes take, its foot, and the way it faces. */
export interface SignalSpot { node: number; arm: number; turns: string[]; x: number; y: number; h: number; dx: number; dy: number }

/** How far back from the junction's mouth a signal stands, and how far out from the road's edge (m). */
const BACK = 0.7, OUT = 0.55;
/** On a deck there is no pavement to stand on: just inside the parapet (m in from the edge). */
const IN_DECK = 0.3;
/** The model is drawn a little over life size, as the street lamps' heads are: a signal has to read from the air. */
const SCALE = 1.3;
/** The lenses on the model: how far in front of the post's middle a lit one shows, and how high each is (m). */
const LENS_OUT = 0.26 * SCALE;
const LENS_H = { red: 3.8 * SCALE, yellow: 3.48 * SCALE, green: 3.16 * SCALE } as const;
const LENS_COL = { red: 0xff4a44, yellow: 0xffc02e, green: 0x3fe070 } as const;
/** A lit lens with its glow, across (m), and the fewest pixels it is drawn across. */
const LIT_SIZE = 1.0, LIT_MIN_PX = 9;
/** Past this many metres to a pixel the posts are under a pixel wide: the lane dots alone say it. */
const FAR_MPP = 1.4;

/**
 * Where the signal of a junction's arm stands and which way it faces. Traffic arrives on the arm's left as seen
 * from the junction (it drives on the right), so the post stands off that edge, turn pockets and all, a step back
 * from the mouth, and looks out along the arm at the cars coming. `raised`: on a deck, inside its edge.
 */
export function signalPost(c: V2, a: Arm, raised = false): { x: number; y: number; dx: number; dy: number } {
  const m = a.mouth?.p ?? add(c, scale(a.dir, a.trim)), d = a.mouth?.dir ?? a.dir;
  const off = a.halfW + (a.wL ?? 0) + (raised ? -IN_DECK : OUT);
  const p = add(add(m, scale(d, BACK)), scale(right(d), -off));
  return { x: p.x, y: p.y, dx: d.x, dy: d.y };
}

/** What an arm's signal shows: its straight-on lanes' light if it has any, else the best of its turns'. */
export function armLight(turns: string[], state: (turn: string) => string): "red" | "yellow" | "green" {
  const list = turns.includes("S") ? ["S"] : turns;
  let st: "red" | "yellow" | "green" = "red";
  for (const t of list) {
    const x = state(t);
    if (x === "green") return "green";
    if (x === "yellow") st = "yellow";
  }
  return st;
}

const LIT_VS = /* glsl */ `
uniform float uMpp; uniform float uMinPx;
varying vec2 vUv; varying vec3 vCol; varying float vSee;
void main() {
  vUv = uv;
  vCol = instanceColor;
  vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float size = max(length(instanceMatrix[0].xyz), uMinPx * uMpp);
  // (how squarely the lens looks at the camera: from behind the head it does not show)
  vec3 toCam = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vSee = smoothstep(-0.12, 0.3, dot(normalize(instanceMatrix[2].xyz), toCam));
  vec4 mv = viewMatrix * c;
  mv.xy += position.xy * size;
  // (a step toward the camera, clear of its own hood and case: what stands in front of the signal still hides it)
  mv.z += 0.7;
  gl_Position = projectionMatrix * mv;
}`;
const LIT_FS = /* glsl */ `
varying vec2 vUv; varying vec3 vCol; varying float vSee;
void main() {
  float d = length(vUv * 2.0 - 1.0);
  if (d > 1.0 || vSee < 0.01) discard;
  float core = 1.0 - smoothstep(0.3, 0.42, d);
  float halo = exp(-d * d * 3.2) * 0.7 * (1.0 - smoothstep(0.75, 1.0, d));
  gl_FragColor = vec4(mix(vCol, vec3(1.0), core * 0.35), max(core, halo) * vSee);
}`;

export class Signals3D {
  readonly group = new THREE.Group();
  private postMat = seasonal(new THREE.MeshLambertMaterial({ vertexColors: true }), { roofs: true });
  private mpp = { value: 1 };
  private litMat = new THREE.ShaderMaterial({
    vertexShader: LIT_VS, fragmentShader: LIT_FS, transparent: true, depthWrite: false,
    uniforms: { uMpp: this.mpp, uMinPx: { value: LIT_MIN_PX } },
  });
  private posts: THREE.InstancedMesh | null = null;
  private lit: THREE.InstancedMesh | null = null;
  private spots: SignalSpot[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(private model: MergedModel | undefined) {}

  /** The junctions' lights changed (roads3d.signalSpots): stand the posts again. */
  setSpots(spots: SignalSpot[]) {
    for (const m of [this.posts, this.lit]) if (m) { this.group.remove(m); m.dispose(); }
    this.lit?.geometry.dispose(); // (its own quad; the posts' geometry is the model's, shared)
    this.posts = this.lit = null;
    this.spots = spots;
    if (!this.model || !spots.length) return;
    const posts = new THREE.InstancedMesh(this.model.geo, this.postMat, spots.length);
    spots.forEach((sp, i) => {
      // (the model's +z, where its lenses are, turned to look the way the signal faces)
      this.q.setFromAxisAngle(this.up, Math.atan2(sp.dx, sp.dy));
      posts.setMatrixAt(i, this.m.compose(this.v.set(sp.x, sp.h, sp.y), this.q, this.s.set(SCALE, SCALE, SCALE)));
    });
    posts.castShadow = true;
    posts.receiveShadow = true;
    posts.computeBoundingSphere();
    const lit = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.litMat, spots.length);
    lit.setColorAt(0, this.c.set(0xffffff));
    lit.frustumCulled = false; // (drawn turned to the camera, wider than their own bounds when far out)
    lit.renderOrder = 8;
    this.posts = posts;
    this.lit = lit;
    this.group.add(posts, lit);
  }

  /** Every frame: each signal's lit lens. */
  update(traffic: Traffic, mpp: number) {
    const posts = this.posts, lit = this.lit;
    if (!posts || !lit) return;
    posts.visible = lit.visible = mpp < FAR_MPP;
    if (!posts.visible) return;
    posts.castShadow = mpp < 0.45;
    this.mpp.value = mpp;
    this.spots.forEach((sp, i) => {
      const st = armLight(sp.turns, (t) => traffic.signalState(sp.node, sp.arm, t));
      this.q.setFromAxisAngle(this.up, Math.atan2(sp.dx, sp.dy));
      this.v.set(sp.x + sp.dx * LENS_OUT, sp.h + LENS_H[st], sp.y + sp.dy * LENS_OUT);
      lit.setMatrixAt(i, this.m.compose(this.v, this.q, this.s.set(LIT_SIZE, LIT_SIZE, LIT_SIZE)));
      lit.setColorAt(i, this.c.set(LENS_COL[st]));
    });
    lit.instanceMatrix.needsUpdate = true;
    if (lit.instanceColor) lit.instanceColor.needsUpdate = true;
  }
}
