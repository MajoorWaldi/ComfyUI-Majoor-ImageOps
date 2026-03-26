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
  type?: string;
  origType?: string;
  value: string | number | boolean | null;
  element?: HTMLElement | null;
  callback?: (...args: any[]) => any;
  computeSize?: () => [number, number];
  origComputeSize?: () => [number, number];
  linkedWidgets?: ComfyWidget[];
  serializeValue?: () => unknown;
}

export interface ComfyInputSlot {
  name?: string;
  type?: string;
  link?: number | null;
  widget?: { name?: string } | null;
}

export interface ComfyOutputSlot {
  name?: string;
  type?: string;
  links?: Array<number | string> | number | string | null;
  link?: number | string | null;
}

export interface ComfyLink {
  origin_id?: number;
  originId?: number;
  origin_slot?: number;
  originSlot?: number;
}

export interface LGraph {
  _nodes: ComfyNode[];
  getNodeById(id: number): ComfyNode | null;
  links?: unknown;
  _links?: unknown;
}

export interface ComfyNode {
  id: number;
  comfyClass: string;
  widgets?: ComfyWidget[];
  inputs?: ComfyInputSlot[];
  outputs?: ComfyOutputSlot[];
  imgs?: Array<HTMLImageElement | HTMLVideoElement | HTMLCanvasElement>;
  imageIndex?: number | null;
  graph?: LGraph;
  size?: [number, number];
  resizable?: boolean;
  previewMediaType?: string;
  getInputLink?(index: number): ComfyLink | null;
  onConnectionsChange?(...args: any[]): any;
  onConfigure?(...args: any[]): any;
  onExecuted?(...args: any[]): any;
  onNodeCreated?(...args: any[]): any;
  setSize?(size: [number, number]): void;
  addDOMWidget(name: string, type: string, el: HTMLElement, opts: any): void;
  addInput?(name: string, type?: string, extra_info?: any): void;
  removeInput?(slot: number): void;
  __imageops_state?: NodeState;
  __imageops_media?: MediaState;
}

// ── Adapter ──

export interface Adapter {
  name?: string;
  match(node: ComfyNode): boolean;
  inputs: number | ((node: ComfyNode) => number);
  inputIndexes?: number[] | ((node: ComfyNode) => number[]);
  apply(ctx: AdapterApplyContext): Promise<HTMLCanvasElement | void> | HTMLCanvasElement | void;
}

export interface AdapterApplyContext {
  node: ComfyNode;
  ctx: CanvasRenderingContext2D;
  canvasSize: number;
  inputs: HTMLCanvasElement[];
  inputInfos?: RenderInputInfo[];
  outputSlot?: number | null;
  tick?: number;
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

export interface RenderInputInfo {
  canvas: HTMLCanvasElement;
  inputIndex: number;
  originSlot: number | null;
  upstreamNode?: ComfyNode | null;
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
  nativeAnimated: boolean;
  nativeDirty: boolean;
  cropAspectRatio: number | null;
  cropGeometry: CropPreviewGeometry | null;
  cropDrag: CropDragState | null;
  cropResetButton: HTMLButtonElement | null;
  cropInteractiveHooked: boolean;
  drawAspectRatio: number | null;
  drawGeometry: DrawPreviewGeometry | null;
  drawStroke: DrawStrokeState | null;
  drawCanvas: HTMLCanvasElement | null;
  drawBaseCanvas: HTMLCanvasElement | null;
  drawOverlayKey: string | null;
  drawBrushButton: HTMLButtonElement | null;
  drawEraserButton: HTMLButtonElement | null;
  drawClearButton: HTMLButtonElement | null;
  drawColorInput: HTMLInputElement | null;
  drawOpacityInput: HTMLInputElement | null;
  drawOpacityLabel: HTMLDivElement | null;
  drawSizeInput: HTMLInputElement | null;
  drawSizeLabel: HTMLDivElement | null;
  drawWidthInput: HTMLInputElement | null;
  drawHeightInput: HTMLInputElement | null;
  drawLinkButton: HTMLButtonElement | null;
  drawBgColorInput: HTMLInputElement | null;
  drawInteractiveHooked: boolean;
  compLayers: CompLayerPreviewGeometry[];
  compOutputWidth: number;
  compOutputHeight: number;
  compSelectedSlot: string | null;
  compDrag: CompDragState | null;
  compAddButton: HTMLButtonElement | null;
  compResetButton: HTMLButtonElement | null;
  compModeSelect: HTMLSelectElement | null;
  compOpacityInput: HTMLInputElement | null;
  compOpacityLabel: HTMLDivElement | null;
  compLayerLabel: HTMLDivElement | null;
  compInteractiveHooked: boolean;
}

export interface CropPreviewGeometry {
  sourceWidth: number;
  sourceHeight: number;
  fitDx: number;
  fitDy: number;
  fitDrawWidth: number;
  fitDrawHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

export type CropDragMode = "move" | "nw" | "ne" | "sw" | "se";

export interface CropDragState {
  pointerId: number;
  mode: CropDragMode;
  startCanvasX: number;
  startCanvasY: number;
  startCenterX: number;
  startCenterY: number;
  startScale: number;
  startCropX: number;
  startCropY: number;
  startCropWidth: number;
  startCropHeight: number;
}

export interface DrawPreviewGeometry {
  sourceWidth: number;
  sourceHeight: number;
  fitDx: number;
  fitDy: number;
  fitDrawWidth: number;
  fitDrawHeight: number;
}

export interface DrawStrokeState {
  pointerId: number;
  lastX: number;
  lastY: number;
}

export interface CompLayerPreviewGeometry {
  slot: string;
  layerNumber: number;
  inputIndex: number;
  sourceWidth: number;
  sourceHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CompDragMode = "move" | "nw" | "ne" | "sw" | "se";

export interface CompDragState {
  pointerId: number;
  slot: string;
  mode: CompDragMode;
  startCanvasX: number;
  startCanvasY: number;
  startCenterX: number;
  startCenterY: number;
  startScale: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface ScopesElements {
  histCanvas: HTMLCanvasElement;
  waveCanvas: HTMLCanvasElement;
  vecCanvas: HTMLCanvasElement;
}

export interface MediaState {
  lastImageURL?: string;
  imageEl?: HTMLImageElement;
  lastBitmapURL?: string;
  lastBitmap?: ImageBitmap;
  videoEl?: HTMLVideoElement;
  lastVideoURL?: string;
}

// ── Media / source ──

export interface MediaSource {
  kind: "image" | "video";
  value: string;
  animated?: boolean;
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
