// ── Shared type definitions for ComfyUI-Majoor-ImageOps ──

// ── ComfyUI / LiteGraph ──

export interface ComfyApp {
  registerExtension(ext: ComfyExtension): void;
  graph: LGraph;
}

export interface ComfyExtension {
  name: string;
  beforeRegisterNodeDef?(nodeType: ComfyNodeConstructor, nodeData: any): Promise<void> | void;
}

export interface ComfyNodeConstructor {
  prototype: ComfyNode;
}

export interface ComfyAPI {
  apiURL(path: string): string;
  addEventListener(event: string, handler: (e: any) => void): void;
}

export interface ComfyWidget {
  name: string;
  value: string | number | boolean | null;
  callback?: (...args: any[]) => any;
}

export interface ComfyLink {
  origin_id?: number;
  originId?: number;
}

export interface LGraph {
  _nodes: ComfyNode[];
  getNodeById(id: number): ComfyNode | null;
}

export interface ComfyNode {
  id: number;
  comfyClass: string;
  widgets?: ComfyWidget[];
  graph?: LGraph;
  size?: [number, number];
  resizable?: boolean;
  getInputLink?(index: number): ComfyLink | null;
  onConnectionsChange?(...args: any[]): any;
  onConfigure?(...args: any[]): any;
  onNodeCreated?(...args: any[]): any;
  setSize?(size: [number, number]): void;
  addDOMWidget(name: string, type: string, el: HTMLElement, opts: any): void;
  __imageops_state?: NodeState;
  __imageops_media?: MediaState;
}

// ── Adapter ──

export interface Adapter {
  name?: string;
  match(node: ComfyNode): boolean;
  inputs: number | ((node: ComfyNode) => number);
  apply(ctx: AdapterApplyContext): Promise<void> | void;
}

export interface AdapterApplyContext {
  node: ComfyNode;
  ctx: CanvasRenderingContext2D;
  canvasSize: number;
  inputs: HTMLCanvasElement[];
}

export interface AdapterRegistry {
  pick(node: ComfyNode): Adapter | null;
}

// ── Renderer ──

export interface RenderContext {
  api: ComfyAPI;
  canvasSize: number;
  tick: number;
  cache: Map<string, HTMLCanvasElement>;
  visited: Set<number>;
}

export interface RenderResult {
  canvas: HTMLCanvasElement | null;
}

// ── Node state ──

export interface NodeState {
  hooked: boolean;
  canvas: HTMLCanvasElement | null;
  scopes: ScopesElements | null;
  abCanvas: HTMLCanvasElement | null;
  abEnabled: boolean;
  wipe: number;
  overlay: "none" | "zebra" | "falsecolor";
  showHistogram: boolean;
  showWaveform: boolean;
  waveformMode: "luma" | "rgb";
  showVectorscope: boolean;
  info: HTMLDivElement | null;
  progressWrap: HTMLDivElement | null;
  progressBar: HTMLDivElement | null;
  rafId: number | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  lastKey: string | null;
  isPreview: boolean;
}

export interface ScopesElements {
  histCanvas: HTMLCanvasElement;
  waveCanvas: HTMLCanvasElement;
  vecCanvas: HTMLCanvasElement;
}

export interface MediaState {
  lastBitmapURL?: string;
  lastBitmap?: ImageBitmap;
  videoEl?: HTMLVideoElement;
  lastVideoURL?: string;
}

// ── Media / source ──

export interface MediaSource {
  kind: "image" | "video";
  value: string;
}

export interface AnnotatedFilename {
  filename: string | null;
  subfolder: string;
  type: string;
}

// ── Constants ──

export interface OpsConstants {
  version: number;
  epsilon: number;
  luma_weights: number[];
  gamma_safe_min: number;
  gamma_max: number;
  preview_gamma_epsilon: number;
}

// ── Preview config ──

export interface PreviewConfig {
  canvasSize: number;
  debounceMs: number;
  maxGraphNodes: number;
}

// ── Scopes ──

export interface ScopesOptions {
  lumaWeights?: number[];
  sampleStep?: number;
  waveWidth?: number;
  waveHeight?: number;
  vectorscopeSize?: number;
}

export interface ScopesResult {
  hist: Uint32Array;
  waveform: Uint16Array;
  waveformR: Uint16Array;
  waveformG: Uint16Array;
  waveformB: Uint16Array;
  waveW: number;
  waveH: number;
  vectorscope: Uint16Array;
  vecSize: number;
}

// ── Progress ──

export interface ProgressBus {
  registerNodeWidget(node: ComfyNode, wrap: HTMLDivElement, bar: HTMLDivElement): void;
}
