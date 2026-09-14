/* colorpicker.js — a Kanvaz-styled color picker, replacing the native
 * OS/Chromium color dialog everywhere it was used: the color-card
 * swatch, the annotation toolbar's custom-color button, and the 3D
 * card's background swatch. A saturation/value square + hue strip +
 * hex field, matching the rest of the app's dark-panel look instead of
 * a completely different, browser-drawn widget.
 */

var KanvazColorPicker = (function() {

  var pickerEl   = null;
  var svCanvas   = null;
  var svCtx      = null;
  var hueCanvas  = null;
  var hueCtx     = null;
  var hexInput   = null;
  var previewSw  = null;

  var curH = 0;   /* 0-360 */
  var curS = 1;   /* 0-1 */
  var curV = 1;   /* 0-1 */

  var onChangeCb = null;
  var onCommitCb = null;

  var SV_W = 200;
  var SV_H = 130;
  var HUE_H = 14;

  /* ── Color math (HSV <-> RGB <-> hex) ── */

  function hsvToRgb(h, s, v) {
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var r, g, b;
    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d !== 0) {
      if (max === r)      h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else                h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    var s = max === 0 ? 0 : d / max;
    var v = max;
    return { h: h, s: s, v: v };
  }

  function rgbToHex(r, g, b) {
    function h2(n) { var s = Math.max(0, Math.min(255, n)).toString(16); return s.length === 1 ? '0' + s : s; }
    return '#' + h2(r) + h2(g) + h2(b);
  }

  function hexToRgb(hex) {
    hex = (hex || '').replace('#', '');
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    var n = parseInt(hex, 16);
    if (isNaN(n) || hex.length !== 6) return { r: 0, g: 0, b: 0 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function currentHex() {
    var rgb = hsvToRgb(curH, curS, curV);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  /* ── Drawing ── */

  function drawSV() {
    var baseRgb = hsvToRgb(curH, 1, 1);
    svCtx.fillStyle = 'rgb(' + baseRgb.r + ',' + baseRgb.g + ',' + baseRgb.b + ')';
    svCtx.fillRect(0, 0, SV_W, SV_H);

    var whiteGrad = svCtx.createLinearGradient(0, 0, SV_W, 0);
    whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
    whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
    svCtx.fillStyle = whiteGrad;
    svCtx.fillRect(0, 0, SV_W, SV_H);

    var blackGrad = svCtx.createLinearGradient(0, 0, 0, SV_H);
    blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
    blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
    svCtx.fillStyle = blackGrad;
    svCtx.fillRect(0, 0, SV_W, SV_H);

    var cx = curS * SV_W;
    var cy = (1 - curV) * SV_H;
    svCtx.beginPath();
    svCtx.arc(cx, cy, 6, 0, Math.PI * 2);
    svCtx.strokeStyle = curV > 0.6 ? '#000' : '#fff';
    svCtx.lineWidth = 2;
    svCtx.stroke();
  }

  function drawHue() {
    var grad = hueCtx.createLinearGradient(0, 0, SV_W, 0);
    var stops = [0, 60, 120, 180, 240, 300, 360];
    for (var i = 0; i < stops.length; i++) {
      var rgb = hsvToRgb(stops[i], 1, 1);
      grad.addColorStop(stops[i] / 360, 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
    }
    hueCtx.fillStyle = grad;
    hueCtx.fillRect(0, 0, SV_W, HUE_H);

    var hx = (curH / 360) * SV_W;
    hueCtx.beginPath();
    hueCtx.rect(Math.max(0, Math.min(SV_W - 4, hx - 2)), 0, 4, HUE_H);
    hueCtx.strokeStyle = '#fff';
    hueCtx.lineWidth = 1.5;
    hueCtx.stroke();
  }

  function refresh(fromInput) {
    drawSV();
    drawHue();
    var hex = currentHex();
    previewSw.style.background = hex;
    if (!fromInput) hexInput.value = hex.toUpperCase();
    if (onChangeCb) onChangeCb(hex);
  }

  /* ── Interaction ── */

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function bindDrag(el, onMove) {
    function move(e) {
      var rect = el.getBoundingClientRect();
      var x = clamp(e.clientX - rect.left, 0, rect.width);
      var y = clamp(e.clientY - rect.top, 0, rect.height);
      onMove(x, y, rect.width, rect.height);
    }
    el.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      move(e);
      function onMouseMove(ev) {
        /* Escape (or any other close() path) can fire mid-drag, before
           the real mouseup that would normally unhook these listeners
           — leaving them attached to `document` against a now-detached
           `el`. A detached element's getBoundingClientRect() is all
           zeros, so the very next mousemove would divide by a 0 width/
           height in move()'s caller (curS = px/w), producing NaN that
           silently propagates through onChangeCb as a garbage hex like
           "#NaNNaNNaN". Bail out (and clean up) the instant a close is
           detected, rather than waiting for the eventual mouseup. */
        if (!pickerEl) { onMouseUp(); return; }
        move(ev);
      }
      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  /* ── Lifecycle ── */

  function onDocMouseDown(e) {
    if (pickerEl && !pickerEl.contains(e.target)) close(true);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') close(true);
  }

  function close(commit) {
    if (!pickerEl) return;
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (pickerEl.parentNode) pickerEl.parentNode.removeChild(pickerEl);
    var finalHex = currentHex();
    pickerEl = null;
    if (commit && onCommitCb) onCommitCb(finalHex);
    onChangeCb = null;
    onCommitCb = null;
  }

  function isOpen() {
    return !!pickerEl;
  }

  /* open(x, y, initialHex, opts)
     opts.onChange(hex) — fires live as the user drags/types (preview,
     no history entry).
     opts.onCommit(hex) — fires once, when the picker closes (outside
     click, Escape, or an explicit close()) — this is where a caller
     should push history/mark dirty, matching how the old native
     <input type="color">'s 'change' event was used. */
  function open(x, y, initialHex, opts) {
    close(false);
    opts = opts || {};
    onChangeCb = opts.onChange || null;
    onCommitCb = opts.onCommit || null;

    var hsv = rgbToHsv.apply(null, (function() {
      var rgb = hexToRgb(initialHex);
      return [rgb.r, rgb.g, rgb.b];
    })());
    curH = hsv.h; curS = hsv.s; curV = hsv.v;

    pickerEl = document.createElement('div');
    pickerEl.id = 'kanvaz-color-picker';
    pickerEl.style.cssText = [
      'position:fixed', 'z-index:30000',
      'background:var(--color-surface)',
      'border:1px solid var(--color-border-2)',
      'border-radius:var(--radius-md)',
      'box-shadow:0 16px 48px var(--color-shadow)',
      'padding:10px',
      'width:' + SV_W + 'px'
    ].join(';');

    svCanvas = document.createElement('canvas');
    svCanvas.width = SV_W; svCanvas.height = SV_H;
    svCanvas.style.cssText = 'display:block;border-radius:6px;cursor:crosshair;margin-bottom:8px;';
    svCtx = svCanvas.getContext('2d');
    bindDrag(svCanvas, function(px, py, w, h) {
      curS = px / w;
      curV = 1 - (py / h);
      refresh();
    });
    pickerEl.appendChild(svCanvas);

    hueCanvas = document.createElement('canvas');
    hueCanvas.width = SV_W; hueCanvas.height = HUE_H;
    hueCanvas.style.cssText = 'display:block;border-radius:4px;cursor:crosshair;margin-bottom:10px;';
    hueCtx = hueCanvas.getContext('2d');
    bindDrag(hueCanvas, function(px, py, w) {
      curH = (px / w) * 360;
      refresh();
    });
    pickerEl.appendChild(hueCanvas);

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;';

    previewSw = document.createElement('div');
    previewSw.style.cssText = 'width:22px;height:22px;border-radius:50%;border:1px solid var(--color-border-2);flex-shrink:0;';
    row.appendChild(previewSw);

    hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.spellcheck = false;
    hexInput.style.cssText = 'flex:1;padding:5px 7px;background:var(--color-surface-2);border:1px solid var(--color-border-2);border-radius:5px;color:var(--color-text);font-family:var(--font-mono);font-size:12px;';
    hexInput.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    hexInput.addEventListener('input', function() {
      var rgb = hexToRgb(hexInput.value);
      var hsv2 = rgbToHsv(rgb.r, rgb.g, rgb.b);
      curH = hsv2.h; curS = hsv2.s; curV = hsv2.v;
      refresh(true);
    });
    hexInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') close(true);
      if (e.key === 'Escape') close(true);
    });
    row.appendChild(hexInput);
    pickerEl.appendChild(row);

    pickerEl.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    document.body.appendChild(pickerEl);

    /* Clamp on-screen — same margin/flip convention already used by
       tooltip.js and the annotation toolbar's own positioning. */
    var rect = pickerEl.getBoundingClientRect();
    var left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    var top  = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    pickerEl.style.left = left + 'px';
    pickerEl.style.top  = top + 'px';

    refresh();

    /* Deferred so the click that OPENED the picker doesn't immediately
       close it via the same mousedown bubbling to document. */
    setTimeout(function() {
      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('keydown', onKeyDown, true);
    }, 0);
  }

  return {
    open:    open,
    close:   close,
    isOpen:  isOpen
  };

})();

if (typeof window !== 'undefined') { window.KanvazColorPicker = KanvazColorPicker; }
