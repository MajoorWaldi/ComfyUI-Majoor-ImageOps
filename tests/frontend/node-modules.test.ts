import type {
  ComfyNode,
  CompDragMode,
  CompLayerPreviewGeometry,
  CornerPinHandle,
  CornerPinPreviewGeometry,
  CropDragMode,
  CropPreviewGeometry,
  DrawPreviewGeometry,
  DrawRenderSession,
  PadOutDragMode,
  PadOutPreviewGeometry,
} from "../../src/types.js";

import * as blur from "../../src/preview/nodes/blur.js";
import * as channel from "../../src/preview/nodes/channel.js";
import * as clamp from "../../src/preview/nodes/clamp.js";
import * as colorCorrect from "../../src/preview/nodes/color-correct.js";
import * as comp from "../../src/preview/nodes/comp.js";
import * as cornerPin from "../../src/preview/nodes/corner-pin.js";
import * as crop from "../../src/preview/nodes/crop.js";
import * as distort from "../../src/preview/nodes/distort.js";
import * as drawRenderer from "../../src/preview/nodes/draw-renderer.js";
import * as draw from "../../src/preview/nodes/draw.js";
import * as invert from "../../src/preview/nodes/invert.js";
import * as maskConvert from "../../src/preview/nodes/mask-convert.js";
import * as merge from "../../src/preview/nodes/merge.js";
import * as noise from "../../src/preview/nodes/noise.js";
import * as padOutStitch from "../../src/preview/nodes/pad-out-stitch.js";
import * as padOut from "../../src/preview/nodes/pad-out.js";
import * as preview from "../../src/preview/nodes/preview.js";
import * as transform from "../../src/preview/nodes/transform.js";

type BasicNodeModule = {
  NODE_CLASS: string;
  isNode(node: ComfyNode): boolean;
};

const blurModule: BasicNodeModule = blur;
const channelModule: BasicNodeModule = channel;
const clampModule: BasicNodeModule = clamp;
const colorCorrectModule: BasicNodeModule = colorCorrect;
const compModule: BasicNodeModule = comp;
const cornerPinModule: BasicNodeModule = cornerPin;
const cropModule: BasicNodeModule = crop;
const distortModule: BasicNodeModule = distort;
const drawModule: BasicNodeModule = draw;
const invertModule: BasicNodeModule = invert;
const maskConvertModule: BasicNodeModule = maskConvert;
const mergeModule: BasicNodeModule = merge;
const noiseModule: BasicNodeModule = noise;
const padOutStitchModule: BasicNodeModule = padOutStitch;
const padOutModule: BasicNodeModule = padOut;
const previewModule: BasicNodeModule = preview;
const transformModule: BasicNodeModule = transform;

const compHelpers = {
  hideCompWidgets: comp.hideCompWidgets,
  ensureCompInputs: comp.ensureCompInputs,
  readCompLayers: comp.readCompLayers,
  writeCompLayers: comp.writeCompLayers,
  getCompInfoText: comp.getCompInfoText,
  getCompCursor: comp.getCompCursor,
  cloneCompCorners: comp.cloneCompCorners,
  clearCompLayerCorners: comp.clearCompLayerCorners,
  compDragHandleToCorner: comp.compDragHandleToCorner,
  ensureCompState: comp.ensureCompState,
  updateCompControls: comp.updateCompControls,
  updateSelectedCompLayer: comp.updateSelectedCompLayer,
  compCanvasToOutputPoint: comp.compCanvasToOutputPoint,
  getCompHit: comp.getCompHit,
  writeCompLayerCorners: comp.writeCompLayerCorners,
  getCompCanvasMetrics: comp.getCompCanvasMetrics,
} satisfies {
  hideCompWidgets(node: ComfyNode): void;
  ensureCompInputs(node: ComfyNode, minLayers?: number): void;
  readCompLayers(node: ComfyNode): unknown[];
  writeCompLayers(node: ComfyNode, layers: unknown[]): void;
  getCompInfoText(node: ComfyNode, connectedLayers: number, totalLayers: number, width: number, height: number): string;
  getCompCursor(mode: CompDragMode | "move" | null): string;
  cloneCompCorners(corners: Record<CornerPinHandle, { x: number; y: number }> | null): Record<CornerPinHandle, { x: number; y: number }> | null;
  clearCompLayerCorners(layer: unknown): void;
  compDragHandleToCorner(mode: CompDragMode): CornerPinHandle | null;
  ensureCompState(node: ComfyNode): unknown[];
  updateCompControls(node: ComfyNode): void;
  updateSelectedCompLayer(node: ComfyNode, updater: (layer: unknown) => void): void;
  compCanvasToOutputPoint(node: ComfyNode, canvasWidth: number, canvasHeight: number, x: number, y: number): { x: number; y: number };
  getCompHit(node: ComfyNode, canvasWidth: number, canvasHeight: number, x: number, y: number): { layer: CompLayerPreviewGeometry; mode: CompDragMode | "move" } | null;
  writeCompLayerCorners(
    node: ComfyNode,
    layer: unknown,
    corners: { tl: { x: number; y: number }; tr: { x: number; y: number }; bl: { x: number; y: number }; br: { x: number; y: number } },
  ): void;
  getCompCanvasMetrics(layer: CompLayerPreviewGeometry, fit: { dx: number; dy: number; drawWidth: number; drawHeight: number }, outputWidth: number, outputHeight: number): unknown;
};

const cornerPinHelpers = {
  getCornerPinInfoText: cornerPin.getCornerPinInfoText,
  cornerPinCanvasPoint: cornerPin.cornerPinCanvasPoint,
  cornerPinControlPoints: cornerPin.cornerPinControlPoints,
  getCornerPinHit: cornerPin.getCornerPinHit,
  cornerPinCanvasToNormalized: cornerPin.cornerPinCanvasToNormalized,
  setCornerPinHandle: cornerPin.setCornerPinHandle,
} satisfies {
  getCornerPinInfoText(node: ComfyNode, width: number, height: number): string;
  cornerPinCanvasPoint(geometry: CornerPinPreviewGeometry, xNorm: number, yNorm: number): { x: number; y: number };
  cornerPinControlPoints(node: ComfyNode, geometry: CornerPinPreviewGeometry): Record<CornerPinHandle, { x: number; y: number }>;
  getCornerPinHit(node: ComfyNode, geometry: CornerPinPreviewGeometry | null, x: number, y: number): CornerPinHandle | null;
  cornerPinCanvasToNormalized(geometry: CornerPinPreviewGeometry, x: number, y: number): { xNorm: number; yNorm: number };
  setCornerPinHandle(node: ComfyNode, handle: CornerPinHandle, xNorm: number, yNorm: number): void;
};

const cropHelpers = {
  hideCropGeometryWidgets: crop.hideCropGeometryWidgets,
  resolveCropAspectRatioValue: crop.resolveCropAspectRatioValue,
  getCropControlState: crop.getCropControlState,
  setCropControlState: crop.setCropControlState,
  resetCropControlState: crop.resetCropControlState,
  isFreeCropResizeEnabled: crop.isFreeCropResizeEnabled,
  getCropCanvasMetrics: crop.getCropCanvasMetrics,
  getCropInfoText: crop.getCropInfoText,
  getCropInteractionMode: crop.getCropInteractionMode,
  getCropCursor: crop.getCropCursor,
  canvasToSourcePoint: crop.canvasToSourcePoint,
  syncCropWidgets: crop.syncCropWidgets,
  setCropOutputDimensions: crop.setCropOutputDimensions,
  cropRectFromAnchor: crop.cropRectFromAnchor,
  freeCropRectFromAnchor: crop.freeCropRectFromAnchor,
} satisfies {
  hideCropGeometryWidgets(node: ComfyNode): void;
  resolveCropAspectRatioValue(node: ComfyNode, fallbackWidth?: number, fallbackHeight?: number): number;
  getCropControlState(node: ComfyNode, fallbackWidth?: number, fallbackHeight?: number): unknown;
  setCropControlState(node: ComfyNode, centerX: number, centerY: number, scale: number): void;
  resetCropControlState(node: ComfyNode): void;
  isFreeCropResizeEnabled(node: ComfyNode): boolean;
  getCropCanvasMetrics(left: number, top: number, width: number, height: number): unknown;
  getCropInfoText(node: ComfyNode): string;
  getCropInteractionMode(geometry: CropPreviewGeometry | null, x: number, y: number): CropDragMode | "move" | null;
  getCropCursor(mode: CropDragMode | "move" | null): string;
  canvasToSourcePoint(geometry: CropPreviewGeometry, x: number, y: number): { x: number; y: number };
  syncCropWidgets(node: ComfyNode, changedName?: string): void;
  setCropOutputDimensions(node: ComfyNode, width: number, height: number): void;
  cropRectFromAnchor(...args: unknown[]): unknown;
  freeCropRectFromAnchor(...args: unknown[]): unknown;
};

const drawHelpers = {
  hideDrawWidgets: draw.hideDrawWidgets,
  canvasToDrawSourcePoint: draw.canvasToDrawSourcePoint,
  getDrawInfoText: draw.getDrawInfoText,
  updateDrawToolButtons: draw.updateDrawToolButtons,
  updateDrawOverlayWidget: draw.updateDrawOverlayWidget,
  syncDrawWidgets: draw.syncDrawWidgets,
} satisfies {
  hideDrawWidgets(node: ComfyNode): void;
  canvasToDrawSourcePoint(geometry: DrawPreviewGeometry | null, x: number, y: number): { x: number; y: number; inside: boolean };
  getDrawInfoText(node: ComfyNode, width: number, height: number): string;
  updateDrawToolButtons(node: ComfyNode): void;
  updateDrawOverlayWidget(node: ComfyNode): void;
  syncDrawWidgets(node: ComfyNode, changedName?: string): void;
};

const drawRendererHelpers = {
  strokeStyle: drawRenderer.strokeStyle,
  drawPointerDynamics: drawRenderer.drawPointerDynamics,
  paintDrawSegment: drawRenderer.paintDrawSegment,
  drawBrushCursorOverlay: drawRenderer.drawBrushCursorOverlay,
  cloneCanvas: drawRenderer.cloneCanvas,
  restoreCanvas: drawRenderer.restoreCanvas,
  pushDrawUndoSnapshot: drawRenderer.pushDrawUndoSnapshot,
  popDrawUndoSnapshot: drawRenderer.popDrawUndoSnapshot,
  setDrawBrushSize: drawRenderer.setDrawBrushSize,
  ensureDrawCanvasSize: drawRenderer.ensureDrawCanvasSize,
  deriveMaskCanvasFromCanvas: drawRenderer.deriveMaskCanvasFromCanvas,
  renderDrawNode: drawRenderer.renderDrawNode,
  setDrawTool: drawRenderer.setDrawTool,
  ensureDrawInteractionReady: drawRenderer.ensureDrawInteractionReady,
  renderDrawMaskCanvas: drawRenderer.renderDrawMaskCanvas,
  renderMaskCanvasFromNode: drawRenderer.renderMaskCanvasFromNode,
  renderMaskInputForComp: drawRenderer.renderMaskInputForComp,
} satisfies {
  strokeStyle(color: string, opacity: number): string;
  drawPointerDynamics(node: ComfyNode, event?: PointerEvent): { size: number; opacity: number };
  paintDrawSegment(node: ComfyNode, fromX: number, fromY: number, toX: number, toY: number, dynamics?: { size: number; opacity: number }): void;
  drawBrushCursorOverlay(node: ComfyNode, ctx: CanvasRenderingContext2D): void;
  cloneCanvas(source: HTMLCanvasElement | null): HTMLCanvasElement | null;
  restoreCanvas(target: HTMLCanvasElement | null, snapshot: HTMLCanvasElement | null): void;
  pushDrawUndoSnapshot(node: ComfyNode, snapshot: HTMLCanvasElement | null): void;
  popDrawUndoSnapshot(node: ComfyNode): HTMLCanvasElement | null;
  setDrawBrushSize(node: ComfyNode, size: number): void;
  ensureDrawCanvasSize(node: ComfyNode, width: number, height: number, persist?: boolean): void;
  deriveMaskCanvasFromCanvas(source: HTMLCanvasElement): HTMLCanvasElement;
  renderDrawNode(node: ComfyNode, tick: number, session: DrawRenderSession): Promise<void>;
  setDrawTool(node: ComfyNode, tool: "brush" | "eraser", session: DrawRenderSession): void;
  ensureDrawInteractionReady(node: ComfyNode, session: DrawRenderSession): Promise<boolean>;
  renderDrawMaskCanvas(node: ComfyNode, tick: number, session: DrawRenderSession): Promise<HTMLCanvasElement>;
  renderMaskCanvasFromNode(upstream: ComfyNode, tick: number, session: DrawRenderSession, outputSlot?: number | null): Promise<HTMLCanvasElement | null>;
  renderMaskInputForComp(node: ComfyNode, inputIndex: number, tick: number, session: DrawRenderSession): Promise<HTMLCanvasElement | null>;
};

const padOutHelpers = {
  getPadOutInfoText: padOut.getPadOutInfoText,
  getPadOutInteractionMode: padOut.getPadOutInteractionMode,
  getPadOutCursor: padOut.getPadOutCursor,
} satisfies {
  getPadOutInfoText(node: ComfyNode, width: number, height: number): string;
  getPadOutInteractionMode(geometry: PadOutPreviewGeometry | null, x: number, y: number): PadOutDragMode | "move" | null;
  getPadOutCursor(mode: PadOutDragMode | "move" | null): string;
};

const previewHelpers = {
  hidePreviewWidgets: preview.hidePreviewWidgets,
  syncPreviewWidgets: preview.syncPreviewWidgets,
} satisfies {
  hidePreviewWidgets(node: ComfyNode): void;
  syncPreviewWidgets(node: ComfyNode): void;
};

const colorCorrectHelpers = {
  syncColorCorrectWidgets: colorCorrect.syncColorCorrectWidgets,
} satisfies {
  syncColorCorrectWidgets(node: ComfyNode): void;
};

void [
  blurModule,
  channelModule,
  clampModule,
  colorCorrectModule,
  compModule,
  cornerPinModule,
  cropModule,
  distortModule,
  drawModule,
  invertModule,
  maskConvertModule,
  mergeModule,
  noiseModule,
  padOutStitchModule,
  padOutModule,
  previewModule,
  transformModule,
  compHelpers,
  cornerPinHelpers,
  cropHelpers,
  drawHelpers,
  drawRendererHelpers,
  padOutHelpers,
  previewHelpers,
  colorCorrectHelpers,
];
