/* 文件掃描效果：自動裁切收據、去陰影、加強對比、灰階壓縮。
 * 全部在手機／電腦上處理，不會上傳到其他地方。
 * 效果：字更清楚（白底黑字），檔案更細（灰階 JPEG）。
 */

function grayOf(d, i) { return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }

// Otsu：自動搵「紙」同「背景」的分界亮度
function otsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; th = i; }
  }
  return th;
}

// 喺細圖上搵收據（最光的一大塊）的範圍，回傳比例座標；搵唔到就回傳 null（即唔裁）
export function findPaper(gray, w, h) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i] | 0]++;
  const th = otsu(hist, gray.length);
  // 背景本身已經好光（例如白枱），就唔好亂裁
  const brightShare = gray.reduce((s, g) => s + (g > th), 0) / gray.length;
  if (brightShare > 0.85 || brightShare < 0.08) return null;
  const longestRun = (frac, minFrac) => {
    let best = [0, -1], start = -1;
    for (let i = 0; i <= frac.length; i++) {
      if (i < frac.length && frac[i] >= minFrac) { if (start < 0) start = i; }
      else if (start >= 0) { if (i - 1 - start > best[1] - best[0]) best = [start, i - 1]; start = -1; }
    }
    return best[1] >= best[0] ? best : null;
  };
  const col = new Float32Array(w);
  for (let x = 0; x < w; x++) { let c = 0; for (let y = 0; y < h; y++) c += gray[y * w + x] > th; col[x] = c / h; }
  const cx = longestRun(col, Math.max(0.25, Math.max(...col) * 0.45));
  if (!cx) return null;
  const row = new Float32Array(h);
  for (let y = 0; y < h; y++) { let c = 0; for (let x = cx[0]; x <= cx[1]; x++) c += gray[y * w + x] > th; row[y] = c / (cx[1] - cx[0] + 1); }
  const cy = longestRun(row, 0.5);
  if (!cy) return null;
  const pad = 0.012;
  const box = { x0: Math.max(0, cx[0] / w - pad), x1: Math.min(1, (cx[1] + 1) / w + pad), y0: Math.max(0, cy[0] / h - pad), y1: Math.min(1, (cy[1] + 1) / h + pad) };
  // 裁出來太細（< 15% 面積）多數係搵錯，放棄
  if ((box.x1 - box.x0) * (box.y1 - box.y0) < 0.15) return null;
  return box;
}

/**
 * 將相片變成「掃描檔」。
 * @param {Blob} file 原相
 * @param {{maxSide?:number,maxBytes?:number}} opt
 * @returns {Promise<{blob:Blob,cropped:boolean}>}
 */
export async function docScan(file, opt = {}) {
  const maxSide = opt.maxSide || 2000, maxBytes = opt.maxBytes || 450000;
  const bmp = await createImageBitmap(file);

  // 1. 細圖偵測收據範圍
  const sw = 360, sh = Math.max(1, Math.round(bmp.height * sw / bmp.width));
  const sc = document.createElement('canvas'); sc.width = sw; sc.height = sh;
  const sx = sc.getContext('2d'); sx.drawImage(bmp, 0, 0, sw, sh);
  const sd = sx.getImageData(0, 0, sw, sh).data;
  const g = new Float32Array(sw * sh); for (let i = 0; i < g.length; i++) g[i] = grayOf(sd, i * 4);
  const box = findPaper(g, sw, sh);
  const crop = box ? { x: box.x0 * bmp.width, y: box.y0 * bmp.height, w: (box.x1 - box.x0) * bmp.width, h: (box.y1 - box.y0) * bmp.height }
    : { x: 0, y: 0, w: bmp.width, h: bmp.height };

  // 2. 裁切並縮放到目標解像度
  const s = Math.min(1, maxSide / Math.max(crop.w, crop.h));
  const W = Math.max(1, Math.round(crop.w * s)), H = Math.max(1, Math.round(crop.h * s));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.drawImage(bmp, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);

  // 3. 估計背景光暗（大範圍模糊），用嚟去陰影
  const bw = Math.max(1, Math.round(W / 24)), bh = Math.max(1, Math.round(H / 24));
  const bc = document.createElement('canvas'); bc.width = bw; bc.height = bh;
  const bx = bc.getContext('2d'); bx.filter = 'blur(2px)'; bx.drawImage(c, 0, 0, bw, bh);
  // 用「最大值」概念：字係深色，背景係紙色；放大返原尺寸作為每點的背景亮度
  const big = document.createElement('canvas'); big.width = W; big.height = H;
  const gx = big.getContext('2d'); gx.imageSmoothingEnabled = true; gx.drawImage(bc, 0, 0, W, H);
  const bg = gx.getImageData(0, 0, W, H).data;

  // 4. 灰階 ＋ 除以背景（紙變白）＋ 對比曲線（字變深）
  const img = x.getImageData(0, 0, W, H), d = img.data;
  // 每一行搵出紙的左右邊界（細圖判斷），邊界外（枱面）先變白；紙內容一律保留
  let spanL = null, spanR = null;
  if (box) {
    const mw = 240, mh = Math.max(1, Math.round(H * mw / W));
    const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
    const mx = mc.getContext('2d'); mx.drawImage(c, 0, 0, mw, mh);
    const md = mx.getImageData(0, 0, mw, mh).data;
    const mg = new Float32Array(mw * mh); const hist = new Array(256).fill(0);
    for (let i = 0; i < mg.length; i++) { mg[i] = grayOf(md, i * 4); hist[mg[i] | 0]++; }
    const th = otsu(hist, mg.length);
    const L = new Float32Array(mh), R = new Float32Array(mh);
    for (let y = 0; y < mh; y++) {
      let l = -1, r = -1;
      for (let xx = 0; xx < mw; xx++) if (mg[y * mw + xx] > th) { if (l < 0) l = xx; r = xx; }
      L[y] = l < 0 ? 0 : l; R[y] = r < 0 ? mw - 1 : r;
    }
    // 用附近行的中位數平滑，避免文字令邊界跳動
    const med = (arr, y, k) => { const v = []; for (let j = Math.max(0, y - k); j <= Math.min(mh - 1, y + k); j++) v.push(arr[j]); v.sort((a, b) => a - b); return v[v.length >> 1]; };
    spanL = new Float32Array(H); spanR = new Float32Array(H);
    const m = 0.02 * mw;
    for (let y = 0; y < H; y++) { const yy = Math.min(mh - 1, Math.floor(y * mh / H)); spanL[y] = Math.max(0, med(L, yy, 6) - m) * W / mw; spanR[y] = Math.min(mw, med(R, yy, 6) + 1 + m) * W / mw; }
  }
  for (let i = 0; i < d.length; i += 4) {
    const v = grayOf(d, i), bgv = grayOf(bg, i);
    if (spanL) { const p = i >> 2, yy = (p / W) | 0, xx = p - yy * W; if (xx < spanL[yy] || xx > spanR[yy]) { d[i] = d[i + 1] = d[i + 2] = 255; continue; } }
    const b = Math.max(40, bgv * 1.04);
    let n = Math.min(1, v / b);              // 0 = 字，1 = 紙
    n = n > 0.92 ? 1 : Math.pow(n / 0.92, 1.8); // 紙變純白，字加深
    const o = Math.round(n * 255);
    d[i] = d[i + 1] = d[i + 2] = o;
  }
  x.putImageData(img, 0, 0);

  // 5. 壓縮：逐步降低質素直至細過上限
  let q = 0.82, blob, cur = c;
  for (let k = 0; k < 7; k++) {
    blob = await new Promise(r => cur.toBlob(r, 'image/jpeg', q));
    if (blob.size <= maxBytes) break;
    if (q > 0.6) q -= 0.08;
    else { const n2 = document.createElement('canvas'); n2.width = Math.round(cur.width * 0.85); n2.height = Math.round(cur.height * 0.85); n2.getContext('2d').drawImage(cur, 0, 0, n2.width, n2.height); cur = n2; }
  }
  return { blob, cropped: !!box };
}
