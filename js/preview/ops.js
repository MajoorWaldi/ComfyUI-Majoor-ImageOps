// Shared ops implementation for live preview (v6)
// IMPORTANT: this module is the single place implementing preview ops. Nodes must not duplicate preview code.
import { getOpsConstants, initOpsConstants } from "./constants.js";

initOpsConstants();

function w(node, name) {
  return node?.widgets?.find(x => x?.name === name) ?? null;
}
function num(node, name, fallback=0) {
  const v = w(node,name)?.value;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function str(node, name, fallback="") {
  const v = w(node,name)?.value;
  return typeof v === "string" ? v : fallback;
}
function bool(node, name, fallback=false) {
  const v = w(node,name)?.value;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !!v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function luma01(r, g, b, lw) { return lw[0]*r + lw[1]*g + lw[2]*b; }

function getImageData(ctx, W, H) { return ctx.getImageData(0,0,W,H); }
function putImageData(ctx, img) { ctx.putImageData(img,0,0); }

function applyLevels(ctx, W, H, inMin, inMax, gamma, outMin, outMax) {
  const { epsilon: EPS, preview_gamma_epsilon: GE } = getOpsConstants();
  const img = getImageData(ctx,W,H);
  const d = img.data;
  const ig = 1/Math.max(GE,gamma);
  for (let i=0;i<d.length;i+=4){
    for (let c=0;c<3;c++){
      let v = d[i+c]/255;
      v = (v - inMin) / Math.max(EPS,(inMax - inMin));
      v = clamp01(v);
      v = Math.pow(v, ig);
      v = outMin + v*(outMax - outMin);
      d[i+c] = Math.round(clamp01(v)*255);
    }
  }
  putImageData(ctx,img);
}

function applyHueSat(ctx, W, H, hueDeg, sat, val) {
  const { epsilon: EPS } = getOpsConstants();
  const img = getImageData(ctx,W,H);
  const d = img.data;
  const hue = (hueDeg % 360) * Math.PI/180;
  for (let i=0;i<d.length;i+=4){
    let r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    const delta=max-min;
    let h0=0;
    if (delta>EPS){
      if (max===r) h0=((g-b)/delta)%6;
      else if (max===g) h0=(b-r)/delta+2;
      else h0=(r-g)/delta+4;
      h0 *= Math.PI/3;
    }
    let s0 = max===0?0:delta/max;
    let v0 = max;

    h0 += hue;
    s0 = clamp01(s0*sat);
    v0 = clamp01(v0*val);

    const c=v0*s0;
    const x=c*(1-Math.abs(((h0/(Math.PI/3))%2)-1));
    const m=v0-c;
    let rp=0,gp=0,bp=0;
    const hh=((h0%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
    const sector=Math.floor(hh/(Math.PI/3));
    switch(sector){
      case 0: rp=c; gp=x; bp=0; break;
      case 1: rp=x; gp=c; bp=0; break;
      case 2: rp=0; gp=c; bp=x; break;
      case 3: rp=0; gp=x; bp=c; break;
      case 4: rp=x; gp=0; bp=c; break;
      case 5: rp=c; gp=0; bp=x; break;
    }
    d[i]=Math.round(clamp01(rp+m)*255);
    d[i+1]=Math.round(clamp01(gp+m)*255);
    d[i+2]=Math.round(clamp01(bp+m)*255);
  }
  putImageData(ctx,img);
}

function applyInvert(ctx, W, H, invertAlpha=false) {
  const img=getImageData(ctx,W,H);
  const d=img.data;
  for (let i=0;i<d.length;i+=4){
    d[i]=255-d[i];
    d[i+1]=255-d[i+1];
    d[i+2]=255-d[i+2];
    if (invertAlpha) d[i+3]=255-d[i+3];
  }
  putImageData(ctx,img);
}

function applyClamp(ctx, W, H, minV, maxV) {
  const mn=Math.round(clamp01(minV)*255);
  const mx=Math.round(clamp01(maxV)*255);
  const img=getImageData(ctx,W,H);
  const d=img.data;
  for (let i=0;i<d.length;i+=4){
    d[i]=Math.max(mn,Math.min(mx,d[i]));
    d[i+1]=Math.max(mn,Math.min(mx,d[i+1]));
    d[i+2]=Math.max(mn,Math.min(mx,d[i+2]));
  }
  putImageData(ctx,img);
}

function applyColorCorrect(ctx, W, H, brightness, contrast, gamma, saturation) {
  const { luma_weights: LW, gamma_safe_min: GMIN, gamma_max: GMAX, preview_gamma_epsilon: GE } = getOpsConstants();
  const img=getImageData(ctx,W,H);
  const d=img.data;
  const g = Math.max(GMIN, Math.min(GMAX, gamma));
  const invGamma=1/Math.max(GE,g);

  for (let i=0;i<d.length;i+=4){
    let r=d[i]/255,g=d[i+1]/255,b=d[i+2]/255;
    r += brightness; g += brightness; b += brightness;
    r = (r-0.5)*contrast+0.5;
    g = (g-0.5)*contrast+0.5;
    b = (b-0.5)*contrast+0.5;
    r=clamp01(r); g=clamp01(g); b=clamp01(b);
    r=Math.pow(r,invGamma);
    g=Math.pow(g,invGamma);
    b=Math.pow(b,invGamma);

    const l=luma01(r,g,b,LW);
    r = l + (r-l)*saturation;
    g = l + (g-l)*saturation;
    b = l + (b-l)*saturation;

    d[i]=Math.round(clamp01(r)*255);
    d[i+1]=Math.round(clamp01(g)*255);
    d[i+2]=Math.round(clamp01(b)*255);
  }
  putImageData(ctx,img);
}

function applyUnsharp(ctx, W, H, amount=1.0) {
  const tmp=document.createElement("canvas");
  tmp.width=W; tmp.height=H;
  const tctx=tmp.getContext("2d");
  tctx.filter="blur(2px)";
  tctx.drawImage(ctx.canvas,0,0);
  tctx.filter="none";
  const o=getImageData(ctx,W,H);
  const b=tctx.getImageData(0,0,W,H);
  const d=o.data, bd=b.data;
  const a=Math.max(0,amount);
  for (let i=0;i<d.length;i+=4){
    d[i]=Math.max(0,Math.min(255,d[i]+a*(d[i]-bd[i])));
    d[i+1]=Math.max(0,Math.min(255,d[i+1]+a*(d[i+1]-bd[i+1])));
    d[i+2]=Math.max(0,Math.min(255,d[i+2]+a*(d[i+2]-bd[i+2])));
  }
  putImageData(ctx,o);
}

function applyEdgeDetect(ctx, W, H, strength=1.0) {
  const { luma_weights: LW } = getOpsConstants();
  const img=getImageData(ctx,W,H);
  const d=img.data;
  const g=new Float32Array(W*H);
  for (let y=0;y<H;y++){
    for (let x=0;x<W;x++){
      const i=(y*W+x)*4;
      g[y*W+x]=luma01(d[i]/255, d[i+1]/255, d[i+2]/255, LW);
    }
  }
  const out=new Uint8ClampedArray(d.length);
  const k=strength;
  for (let y=1;y<H-1;y++){
    for (let x=1;x<W-1;x++){
      const gx = -1*g[(y-1)*W+(x-1)] + 1*g[(y-1)*W+(x+1)] +
                 -2*g[(y)*W+(x-1)]   + 2*g[(y)*W+(x+1)]   +
                 -1*g[(y+1)*W+(x-1)] + 1*g[(y+1)*W+(x+1)];
      const gy = -1*g[(y-1)*W+(x-1)] + -2*g[(y-1)*W+(x)] + -1*g[(y-1)*W+(x+1)] +
                  1*g[(y+1)*W+(x-1)] +  2*g[(y+1)*W+(x)] +  1*g[(y+1)*W+(x+1)];
      const mag = clamp01(Math.sqrt(gx*gx+gy*gy)*k);
      const v=Math.round(mag*255);
      const i=(y*W+x)*4;
      out[i]=v; out[i+1]=v; out[i+2]=v; out[i+3]=255;
    }
  }
  img.data.set(out);
  putImageData(ctx,img);
}

function applyBlur(ctx, W, H, radiusPx) {
  const r=Math.max(0,Math.round(radiusPx));
  if (r<=0) return;
  const tmp=document.createElement("canvas");
  tmp.width=W; tmp.height=H;
  const tctx=tmp.getContext("2d");
  tctx.filter=`blur(${r}px)`;
  tctx.drawImage(ctx.canvas,0,0);
  tctx.filter="none";
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(tmp,0,0);
}

function applyTransform(ctx, W, H, tx, ty, rotDeg, scale) {
  const tmp=document.createElement("canvas");
  tmp.width=W; tmp.height=H;
  const tctx=tmp.getContext("2d");
  const cx=W/2, cy=H/2;
  const rad=rotDeg*Math.PI/180;
  const sc=scale;
  tctx.save();
  tctx.translate(cx+tx, cy+ty);
  tctx.rotate(rad);
  tctx.scale(sc, sc);
  tctx.translate(-cx, -cy);
  tctx.drawImage(ctx.canvas,0,0);
  tctx.restore();
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(tmp,0,0);
}

function applyGlow(ctx, W, H, threshold, intensity, blurPx) {
  const { luma_weights: LW } = getOpsConstants();
  const base=getImageData(ctx,W,H);
  const d=base.data;
  const hi=new Uint8ClampedArray(d.length);
  for (let i=0;i<d.length;i+=4){
    const l=luma01(d[i]/255, d[i+1]/255, d[i+2]/255, LW);
    if (l>=threshold){
      hi[i]=d[i]; hi[i+1]=d[i+1]; hi[i+2]=d[i+2]; hi[i+3]=d[i+3];
    }
  }
  const tmp=document.createElement("canvas");
  tmp.width=W; tmp.height=H;
  const tctx=tmp.getContext("2d");
  tctx.putImageData(new ImageData(hi,W,H),0,0);

  const blur=document.createElement("canvas");
  blur.width=W; blur.height=H;
  const bctx=blur.getContext("2d");
  bctx.filter=`blur(${Math.max(0,blurPx)}px)`;
  bctx.drawImage(tmp,0,0);
  bctx.filter="none";

  ctx.save();
  ctx.globalAlpha=Math.max(0,Math.min(1,intensity));
  ctx.globalCompositeOperation="lighter";
  ctx.drawImage(blur,0,0);
  ctx.restore();
}

function applyCropReformat(ctx, W, H, x, y, cw, ch, padding, outW, outH, mode) {
  const cropW=Math.max(1,Math.round(cw));
  const cropH=Math.max(1,Math.round(ch));
  const pad=Math.max(0,Math.round(padding));

  const tmp=document.createElement("canvas");
  tmp.width=cropW+pad*2;
  tmp.height=cropH+pad*2;
  const tctx=tmp.getContext("2d");
  tctx.clearRect(0,0,tmp.width,tmp.height);
  tctx.drawImage(ctx.canvas, -Math.round(x)+pad, -Math.round(y)+pad);

  const finalW=outW>0?Math.round(outW):tmp.width;
  const finalH=outH>0?Math.round(outH):tmp.height;

  const dst=document.createElement("canvas");
  dst.width=finalW;
  dst.height=finalH;
  const dctx=dst.getContext("2d");
  dctx.clearRect(0,0,finalW,finalH);

  if (mode==="stretch"){
    dctx.drawImage(tmp,0,0,finalW,finalH);
  } else {
    const s=(mode==="fill") ? Math.max(finalW/tmp.width, finalH/tmp.height) : Math.min(finalW/tmp.width, finalH/tmp.height);
    const dw=Math.floor(tmp.width*s);
    const dh=Math.floor(tmp.height*s);
    const dx=Math.floor((finalW-dw)/2);
    const dy=Math.floor((finalH-dh)/2);
    dctx.drawImage(tmp,dx,dy,dw,dh);
  }

  ctx.clearRect(0,0,W,H);
  ctx.drawImage(dst,0,0,W,H);
}

function applyLumaKey(ctx, W, H, low, high, softness) {
  const { epsilon: EPS, luma_weights: LW } = getOpsConstants();
  const img=getImageData(ctx,W,H);
  const d=img.data;
  for (let i=0;i<d.length;i+=4){
    const l=luma01(d[i]/255, d[i+1]/255, d[i+2]/255, LW);
    let a=0;
    if (l<=low) a=0;
    else if (l>=high) a=1;
    else {
      const t=(l-low)/Math.max(EPS,(high-low));
      const s=Math.max(0,Math.min(1,softness*10));
      a = t*(1-s) + (t*t*(3-2*t))*s;
    }
    d[i+3]=Math.round(clamp01(a)*255);
  }
  putImageData(ctx,img);
}

function blend(ctx, W, H, topCanvas, mode, mix) {
  const m=Math.max(0,Math.min(1,mix));
  if (m<=0) return;

  const goMap={ over:"source-over", add:"lighter", screen:"screen", multiply:"multiply", difference:"difference" };
  ctx.save();
  ctx.globalAlpha=m;
  ctx.globalCompositeOperation=goMap[mode] ?? "source-over";
  ctx.drawImage(topCanvas,0,0);
  ctx.restore();

  if (mode==="subtract" || mode==="min" || mode==="max"){
    const base=getImageData(ctx,W,H);
    const b=base.data;
    const tmp=document.createElement("canvas");
    tmp.width=W; tmp.height=H;
    const tctx=tmp.getContext("2d");
    tctx.drawImage(topCanvas,0,0);
    const top=tctx.getImageData(0,0,W,H).data;

    for (let i=0;i<b.length;i+=4){
      for (let c=0;c<3;c++){
        const b0=b[i+c];
        const t0=top[i+c];
        let v=b0;
        if (mode==="subtract") v=b0 - t0*m;
        else if (mode==="min") v=Math.min(b0,t0);
        else if (mode==="max") v=Math.max(b0,t0);
        b[i+c]=Math.max(0,Math.min(255,v));
      }
    }
    putImageData(ctx,base);
  }
}

export const ops = {
  colorCorrect(ctx, W, node) {
    applyColorCorrect(ctx,W,W,
      num(node,"brightness",0),
      num(node,"contrast",1),
      num(node,"gamma",1),
      num(node,"saturation",1),
    );
  },
  blur(ctx, W, node) { applyBlur(ctx,W,W, num(node,"radius",0)); },
  transform(ctx, W, node) {
    applyTransform(ctx,W,W,
      num(node,"translate_x",0),
      num(node,"translate_y",0),
      num(node,"rotate_deg",0),
      num(node,"scale",1),
    );
  },
  levels(ctx, W, node) {
    applyLevels(ctx,W,W,
      num(node,"in_min", num(node,"min",0)),
      num(node,"in_max", num(node,"max",1)),
      num(node,"gamma", num(node,"mid",1)),
      num(node,"out_min",0),
      num(node,"out_max",1),
    );
  },
  hueSat(ctx, W, node) {
    applyHueSat(ctx,W,W,
      num(node,"hue_deg", num(node,"hue",0)),
      num(node,"saturation", num(node,"sat",1)),
      num(node,"value", num(node,"val",1)),
    );
  },
  invert(ctx, W, node) { applyInvert(ctx,W,W, bool(node,"invert_alpha",false)); },
  clamp(ctx, W, node) { applyClamp(ctx,W,W, num(node,"min_v",0), num(node,"max_v",1)); },
  sharpen(ctx, W, node) { applyUnsharp(ctx,W,W, num(node,"amount",1)); },
  edgeDetect(ctx, W, node) { applyEdgeDetect(ctx,W,W, num(node,"strength",1)); },
  glow(ctx, W, node) { applyGlow(ctx,W,W, num(node,"threshold",0.8), num(node,"intensity",0.75), Math.round(num(node,"blur_px",6))); },
  cropReformat(ctx, W, node) {
    applyCropReformat(ctx,W,W,
      num(node,"x",0), num(node,"y",0),
      num(node,"crop_w",W), num(node,"crop_h",W),
      num(node,"padding",0),
      num(node,"out_w",0), num(node,"out_h",0),
      str(node,"mode","fit")
    );
  },
  lumaKey(ctx, W, node) { applyLumaKey(ctx,W,W, num(node,"low",0.1), num(node,"high",0.9), num(node,"softness",0.05)); },
  merge(ctx, W, node, topCanvas) { blend(ctx,W,W, topCanvas, str(node,"mode","over"), num(node,"mix",1)); },
};
