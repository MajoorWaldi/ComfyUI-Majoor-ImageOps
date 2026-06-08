// ── Shared type definitions for ComfyUI-Majoor-ImageOps ──

// ── ComfyUI / LiteGraph ──

export interface ComfyApp {
  registerExtension(ext: ComfyExtension): void;
  graph: LGraph;
}

export interface ComfyExtension {
  name: string;
  beforeRegisterNodeDef?(nodeType: ComfyNodeConstructor, nodeData: any): Promise<void> | void;
  nodeCreated?(node: ComfyNode): void;
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
  computeSize?: (size?: [number, number] | number) => [number, number];
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
  id?: number;
  origin_id?: number;
  originId?: number;
  origin_slot?: number;
  originSlot?: number;
  target_id?: number;
  targetId?: number;
  target_slot?: number;
  targetSlot?: number;
  type?: string;
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
  computeSize?(size?: [number, number] | number): [number, number];
  setSize?(size: [number, number]): void;
  addDOMWidget?(name: string, type: string, el: HTMLElement, opts: any): void;
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
  renderInputAt?: (inputInfo: RenderInputInfo, tick: number) => Promise<HTMLCanvasElement | null>;
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
  _abortController?: AbortController | null;
  previewRoot: HTMLDivElement | null;
  previewMetaRow: HTMLDivElement | null;
  previewControls: HTMLElement | null;
  canvas: HTMLCanvasElement | null;
  info: HTMLDivElement | null;
  progressWrap: HTMLDivElement | null;
  progressBar: HTMLDivElement | null;
  mediaWrap: HTMLDivElement | null;
  mediaVideo: HTMLVideoElement | null;
  mediaImage: HTMLImageElement | null;
  interactionUntil: number;
  rafId: number | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  lastKey: string | null;
  lastRenderTick: number | null;
  renderInFlight: boolean;
  queuedRenderTick: number | null;
  isPreview: boolean;
  nativeAnimated: boolean;
  nativeDirty: boolean;
  previewZoom: number;
  previewPanX: number;
  previewPanY: number;
  previewPanDrag: { pointerId: number; startCanvasX: number; startCanvasY: number; startPanX: number; startPanY: number } | null;
  previewNavigationHooked: boolean;
  previewLastSource: CanvasImageSource | null;
  previewSourceWidth: number;
  previewSourceHeight: number;
  previewFrameIndex: number | null;
  cropAspectRatio: number | null;
  cropGeometry: CropPreviewGeometry | null;
  cropDrag: CropDragState | null;
  cropResetButton: HTMLButtonElement | null;
  cropInteractiveHooked: boolean;
  rampGeometry: RampPreviewGeometry | null;
  rampDrag: RampDragState | null;
  rampInteractiveHooked: boolean;
  drawAspectRatio: number | null;
  drawGeometry: DrawPreviewGeometry | null;
  drawHover: { canvasX: number; canvasY: number; inside: boolean } | null;
  drawSizeHintUntil: number;
  drawStroke: DrawStrokeState | null;
  drawCanvas: HTMLCanvasElement | null;
  drawBaseCanvas: HTMLCanvasElement | null;
  drawUndoStack: HTMLCanvasElement[];
  drawOverlayKey: string | null;
  drawBrushButton: HTMLButtonElement | null;
  drawEraserButton: HTMLButtonElement | null;
  drawClearButton: HTMLButtonElement | null;
  drawColorInput: HTMLInputElement | null;
  drawEdgeSelect: HTMLSelectElement | null;
  drawSoftnessInput: HTMLInputElement | null;
  drawSoftnessLabel: HTMLDivElement | null;
  drawOpacityInput: HTMLInputElement | null;
  drawOpacityLabel: HTMLDivElement | null;
  drawSizeInput: HTMLInputElement | null;
  drawSizeLabel: HTMLDivElement | null;
  drawWidthInput: HTMLInputElement | null;
  drawHeightInput: HTMLInputElement | null;
  drawLinkButton: HTMLButtonElement | null;
  drawBgColorInput: HTMLInputElement | null;
  drawOverlayFormatSelect: HTMLSelectElement | null;
  drawPressureSizeInput: HTMLInputElement | null;
  drawPressureOpacityInput: HTMLInputElement | null;
  drawTiltSizeInput: HTMLInputElement | null;
  drawInteractiveHooked: boolean;
  colorWheelCanvas: HTMLCanvasElement | null;
  colorHueLabel: HTMLDivElement | null;
  colorSatLabel: HTMLDivElement | null;
  colorSwatch: HTMLDivElement | null;
  colorResetButton: HTMLButtonElement | null;
  colorTemperatureInput: HTMLInputElement | null;
  colorTemperatureLabel: HTMLDivElement | null;
  colorTintInput: HTMLInputElement | null;
  colorTintLabel: HTMLDivElement | null;
  colorContrastInput: HTMLInputElement | null;
  colorContrastLabel: HTMLDivElement | null;
  colorSaturationInput: HTMLInputElement | null;
  colorSaturationValueLabel: HTMLDivElement | null;
  colorVibranceInput: HTMLInputElement | null;
  colorVibranceLabel: HTMLDivElement | null;
  colorGammaInput: HTMLInputElement | null;
  colorGammaLabel: HTMLDivElement | null;
  colorShadowWheelCanvas: HTMLCanvasElement | null;
  colorShadowLabel: HTMLDivElement | null;
  colorMidtoneWheelCanvas: HTMLCanvasElement | null;
  colorMidtoneLabel: HTMLDivElement | null;
  colorHighlightWheelCanvas: HTMLCanvasElement | null;
  colorHighlightLabel: HTMLDivElement | null;
  colorBrightnessInput: HTMLInputElement | null;
  colorBrightnessLabel: HTMLDivElement | null;
  colorZoneTabsRow: HTMLDivElement | null;
  colorZoneTabGlobal: HTMLButtonElement | null;
  colorZoneTabShadows: HTMLButtonElement | null;
  colorZoneTabMidtones: HTMLButtonElement | null;
  colorZoneTabHighlights: HTMLButtonElement | null;
  // Active zone for the per-zone primaries UI. "global" maps to the
  // existing widget names; the others map to e.g. shadows_<param>.
  colorActiveZone: "global" | "shadows" | "midtones" | "highlights";
  colorInteractiveHooked: boolean;
  compLayers: CompLayerPreviewGeometry[];
  compOutputWidth: number;
  compOutputHeight: number;
  compSelectedSlot: string | null;
  compDrag: CompDragState | null;
  compAddButton: HTMLButtonElement | null;
  compRemoveButton: HTMLButtonElement | null;
  compResetButton: HTMLButtonElement | null;
  compResizeButton: HTMLButtonElement | null;
  compCornerPinButton: HTMLButtonElement | null;
  compAspectRatioSelect: HTMLSelectElement | null;
  compModeSelect: HTMLSelectElement | null;
  compOpacityInput: HTMLInputElement | null;
  compOpacityLabel: HTMLDivElement | null;
  compLayerLabel: HTMLDivElement | null;
  compEditMode: "resize" | "cornerpin";
  compInteractiveHooked: boolean;
  cornerPinGeometry: CornerPinPreviewGeometry | null;
  cornerPinDrag: CornerPinDragState | null;
  cornerPinInteractiveHooked: boolean;
  padOutGeometry: PadOutPreviewGeometry | null;
  padOutDrag: PadOutDragState | null;
  padOutInteractiveHooked: boolean;
  padOutSourceWidth: number;
  padOutSourceHeight: number;
  padOutSourceCanvas: HTMLCanvasElement | null;
  padOutBackendSourceW: number;
  padOutBackendSourceH: number;
  padOutBackendPadL: number;
  padOutBackendPadT: number;
  joinBackendClipCounts?: Array<{ slot: number; source_count: number; trimmed_count: number; start: number; end: number }>;
  frameSelectorControls: HTMLDivElement | null;
  frameSelectorLabel: HTMLDivElement | null;
  frameSelectorTrimStart: HTMLInputElement | null;
  frameSelectorTrimEnd: HTMLInputElement | null;
  frameSelectorHoldFrame: HTMLInputElement | null;
  frameSelectorRuler: HTMLDivElement | null;
  frameSelectorSliderBox: HTMLDivElement | null;
  frameSelectorFill: HTMLDivElement | null;
  frameSelectorStartHandle: HTMLDivElement | null;
  frameSelectorEndHandle: HTMLDivElement | null;
  frameSelectorPlayhead: HTMLDivElement | null;
  frameSelectorHoldToggle: HTMLButtonElement | null;
  frameSelectorRepeatToggle: HTMLButtonElement | null;
  frameSelectorRepeatModeSelect: HTMLSelectElement | null;
  frameSelectorRepeatCountInput: HTMLInputElement | null;
  frameSelectorSourceCount: number;
  frameSelectorHooked: boolean;
  keyerControls: HTMLDivElement | null;
  keyerModeButtons: HTMLButtonElement[];
  keyerInvertButton: HTMLButtonElement | null;
  keyerInvertMaskButton: HTMLButtonElement | null;
  keyerBypassButton: HTMLButtonElement | null;
  keyerPickButton: HTMLButtonElement | null;
  keyerColorInput: HTMLInputElement | null;
  keyerToleranceInput: HTMLInputElement | null;
  keyerSoftnessInput: HTMLInputElement | null;
  keyerGainInput: HTMLInputElement | null;
  keyerBlurInput: HTMLInputElement | null;
  keyerPicking?: boolean;
  keyerHooked?: boolean;
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
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
    coordinateSpace: "source";
  };
}

export type CropDragMode = "move" | "n" | "e" | "s" | "w" | "nw" | "ne" | "sw" | "se";

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
  startOutputWidth: number;
  startOutputHeight: number;
}

export interface DrawPreviewGeometry {
  sourceWidth: number;
  sourceHeight: number;
  fitDx: number;
  fitDy: number;
  fitDrawWidth: number;
  fitDrawHeight: number;
}

export interface RampPreviewGeometry {
  sourceWidth: number;
  sourceHeight: number;
  fitDx: number;
  fitDy: number;
  fitDrawWidth: number;
  fitDrawHeight: number;
}

export type RampHandle = "start" | "end";

export interface RampDragState {
  pointerId: number;
  handle: RampHandle;
}

export interface DrawStrokeState {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  snapshot: HTMLCanvasElement | null;
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
  centerX: number;
  centerY: number;
  drawWidth: number;
  drawHeight: number;
  rotationDeg: number;
  corners: Record<CornerPinHandle, { x: number; y: number }> | null;
  cornerPinned: boolean;
}

export type CompDragMode = "move" | "nw" | "ne" | "sw" | "se" | "rotate";

export interface CompDragState {
  pointerId: number;
  slot: string;
  mode: CompDragMode;
  startCanvasX: number;
  startCanvasY: number;
  startCenterX: number;
  startCenterY: number;
  startScale: number;
  startRotationDeg: number;
  startPointerAngle: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startHeight: number;
  startOutputCenterX: number;
  startOutputCenterY: number;
  startDrawWidth: number;
  startDrawHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  startCorners: Record<CornerPinHandle, { x: number; y: number }> | null;
}

export interface CornerPinPreviewGeometry {
  sourceWidth: number;
  sourceHeight: number;
  fitDx: number;
  fitDy: number;
  fitDrawWidth: number;
  fitDrawHeight: number;
}

export type CornerPinHandle = "tl" | "tr" | "bl" | "br";

export interface CornerPinDragState {
  pointerId: number;
  handle: CornerPinHandle;
}

export interface PadOutPreviewGeometry {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  padLeft: number;
  padTop: number;
  padRight: number;
  padBottom: number;
  fitDx: number;
  fitDy: number;
  fitDrawWidth: number;
  fitDrawHeight: number;
}

export type PadOutDragMode = "move" | "n" | "e" | "s" | "w" | "nw" | "ne" | "sw" | "se";

export interface PadOutDragState {
  pointerId: number;
  mode: PadOutDragMode;
  startCanvasX: number;
  startCanvasY: number;
  startPadLeft: number;
  startPadTop: number;
  startPadRight: number;
  startPadBottom: number;
}

export interface MediaState {
  lastImageURL?: string;
  imageEl?: HTMLImageElement;
  lastBitmapURL?: string;
  lastBitmap?: ImageBitmap;
  videoEl?: HTMLVideoElement;
  lastVideoURL?: string;
  imageCanvas?: HTMLCanvasElement;
  animatedImageCanvas?: HTMLCanvasElement;
  videoCanvas?: HTMLCanvasElement;
  nativeCanvas?: HTMLCanvasElement;
  staticRenderCache?: Map<string, HTMLCanvasElement>;
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

// ── Interaction context ──
// Callbacks passed from host.ts to interactions/* files to avoid circular deps.

export interface NodeInteractionContext {
  /** Re-schedules a debounced render for this node. */
  schedule(node: ComfyNode, fn: () => void, delayMs?: number): void;
  /** Clears the shared dirty flag so the next RAF triggers a render. */
  markCanvasDirty(): void;
  /** Starts the video playback loop when the node outputs a video. */
  startLoopIfVideo(node: ComfyNode): void;
  /** Schedules a re-render of all downstream dependents. */
  refreshDependents(node: ComfyNode): void;
  /** Refreshes only this node's live preview during high-frequency pointer interaction. */
  refreshPreviewOnly(node: ComfyNode, delayMs?: number): void;
  /**
   * Convenience: sets nativeDirty, extends the interaction hold window,
   * marks canvas dirty, and schedules startLoopIfVideo + refreshDependents.
   */
  refreshNode(node: ComfyNode): void;
}

export interface CropInteractionContext extends NodeInteractionContext {
  setCropOutputDimensions(node: ComfyNode, width: number, height: number, notify?: boolean): void;
}

export interface CompInteractionContext extends NodeInteractionContext {
  markPreviewInteraction(node: ComfyNode, holdMs?: number): void;
  ensureCompState(node: ComfyNode): any[];
  updateCompControls(node: ComfyNode): void;
  updateSelectedCompLayer(node: ComfyNode, updater: (layer: any) => void, notify?: boolean): void;
  compCanvasToOutputPoint(node: ComfyNode, cw: number, ch: number, x: number, y: number): { x: number; y: number };
  getCompHit(node: ComfyNode, cw: number, ch: number, x: number, y: number): { layer: any; mode: any } | null;
  writeCompLayerCorners(node: ComfyNode, layer: any, corners: any): void;
}

export interface DrawInteractionContext extends NodeInteractionContext {
  markPreviewInteraction(node: ComfyNode, holdMs?: number): void;
  renderDrawNode(node: ComfyNode, tick: number): Promise<void>;
  ensureDrawCanvasSize(node: ComfyNode, w: number, h: number, persist?: boolean): void;
  setDrawTool(node: ComfyNode, tool: "brush" | "eraser"): void;
  cloneCanvas(src: HTMLCanvasElement | null): HTMLCanvasElement | null;
  restoreCanvas(target: HTMLCanvasElement | null, snap: HTMLCanvasElement | null): void;
  pushDrawUndoSnapshot(node: ComfyNode, snap: HTMLCanvasElement | null): void;
  popDrawUndoSnapshot(node: ComfyNode): HTMLCanvasElement | null;
  paintDrawSegment(node: ComfyNode, x1: number, y1: number, x2: number, y2: number, dynamics: { size: number; opacity: number }): void;
  ensureDrawInteractionReady(node: ComfyNode): Promise<boolean>;
  drawPointerDynamics(node: ComfyNode, event?: PointerEvent): { size: number; opacity: number };
  setDrawBrushSize(node: ComfyNode, size: number): void;
  updateDrawOverlayWidget(node: ComfyNode): void;
  syncDrawWidgets(node: ComfyNode, changedName?: string): void;
  syncDarkColorInputUI(input: HTMLInputElement | null, color?: string): void;
  setDarkColorInputState(input: HTMLInputElement | null, disabled: boolean, hidden?: boolean): void;
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
  playbackCanvasSize: number;
  interactionCanvasSize: number;
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
  waveform: Uint32Array;
  waveformR: Uint32Array;
  waveformG: Uint32Array;
  waveformB: Uint32Array;
  waveW: number;
  waveH: number;
  vectorscope: Uint32Array;
  vecSize: number;
}

// ── Progress ──

export interface ProgressBus {
  registerNodeWidget(node: ComfyNode, wrap: HTMLDivElement, bar: HTMLDivElement): void;
}

// ── Renderer ──

export interface ImageOpsRenderer {
  render(node: ComfyNode, tick: number, outputSlot: number | null, canvasSize: number): Promise<{ canvas: HTMLCanvasElement | null }>;
}

export interface DrawRenderSession {
  renderer: ImageOpsRenderer;
  progress: ProgressBus;
  canvasSize: number;
}
