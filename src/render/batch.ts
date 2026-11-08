import * as THREE from "three";

/** What a mesh in a batch knows of where it is drawn: the merged mesh and its first vertex and vertex count there. */
export interface Batched {
  mesh: THREE.Mesh;
  start: number;
  count: number;
}

interface Bucket {
  key: string;
  members: Set<THREE.Mesh>;
  mesh: THREE.Mesh | null;
}

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Matrix3();

/**
 * Many small static meshes drawn as a few. Meshes are added and removed one by one (a road piece, a junction), but never
 * drawn themselves: those sharing a material, shadow flags and vertex layout within the same CHUNK square of the map are
 * merged into one mesh, rebuilt on `flush()` only where something was added or removed. A big town's roads, some nine
 * thousand meshes, draw in a couple of hundred calls instead of several thousand.
 */
export class MeshBatch {
  readonly group = new THREE.Group();
  private buckets = new Map<string, Bucket>();
  private where = new Map<THREE.Mesh, Bucket>();
  private dirty = new Set<Bucket>();

  constructor(private chunk = 256) {}

  add(m: THREE.Mesh) {
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    m.updateMatrix();
    g.boundingBox!.getCenter(tmpV).applyMatrix4(m.matrix);
    const cx = Math.floor(tmpV.x / this.chunk), cz = Math.floor(tmpV.z / this.chunk);
    const mat = m.material as THREE.Material;
    // (members of a bucket must merge: the same attributes, all indexed or none)
    const layout = Object.keys(g.attributes).sort().map((k) => `${k}${(g.attributes[k] as THREE.BufferAttribute).itemSize}`).join(",") + (g.index ? "#" : "");
    const key = `${cx},${cz}|${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}|${layout}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { key, members: new Set(), mesh: null }));
    b.members.add(m);
    this.where.set(m, b);
    this.dirty.add(b);
  }

  remove(m: THREE.Mesh) {
    const b = this.where.get(m);
    if (!b) return;
    b.members.delete(m);
    this.where.delete(m);
    this.dirty.add(b);
    delete m.userData.batched;
  }

  /** Merge again every bucket something was added to or removed from. */
  flush() {
    for (const b of this.dirty) this.rebuild(b);
    this.dirty.clear();
  }

  /** Where a member is drawn (after the last flush), to write per-vertex data straight into the merged mesh. */
  static of(m: THREE.Mesh): Batched | undefined {
    return m.userData.batched as Batched | undefined;
  }

  private rebuild(b: Bucket) {
    if (b.mesh) {
      this.group.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh = null;
    }
    if (!b.members.size) { this.buckets.delete(b.key); return; }
    const list = [...b.members];
    const first = list[0];
    const names = Object.keys(first.geometry.attributes);
    const indexed = !!first.geometry.index;
    let nv = 0, ni = 0;
    for (const m of list) {
      nv += m.geometry.attributes.position.count;
      if (indexed) ni += m.geometry.index!.count;
    }
    const out = new THREE.BufferGeometry();
    const arrays = names.map((n) => {
      const a = first.geometry.attributes[n] as THREE.BufferAttribute;
      const Ctor = a.array.constructor as new (n: number) => THREE.TypedArray;
      return { n, size: a.itemSize, norm: a.normalized, arr: new Ctor(nv * a.itemSize) };
    });
    const index = indexed ? (nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)) : null;
    let v0 = 0, i0 = 0;
    for (const m of list) {
      const g = m.geometry;
      const count = g.attributes.position.count;
      m.updateMatrix();
      const moved = !m.matrix.equals(IDENTITY);
      if (moved) tmpN.getNormalMatrix(m.matrix);
      for (const A of arrays) {
        const src = (g.attributes[A.n] as THREE.BufferAttribute).array;
        A.arr.set(src, v0 * A.size);
        if (!moved) continue;
        // (a pillar or sign placed by its matrix: baked into the merged vertices)
        if (A.n === "position") for (let k = 0; k < count; k++) {
          const o = (v0 + k) * 3;
          tmpV.set(A.arr[o], A.arr[o + 1], A.arr[o + 2]).applyMatrix4(m.matrix);
          A.arr[o] = tmpV.x; A.arr[o + 1] = tmpV.y; A.arr[o + 2] = tmpV.z;
        } else if (A.n === "normal") for (let k = 0; k < count; k++) {
          const o = (v0 + k) * 3;
          tmpV.set(A.arr[o], A.arr[o + 1], A.arr[o + 2]).applyMatrix3(tmpN).normalize();
          A.arr[o] = tmpV.x; A.arr[o + 1] = tmpV.y; A.arr[o + 2] = tmpV.z;
        }
      }
      if (index) {
        const src = g.index!.array;
        for (let k = 0; k < src.length; k++) index[i0 + k] = src[k] + v0;
        i0 += src.length;
      }
      m.userData.batched = { start: v0, count } as Batched;
      v0 += count;
    }
    for (const A of arrays) out.setAttribute(A.n, new THREE.BufferAttribute(A.arr, A.size, A.norm));
    if (index) out.setIndex(new THREE.BufferAttribute(index, 1));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    const mesh = new THREE.Mesh(out, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.matrixAutoUpdate = false;
    for (const m of list) (m.userData.batched as Batched).mesh = mesh;
    b.mesh = mesh;
    this.group.add(mesh);
  }
}

const IDENTITY = new THREE.Matrix4();
