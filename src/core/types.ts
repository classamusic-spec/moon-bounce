import * as THREE from 'three';

// ---------- Planet data model (the heart of the game) ----------

export type TerrainType = 'horizontal' | 'vertical';
export type Axis = 'x' | 'y';

/** Elemental power a level offers (granted by its Power Box). */
export type PowerType = 'flame' | 'ice' | 'bubble' | 'spark';

export interface MovingPlatData {
  x: number;
  y: number;
  axis: Axis;
  range: number;
  speed: number;
}

export interface Terrain {
  type: TerrainType;
  shape?: 'dunes' | 'plateau' | 'hills' | 'canyon' | 'flat' | 'trench';
  height?: number;
  tilt?: boolean;
  /** [x, heightAboveGround] */
  platforms?: [number, number][];
  /** [x, heightAboveGround] */
  mesas?: [number, number][];
  /** [x0, x1, heightOffset] */
  steps?: [number, number, number][];
  /** [x, y] climb ledges (vertical levels) */
  climb?: [number, number][];
  movingPlats?: MovingPlatData[];
  /** [x0, x1] holes in the ground; a soft catch below bounces the blob back (no fail). */
  gaps?: [number, number][];
  /** Alternate layouts (platform/moving-platform overrides) rotated per visit. */
  variants?: Partial<Terrain>[];
}

export interface WindDyn {
  zones: [number, number][];
  strength: number;
  color: number;
}

export interface GustDyn {
  strength: number;
  period: number;
  color: number;
}

/** Per-planet dynamic element descriptors. */
export interface Dyn {
  craters?: boolean;
  boost?: boolean;
  flares?: number[];
  wind?: WindDyn;
  clouds?: [number, number][];
  birds?: boolean;
  springs?: number[];
  rocks?: number[];
  spires?: boolean;
  geysers?: number[];
  stormClouds?: [number, number][];
  ringMovers?: [number, number][];
  slippery?: boolean;
  ice?: [number, number][];
  frost?: boolean;
  gusts?: GustDyn;
  bubbles?: number[];
  /** [x, heightAboveGround] freezable ground spouts → solid platform/bridge (ice/bubble). */
  freezeSpots?: [number, number][];
  /** [x, heightAboveGround] floating clouds → solid platform when puffed (ice/spark; vertical climbs). */
  puffClouds?: [number, number][];
}

export interface Planet {
  name: string;
  sky: [number, number];
  ground: number;
  hill: number;
  char: number;
  dust: number;
  enemy: number;
  grav: number;
  jump: number;
  emoji: string;
  fact: string;
  facts: string[];
  bands?: boolean;
  rings?: boolean;
  dyn?: Dyn;
  terrain: Terrain;
  /** Elemental power this level offers via its Power Box. */
  power?: PowerType;
  /** X position of the Power Box (above the ground at that x). */
  powerBox?: number;
  /** [x, heightAboveGround] secret power cache (reachable using the power). */
  powerCache?: [number, number];
  /** [x, heightAboveGround] hidden star cluster — collect all 4 for a
   *  Star-Finder sticker + bonus stars. Placed to need the planet's mechanic
   *  (a brave jump, a cloud, a frozen bridge, a bubble boost…). */
  secret?: [number, number];
}

// ---------- Runtime entity types ----------

export interface Platform {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  w: number;
  top: number;
}

export interface StarItem {
  mesh: THREE.Object3D;
  base: number;
  alive: boolean;
  reward?: boolean;
  vy?: number;
  /** A secret power cache: awards a Power-Master sticker + bonus stars. */
  cache?: boolean;
  /** Part of the hidden star cluster (all collected → Star-Finder sticker). */
  secret?: boolean;
}

export interface FactBox {
  group: THREE.Group;
  x: number;
  baseY: number;
  used: boolean;
  fact: string;
  factIndex: number;
  bounce: number;
}

export interface Enemy {
  group: THREE.Group;
  baseY: number;
  dir: number;
  range: number;
  home: number;
  alive: boolean;
  squish: number;
  onPlat?: number;
}

export interface Mover {
  mesh: THREE.Object3D;
  x: number;
  top: number;
  w: number;
  kind: string;
  baseY: number;
  phase: number;
  drift?: number;
  amp?: number;
}

export interface Roller {
  mesh: THREE.Object3D;
  x: number;
  home: number;
  dir: number;
  range: number;
  alive: boolean;
  flare?: boolean;
}

export interface Bubble {
  mesh: THREE.Object3D;
  x: number;
  y: number;
  phase: number;
}

export interface BouncePad {
  mesh: THREE.Object3D;
  x: number;
  y: number;
  power: number;
  spring?: boolean;
}

export interface WindZone {
  x0: number;
  x1: number;
  ice?: boolean;
}

export interface MovingPlat {
  mesh: THREE.Mesh;
  baseX: number;
  baseY: number;
  axis: Axis;
  range: number;
  speed: number;
  phase: number;
  w: number;
  top: number;
  t?: number;
  dx?: number;
}

export interface SunPiece {
  group: THREE.Group;
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  y: number;
}

export interface PowerBox {
  group: THREE.Group;
  x: number;
  baseY: number;
  used: boolean;
  bounce: number;
}

export interface Puff {
  mesh: THREE.Group;
  vx: number;
  life: number;
}

/** A gap in the ground + the catch height that bounces the blob back up. */
export interface Gap {
  x0: number;
  x1: number;
}

/** A puffable spot (spout or cloud) that solidifies into a platform when hit. */
export interface Freezable {
  mesh: THREE.Group;
  x: number;
  /** Y of the resulting platform's top surface. */
  y: number;
  w: number;
  frozen: boolean;
}

export interface Fx {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  life: number;
}

export interface GustState {
  active: number;
  dir: number;
  timer: number;
  strength?: number;
  period?: number;
}

// ---------- Flight mini-game state ----------

export interface FlightLaser {
  mesh: THREE.Mesh;
  dead: boolean;
}

export interface FlightFx {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  life: number;
}

export interface Flight {
  fscene: THREE.Scene;
  fcam: THREE.PerspectiveCamera;
  rocket: THREE.Group;
  flame: THREE.Mesh;
  planet: THREE.Mesh;
  pRing: THREE.Mesh | null;
  starf: THREE.Points;
  neb: THREE.Points;
  ground: THREE.Mesh;
  blob: THREE.Group;
  phase: 'intro' | 'fly';
  introT: number;
  t: number;
  ry: number;
  vy: number;
  bonusStars: THREE.Object3D[];
  asteroids: THREE.Mesh[];
  lasers: FlightLaser[];
  shootCd: number;
  autoFire: number;
  rocksBlasted: number;
  fxList: FlightFx[];
  spawnTimer: number;
  astTimer: number;
  done: boolean;
  arriving: boolean;
  /** The intro hop sound has played (it must fire exactly once). */
  introBoinged?: boolean;
  /** Pending arrival timeout — cleared if the flight is torn down early. */
  arriveTimer?: ReturnType<typeof setTimeout> | null;
}

export type Mode = 'platformer' | 'flight';
