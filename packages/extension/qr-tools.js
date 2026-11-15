// QR codes in the wallet: a code with the Quinvium mark in the middle for receiving, and reading codes from the camera
// or from a photo for sending. The code uses error correction level H (30 % of it can be lost), the mark covers about 6 %.
// Reading uses jsQR (jsqr.js, Apache-2.0). Works in the browser and in Node (tests).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MARK = '<rect x="0" y="0" width="64" height="64" rx="14.4" fill="#0B1622"/><path transform="translate(7.13 7.13) scale(0.78)" d="M26.33 36.92L28.75 39.63L37.24 48.48L46.52 58.68L58.57 58.68L46.87 45.48L40.38 38.28L39.46 37.49L38.88 37.14L38.03 36.92L30.54 36.92L30.47 36.85L30.32 36.92L28.9 36.92L28.83 36.85L28.68 36.92ZM32.39 2.75L30.75 2.75L30.04 2.89L29.04 3.18L28.04 3.68L18.55 9.88L8.64 16.59L7.71 17.23L7.21 17.8L6.57 18.66L5.78 20.16L5.64 20.73L5.43 21.8L5.43 42.42L5.71 43.99L6.35 45.55L6.99 46.41L8.28 47.7L15.34 52.4L27.4 60.39L28.54 60.96L29.9 61.25L32.04 61.18L32.89 60.96L34.1 60.39L41.31 55.19L35.82 49.05L35.6 49.12L32.61 51.26L31.82 51.69L31.46 51.83L30.47 51.83L29.61 51.48L21.26 45.77L15.98 42.27L15.27 41.49L14.84 40.63L14.56 39.56L14.56 25.15L14.7 24.51L15.06 23.65L15.34 23.3L16.2 22.44L26.33 15.73L30.39 13.02L31.39 12.74L31.82 12.74L32.61 12.95L34.89 14.38L38.6 16.95L46.09 21.94L47.37 23.08L47.73 23.8L47.94 24.87L47.94 40.2L47.73 41.42L47.37 42.13L46.52 42.92L51.94 48.98L52.08 49.19L52.23 49.19L54.51 47.62L55.36 46.98L55.94 46.41L56.86 44.98L57.15 44.2L57.43 42.7L57.43 21.8L57.22 20.59L56.93 19.66L56.36 18.59L55.79 17.8L54.94 16.95L53.22 15.73L38.88 6.1L34.68 3.46L33.82 3.04Z" fill="#FFCD02"/>';
  const MARGIN = 2;
  const MARK_SHARE = 0.24;   // side of the mark relative to the code

  /** The modules of the code and where the mark sits, in modules. */
  function layout(text) {
    const code = root.qrcode(0, 'H');
    code.addData(text);
    code.make();
    const n = code.getModuleCount();
    const box = Math.ceil(n * MARK_SHARE) | 1;   // odd, so it sits exactly in the middle
    const start = (n - box) / 2;
    return { code, n, box, start };
  }

  /** SVG of the code with the mark in a white rounded square in the middle. */
  function svg(text) {
    const { code, n, box, start } = layout(text);
    const size = n + MARGIN * 2;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (code.isDark(r, c)) d += `M${c + MARGIN} ${r + MARGIN}h1v1h-1z`;
    }
    const x = start + MARGIN;
    return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0b1622"/>`
      + `<rect x="${x - 0.6}" y="${x - 0.6}" width="${box + 1.2}" height="${box + 1.2}" rx="1.4" fill="#fff" shape-rendering="geometricPrecision"/>`
      + `<svg x="${x}" y="${x}" width="${box}" height="${box}" viewBox="0 0 64 64" shape-rendering="geometricPrecision">${MARK}</svg></svg>`;
  }

  /**
   * Gray pixels of the code as printed, with the mark area filled (`fill` 0 = black, 255 = white): what a camera sees.
   * Only for tests: the real code is checked by decoding these pixels.
   */
  function pixels(text, scale = 6, fill = 0) {
    const { code, n, box, start } = layout(text);
    const size = (n + MARGIN * 2) * scale;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    const mark = (r, c) => r >= start && r < start + box && c >= start && c < start + box;
    for (let r = -MARGIN; r < n + MARGIN; r++) {
      for (let c = -MARGIN; c < n + MARGIN; c++) {
        const inside = r >= 0 && c >= 0 && r < n && c < n;
        const v = inside && mark(r, c) ? fill : inside && code.isDark(r, c) ? 0 : 255;
        if (v === 255) continue;
        for (let y = 0; y < scale; y++) {
          for (let x = 0; x < scale; x++) {
            const i = (((r + MARGIN) * scale + y) * size + (c + MARGIN) * scale + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = v;
          }
        }
      }
    }
    return { data, width: size, height: size };
  }

  /** Text of a QR code in RGBA pixels, or null. */
  function decode(image) {
    const read = root.jsQR ?? (typeof require === 'function' ? require('./jsqr.js') : null);
    const hit = read?.(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
    return hit?.data ?? null;
  }

  /**
   * What a scanned code asks for: a plain address, or a payment link `ethereum:0x…@52401?value=…` / `quinvium:0x…`.
   * `value` in the link is in wei (EIP-681); `amount` is in whole coins. Anything else returns null.
   */
  function parsePayment(text) {
    const s = String(text ?? '').trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { to: s };
    const m = /^(?:ethereum|quinvium):(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/[^?]*)?(?:\?(.*))?$/i.exec(s);
    if (!m) return null;
    const out = { to: m[1] };
    if (m[2]) out.chainId = Number(m[2]);
    const q = new URLSearchParams(m[3] ?? '');
    const value = q.get('value');
    if (value && /^\d+(\.\d+)?(e\d+)?$/i.test(value)) {
      const [mantissa, exp = '0'] = value.toLowerCase().split('e');
      const [whole, frac = ''] = mantissa.split('.');
      const e = Number(exp) - frac.length;
      if (e >= 0) out.wei = (BigInt(whole + frac) * 10n ** BigInt(e)).toString();
    } else if (q.get('amount') && /^\d+(\.\d+)?$/.test(q.get('amount'))) out.amount = q.get('amount');
    return out;
  }

  /** Reads a QR code from an image file (a photo or a screenshot). */
  async function decodeFile(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  /**
   * Reads a QR code from the camera into `video`. Resolves with the text, or null when stopped.
   * The camera is switched off as soon as the code is read or `stop()` is called.
   */
  function scanCamera(video) {
    let stream = null;
    let stopped = false;
    let done;
    const result = new Promise((resolve) => { done = resolve; });
    const finish = (text) => {
      if (stopped) return;
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      done(text);
    };
    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        if (stopped) return;
        if (video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const text = decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (text) { finish(text); return; }
        }
        setTimeout(tick, 200);
      };
      tick();
    })().catch((e) => { stopped = true; done(Promise.reject(e)); });
    return { result, stop: () => finish(null) };
  }

  root.quinviumQr = { svg, pixels, decode, decodeFile, scanCamera, parsePayment };
  if (typeof module === 'object') module.exports = root.quinviumQr;
})();
