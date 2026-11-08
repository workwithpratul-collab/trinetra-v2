/* =========================================================
   Trinetra v2 · film.js
   The scroll film: draws 1,189 frames on a <canvas> while you scroll,
   and switches the timed text cards on and off.
   ========================================================= */
(function () {
  'use strict';

  var root = document.documentElement;
  // film-on is set in <head> (JS works + motion allowed). Otherwise do nothing.
  if (!root.classList.contains('film-on')) return;

  /* ---------- Settings ---------- */
  var FRAME_COUNT = 1189;
  var DESKTOP_ZOOM = 1.04;    // zoom desktop frames ~4% to crop the "Veo" watermark
  var WATERMARK_RIGHT = 40;   // watermark sits within 40px of the right edge (frame pixels)
  var PARALLEL_LOADS = 6;     // how many frames download at the same time
  var MAX_DPR = 2;            // sharper canvas on retina screens, capped to save memory

  // Portrait frames are already cropped to follow the subject, but in the
  // last ~15 frames the hoarding logo drifts left. On tall phones (taller
  // than 9:16) cover-fit trims the sides, so we let the crop follow it:
  // 0.5 = centred crop, 0 = keep the left edge.
  var PORTRAIT_FOCUS = [[1, 0.5], [1172, 0.5], [1189, 0.1]];

  // Slow connection or Save-Data on? Then only load every 2nd frame.
  var conn = navigator.connection || {};
  var LITE = !!conn.saveData || /^(slow-2g|2g|3g)$/.test(conn.effectiveType || '');

  // Each frame normally gets the same amount of scroll. Some stretches get
  // MORE scroll ("weight") so text cards stay on screen longer.
  var DWELL = [
    { from: 1,    to: 120,  weight: 1.4 },   // opening headline
    { from: 588,  to: 667,  weight: 2.6 },   // black moment 1: "From our floor… to your skyline."
    { from: 836,  to: 924,  weight: 2.6 },   // black moment 2: Imagine. Believe. Achieve.
    { from: 1080, to: 1189, weight: 1.8 }    // finale: hoarding + call to action
  ];

  /* ---------- Page elements ---------- */
  var film = document.querySelector('.film');
  var stage = film.querySelector('.film__stage');
  var canvas = film.querySelector('.film__canvas');
  var ctx = canvas.getContext('2d', { alpha: false });
  var timed = Array.prototype.slice.call(film.querySelectorAll('.timed'));
  var progressFill = film.querySelector('.progress__fill');
  var cue = film.querySelector('.cue');

  /* ---------- Scroll → frame map (with dwell weights) ---------- */
  // cumulative[i] = total weight of frames 0..i-1
  var cumulative = new Float32Array(FRAME_COUNT + 1);
  (function buildMap() {
    for (var i = 0; i < FRAME_COUNT; i++) {
      var w = 1, n = i + 1;
      for (var d = 0; d < DWELL.length; d++) {
        if (n >= DWELL[d].from && n <= DWELL[d].to) w = DWELL[d].weight;
      }
      cumulative[i + 1] = cumulative[i] + w;
    }
  })();

  // progress (0..1) → frame index (0..1188)
  function frameFromProgress(p) {
    var target = p * cumulative[FRAME_COUNT];
    var lo = 0, hi = FRAME_COUNT - 1;
    while (lo < hi) {                       // binary search
      var mid = (lo + hi + 1) >> 1;
      if (cumulative[mid] <= target) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /* ---------- Frame sets (desktop / portrait) ---------- */
  function makeSet(name) {
    return { name: name, dir: 'assets/frames/' + name + '/', imgs: new Array(FRAME_COUNT), ready: new Uint8Array(FRAME_COUNT), queue: [], requested: new Uint8Array(FRAME_COUNT) };
  }
  var sets = { desktop: makeSet('desktop'), portrait: makeSet('portrait') };
  var active = null;

  // Tall, narrow screen (width/height < 0.8) → portrait frames
  function pickSetName() {
    return (window.innerWidth / window.innerHeight) < 0.8 ? 'portrait' : 'desktop';
  }

  function frameUrl(set, i) {
    return set.dir + 'f' + String(i + 1).padStart(4, '0') + '.webp';
  }

  // Download order: every 8th frame first, then every 4th, every 2nd, then all.
  function buildQueue(set, startAt) {
    var steps = LITE ? [8, 4, 2] : [8, 4, 2, 1];
    var order = [startAt, 0, FRAME_COUNT - 1];
    steps.forEach(function (step) {
      for (var i = 0; i < FRAME_COUNT; i += step) order.push(i);
    });
    set.queue = order.filter(function (i) { return !set.requested[i]; });
  }

  /* ---------- Loader ---------- */
  var inFlight = 0;

  function pump() {
    while (inFlight < PARALLEL_LOADS && active && active.queue.length) {
      var i = active.queue.shift();
      if (active.requested[i]) continue;
      load(active, i);
    }
  }

  function load(set, i) {
    set.requested[i] = 1;
    inFlight++;
    var img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      set.imgs[i] = img;
      set.ready[i] = 1;
      inFlight--;
      if (set === active) needsDraw = true;   // a closer frame may now exist
      pump();
    };
    img.onerror = function () {
      inFlight--;
      pump();
    };
    img.src = frameUrl(set, i);
  }

  // Nearest loaded frame to i (looks backward and forward)
  function nearestReady(set, i) {
    if (set.ready[i]) return i;
    for (var d = 1; d < FRAME_COUNT; d++) {
      if (i - d >= 0 && set.ready[i - d]) return i - d;
      if (i + d < FRAME_COUNT && set.ready[i + d]) return i + d;
    }
    return -1;
  }

  /* ---------- Drawing ---------- */
  // Shown until the first frame arrives (same files the <head> preloads)
  var posters = { desktop: new Image(), portrait: new Image() };
  posters.desktop.onload = posters.portrait.onload = function () { needsDraw = true; };

  // Like CSS object-fit: cover. Desktop frames get the extra zoom and a
  // crop that takes at least 40px off the right edge (hides the watermark).
  // Horizontal focus for a portrait frame (straight-line blend between keyframes)
  function portraitFocus(i) {
    var n = i + 1, k = PORTRAIT_FOCUS;
    for (var j = 1; j < k.length; j++) {
      if (n <= k[j][0]) {
        var t = (n - k[j - 1][0]) / (k[j][0] - k[j - 1][0]);
        return k[j - 1][1] + (k[j][1] - k[j - 1][1]) * t;
      }
    }
    return k[k.length - 1][1];
  }

  function drawCover(img, isDesktopFrame, focusX) {
    var cw = canvas.width, ch = canvas.height;
    var iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return;
    var scale = Math.max(cw / iw, ch / ih) * (isDesktopFrame ? DESKTOP_ZOOM : 1);
    var sw = cw / scale, sh = ch / scale;     // part of the frame we show
    var cropX = iw - sw, cropY = ih - sh;     // part we cut off
    var sx = cropX * (focusX == null ? 0.5 : focusX);
    var sy = cropY / 2;
    if (isDesktopFrame) {
      var cropRight = Math.max(cropX / 2, Math.min(WATERMARK_RIGHT, cropX));
      sx = cropX - cropRight;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
  }

  var drawnKey = '';        // what is on the canvas right now
  var needsDraw = true;

  function draw(frame) {
    var n = nearestReady(active, frame);
    var key = n >= 0 ? active.name + n : 'poster';
    if (!needsDraw && key === drawnKey) return;   // nothing changed: skip
    needsDraw = false;
    if (n >= 0) {
      var isDesktop = active.name === 'desktop';
      drawCover(active.imgs[n], isDesktop, isDesktop ? null : portraitFocus(n));
    } else if (posters[active.name].naturalWidth) {
      drawCover(posters[active.name], active.name === 'desktop');
    } else {
      return;
    }
    drawnKey = key;
  }

  /* ---------- Layout ---------- */
  var filmTop = 0, filmScroll = 1, lastW = 0, lastH = 0;

  function measure() {
    var rect = film.getBoundingClientRect();
    filmTop = rect.top + window.scrollY;
    filmScroll = Math.max(1, film.offsetHeight - stage.offsetHeight);

    // Resize the canvas only when the stage really changed size
    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    var w = Math.round(stage.clientWidth * dpr);
    var h = Math.round(stage.clientHeight * dpr);
    if (w !== lastW || h !== lastH) {
      canvas.width = lastW = w;
      canvas.height = lastH = h;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      needsDraw = true;
    }

    // Switch frame set if the screen shape changed (rotation, resize)
    var name = pickSetName();
    if (!active || active.name !== name) {
      active = sets[name];
      var poster = posters[name];
      if (!poster.src) poster.src = name === 'desktop' ? 'assets/poster.webp' : 'assets/frames/portrait/f0001.webp';
      buildQueue(active, currentFrame());
      needsDraw = true;
      pump();
    }
  }

  function currentProgress() {
    var p = (window.scrollY - filmTop) / filmScroll;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }
  function currentFrame() { return frameFromProgress(currentProgress()); }

  /* ---------- Text cards ---------- */
  function updateCards(frameNumber) {          // frameNumber is 1-based
    for (var k = 0; k < timed.length; k++) {
      var el = timed[k];
      var on = frameNumber >= el._in && frameNumber <= el._out;
      if (on !== el._on) {
        el._on = on;
        el.classList.toggle('is-on', on);
      }
    }
  }
  timed.forEach(function (el) {
    el._in = +el.dataset.in;
    el._out = +el.dataset.out;
    el._on = false;
  });

  /* ---------- Main loop ---------- */
  var lastFrame = -1, lastP = -1;

  function tick() {
    var p = currentProgress();
    var frame = frameFromProgress(p);

    if (frame !== lastFrame) {
      updateCards(frame + 1);
      lastFrame = frame;
    }
    if (p !== lastP) {
      progressFill.style.transform = 'scaleY(' + p.toFixed(4) + ')';
      cue.classList.toggle('is-hidden', window.scrollY > 24);
      lastP = p;
    }
    draw(frame);
    requestAnimationFrame(tick);
  }

  /* ---------- Start ---------- */
  var resizeQueued = false;
  function onResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(function () { resizeQueued = false; measure(); });
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.addEventListener('load', measure);   // fonts/images can shift the layout

  measure();
  // Let the opening card animate in on the first paint
  requestAnimationFrame(function () { requestAnimationFrame(tick); });

  // Small hook for main.js: re-measure, and find the scroll position of a frame
  window.TrinetraFilm = {
    measure: measure,
    scrollForFrame: function (n) {                 // n is 1-based
      var i = Math.max(0, Math.min(FRAME_COUNT - 1, n - 1));
      var mid = (cumulative[i] + cumulative[i + 1]) / 2;   // middle of that frame's scroll slice
      return filmTop + (mid / cumulative[FRAME_COUNT]) * filmScroll;
    },
    filmEnd: function () { return filmTop + filmScroll; },
    // For testing in the browser console: which frame is wanted vs. drawn
    state: function () { return { want: lastFrame + 1, drawn: drawnKey, set: active.name }; }
  };
})();
