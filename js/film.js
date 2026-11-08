/* =========================================================
   Trinetra v2 · film.js
   The scroll film: draws 1,189 frames on a <canvas> while you scroll,
   moves the timed text cards with the scroll, and runs the chapter
   indicator on the right edge.

   How it works, in short:
   - Two layers per frame. Layer 1: a normal Image, kept forever once it
     has loaded (the safe fallback). Layer 2: an ImageBitmap, an already
     unpacked copy that draws instantly, made only for frames within ±40
     of the playhead (ahead of the scroll direction first) and freed again
     beyond ±60.
   - Frames near the scroll position download first (6 at a time), then
     the rest of the film, every 8th frame first.
   - The poster only shows before any frame has loaded.
   - The playhead glides toward the scroll position. ONE function,
     filmFrame(), gives the current frame; the canvas AND the text cards
     both use it, so they can never drift apart.
   - The animation loop sleeps when nothing moves and wakes up on every
     scroll (main.js passes Lenis's scroll position to setScroll) and resize.
   - Add ?debug to the address to see what the film is doing.
   ========================================================= */
(function () {
  'use strict';

  var root = document.documentElement;
  // film-on is set in <head> (JS works + motion allowed). Otherwise do nothing.
  if (!root.classList.contains('film-on')) return;

  /* ---------- Settings ---------- */
  var FRAME_COUNT = 1189;
  var FRAME_SIZE = { desktop: [1280, 720], portrait: [405, 720] };   // pixels of one frame file
  var DESKTOP_ZOOM = 1.04;    // zoom desktop frames ~4% to crop the "Veo" watermark
  var WATERMARK_RIGHT = 40;   // watermark sits within 40px of the right edge (frame pixels)
  var MAX_LOADS = 6;          // at most 6 downloads at the same time
  var NEAR = 60;              // download every frame within ±60 of the playhead first
  var BMP_KEEP = 40;          // make ready-to-draw bitmaps for frames within ±40 of the playhead
  var BMP_RELEASE = 60;       // free bitmaps further away than ±60 (the plain Image stays)
  var MAX_BITMAPS = 4;        // at most 4 bitmaps being made at the same time
  var EASE = 0.2;             // playhead moves 20% of the way to the scroll target per frame (at 60 fps)
  var JUMP = 240;             // a jump bigger than this (e.g. the browser restoring your position) snaps instead of gliding
  var MAX_SCALE = 1.5;        // canvas never has more than 1.5 pixels per frame pixel: more costs speed, adds no detail

  // Portrait frames are already cropped to follow the subject, but in the
  // last ~15 frames the hoarding logo drifts left. On tall phones (taller
  // than 9:16) cover-fit trims the sides, so we let the crop follow it:
  // 0.5 = centred crop, 0 = keep the left edge.
  var PORTRAIT_FOCUS = [[1, 0.5], [1172, 0.5], [1189, 0.1]];

  // Slow connection or Save-Data on? Then only load every 2nd frame.
  var conn = navigator.connection || {};
  var LITE = !!conn.saveData || /^(slow-2g|2g|3g)$/.test(conn.effectiveType || '');
  var STEP = LITE ? 2 : 1;
  function wanted(i) { return i % STEP === 0 || i === FRAME_COUNT - 1; }

  // Each frame normally gets the same amount of scroll. Some stretches get
  // MORE scroll ("weight") so text cards stay on screen longer.
  var DWELL = [
    { from: 1,    to: 75,   weight: 1.4 },   // opening headline
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
  var progress = film.querySelector('.progress');
  var progressFill = film.querySelector('.progress__fill');
  var chapterName = film.querySelector('.progress__name');
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

  // Scroll progress (0..1) → playhead position (0..1189, with fractions).
  // 136.4 means "40% of the way through frame index 136".
  function posFromProgress(p) {
    var target = p * cumulative[FRAME_COUNT];
    var lo = 0, hi = FRAME_COUNT - 1;
    while (lo < hi) {                       // binary search
      var mid = (lo + hi + 1) >> 1;
      if (cumulative[mid] <= target) lo = mid; else hi = mid - 1;
    }
    var part = (target - cumulative[lo]) / (cumulative[lo + 1] - cumulative[lo]);
    return lo + (part < 0 ? 0 : part > 1 ? 1 : part);
  }
  // Playhead position → share of the film (0..1), for the progress line
  function progressFromPos(x) {
    var i = Math.min(FRAME_COUNT - 1, Math.floor(x));
    return (cumulative[i] + (x - i) * (cumulative[i + 1] - cumulative[i])) / cumulative[FRAME_COUNT];
  }
  // Playhead position → frame index (a whole number, 0..1188)
  function indexAt(x) { return Math.max(0, Math.min(FRAME_COUNT - 1, Math.floor(x))); }

  /* ---------- Playhead ---------- */
  var target = 0;      // where the scroll position says we should be
  var current = 0;     // where the film actually is (glides toward target)

  // THE frame value. Canvas, text cards, chapters and progress line all
  // read it from here. 1-based, with fractions (e.g. 136.4).
  function filmFrame() { return current + 1; }

  /* ---------- Frame sets (desktop / portrait) ---------- */
  function makeSet(name) {
    // Far-away frames download in passes: every 8th frame, then every 4th,
    // every 2nd, then the rest. (Frames near the playhead jump the queue.)
    var far = [];
    (LITE ? [8, 4, 2] : [8, 4, 2, 1]).forEach(function (step) {
      for (var i = 0; i < FRAME_COUNT; i += step) far.push(i);
    });
    far.push(FRAME_COUNT - 1);
    return {
      name: name,
      dir: 'assets/frames/' + name + '/',
      size: FRAME_SIZE[name],
      imgs: new Array(FRAME_COUNT),           // layer 1: plain Image, kept forever once loaded
      state: new Uint8Array(FRAME_COUNT),     // 0 = not asked for, 1 = downloading, 2 = loaded, 3 = failed
      files: new Array(FRAME_COUNT),          // the downloaded file (compressed), source for bitmaps
      bmps: new Array(FRAME_COUNT),           // layer 2: ImageBitmap speed-up, only near the playhead
      bmpBusy: new Uint8Array(FRAME_COUNT),   // 1 = bitmap being made right now
      bmpLive: [],                            // indexes that have a bitmap right now
      loadedCount: 0,
      far: far,
      farPos: 0
    };
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

  /* ---------- Downloading ---------- */
  var loads = 0;

  // Next frame to download: the nearest missing frame around the scroll
  // target first (expanding outward), then the far-away passes.
  function nextToLoad(set) {
    var c = indexAt(target);
    for (var d = 0; d <= NEAR; d++) {
      var a = c + d, b = c - d;
      if (a < FRAME_COUNT && wanted(a) && !set.state[a]) return a;
      if (d && b >= 0 && wanted(b) && !set.state[b]) return b;
    }
    while (set.farPos < set.far.length) {
      var i = set.far[set.farPos];
      if (!set.state[i]) return i;
      set.farPos++;
    }
    return -1;
  }

  function pump() {
    while (active && loads < MAX_LOADS) {
      var i = nextToLoad(active);
      if (i < 0) return;
      load(active, i);
    }
  }

  function load(set, i) {
    set.state[i] = 1;
    loads++;
    var img = new Image();
    img.decoding = 'async';
    if (CAN_BITMAP) {
      // Download the file once. The plain Image is made from it, and later
      // bitmaps are made from it too: from a file, the browser unpacks the
      // picture on a background thread (from an <img> it would block scrolling).
      fetch(frameUrl(set, i)).then(function (res) {
        if (!res.ok) throw new Error(res.status);
        return res.blob();
      }).then(function (file) {
        set.files[i] = file;
        img.src = URL.createObjectURL(file);   // kept for good, like the Image itself
      }).catch(function () { img.onerror(); });
    } else {
      img.src = frameUrl(set, i);
    }
    img.onload = function () {
      set.imgs[i] = img;
      set.state[i] = 2;
      set.loadedCount++;
      loads--;
      if (set === active) {
        feedBitmaps();                  // make a bitmap if it's near the playhead
        wake(false);                    // a closer frame may now exist: look again
      }
      pump();
    };
    img.onerror = function () {
      if (set.state[i] !== 1) return;       // already handled
      set.state[i] = 3;
      loads--;
      pump();
    };
  }

  /* ---------- Speed layer: ImageBitmaps near the playhead ----------
     A plain Image may have to be unpacked (decoded) at the moment it is
     drawn, which can freeze a frame. An ImageBitmap is already unpacked,
     so drawing it is instant. We make bitmaps only for frames near the
     playhead, ahead of the scroll direction first, and free the far ones.
     The plain Images are never freed, so there is always a fallback. */
  var CAN_BITMAP = typeof window.createImageBitmap === 'function' && typeof window.fetch === 'function';
  var bmpMaking = 0;
  var direction = 1;     // +1 scrolling down (forward in the film), -1 scrolling up

  function makeBitmap(set, i) {
    if (i < 0 || i >= FRAME_COUNT || bmpMaking >= MAX_BITMAPS) return;
    if (set.state[i] !== 2 || !set.files[i] || set.bmps[i] || set.bmpBusy[i]) return;
    set.bmpBusy[i] = 1;
    bmpMaking++;
    createImageBitmap(set.files[i]).then(function (bmp) {     // from the file: unpacked off the main thread
      bmpMaking--;
      set.bmpBusy[i] = 0;
      if (set !== active || isFarForBitmap(i)) {
        bmp.close();                    // not needed any more
      } else {
        set.bmps[i] = bmp;
        set.bmpLive.push(i);
        wake(false);                    // a faster version of a nearby frame is ready
      }
      feedBitmaps();
    }, function () {
      bmpMaking--;
      set.bmpBusy[i] = 0;               // no bitmap: the plain Image still draws
    });
  }

  // Start bitmaps for frames within ±BMP_KEEP: first the frames we are
  // moving toward, then the ones behind us.
  function feedBitmaps() {
    if (!CAN_BITMAP || !active) return;
    var c = indexAt(target);
    for (var d = 0; d <= BMP_KEEP && bmpMaking < MAX_BITMAPS; d++) makeBitmap(active, c + direction * d);
    for (d = 1; d <= BMP_KEEP && bmpMaking < MAX_BITMAPS; d++) makeBitmap(active, c - direction * d);
  }

  function isFarForBitmap(i) {
    return Math.abs(i - current) > BMP_RELEASE && Math.abs(i - target) > BMP_RELEASE;
  }

  // Free bitmaps outside ±BMP_RELEASE (all of them for a set that isn't shown)
  function releaseBitmaps(set) {
    var keep = [];
    for (var k = 0; k < set.bmpLive.length; k++) {
      var i = set.bmpLive[k];
      if (set === active && !isFarForBitmap(i)) { keep.push(i); continue; }
      set.bmps[i].close();
      set.bmps[i] = null;
    }
    set.bmpLive = keep;
  }

  // Closest LOADED frame to i, searching both directions at once
  function nearestLoaded(set, i) {
    for (var d = 0; d < FRAME_COUNT; d++) {
      if (i - d >= 0 && set.state[i - d] === 2) return i - d;
      if (i + d < FRAME_COUNT && set.state[i + d] === 2) return i + d;
    }
    return -1;
  }

  /* ---------- Drawing ---------- */
  // Shown until the first frame loads (same files the <head> preloads)
  var posters = { desktop: new Image(), portrait: new Image() };
  posters.desktop.onload = posters.portrait.onload = function () { wake(true); };

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

  // Like CSS object-fit: cover. Desktop frames get the extra zoom and a
  // crop that takes at least 40px off the right edge (hides the watermark).
  // Works for a plain Image and an ImageBitmap.
  function drawCover(img, isDesktopFrame, focusX) {
    var cw = canvas.width, ch = canvas.height;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
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

  var drawnKey = '';        // what is on the canvas right now (set + frame + layer)
  var drawnIndex = -1;      // its frame index (-1 = poster)
  var drawnLevel = 'none';  // bitmap / image / nearest / poster (shown in ?debug)
  var needsDraw = true;

  // Drawing order for the frame the text cards are on:
  //   1. its bitmap (instant)            2. its plain Image
  //   3. the nearest loaded frame (its bitmap if it has one, else its Image)
  //   4. the poster: ONLY while no frame of this set has loaded yet
  function draw() {
    var want = indexAt(filmFrame() - 1);          // the same frame the text cards use
    var set = active, n, pic, level;
    if (set.bmps[want]) { n = want; pic = set.bmps[want]; level = 'bitmap'; }
    else if (set.state[want] === 2) { n = want; pic = set.imgs[want]; level = 'image'; }
    else {
      n = nearestLoaded(set, want);
      if (n >= 0) { pic = set.bmps[n] || set.imgs[n]; level = 'nearest'; }
      else if (posters[set.name].naturalWidth) { pic = posters[set.name]; level = 'poster'; }
      else { needsDraw = false; return; }          // nothing to draw yet: the poster's onload wakes us
    }
    // Same frame from the same layer as last time? Nothing to do. (A frame
    // first drawn from its Image is redrawn once its bitmap is ready: cheap.)
    var key = set.name + n + (pic === set.bmps[n] ? 'b' : 'i');
    if (!needsDraw && key === drawnKey) { drawnLevel = level; return; }
    var isDesktop = set.name === 'desktop';
    drawCover(pic, isDesktop, isDesktop || n < 0 ? null : portraitFocus(n));
    needsDraw = false;
    drawnKey = key;
    drawnIndex = n;
    drawnLevel = level;
  }

  /* ---------- Layout ---------- */
  var filmTop = 0, filmScroll = 1, started = false;

  // Canvas size = screen × devicePixelRatio, but never more than
  // MAX_SCALE canvas pixels per frame pixel.
  function sizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var w = stage.clientWidth * dpr, h = stage.clientHeight * dpr;
    var isDesktop = active.name === 'desktop';
    var scale = Math.max(w / active.size[0], h / active.size[1]) * (isDesktop ? DESKTOP_ZOOM : 1);
    if (scale > MAX_SCALE) { w *= MAX_SCALE / scale; h *= MAX_SCALE / scale; }
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
      // (changing the size resets these, so set them again)
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      needsDraw = true;
    }
  }

  function measure() {
    var rect = film.getBoundingClientRect();
    filmTop = rect.top + window.scrollY;
    filmScroll = Math.max(1, film.offsetHeight - stage.offsetHeight);

    // Switch frame set if the screen shape changed (rotation, resize)
    var name = pickSetName();
    if (!active || active.name !== name) {
      var old = active;
      active = sets[name];
      if (old) releaseBitmaps(old);             // frees all of the old set's bitmaps (its Images stay)
      var poster = posters[name];
      if (!poster.src) poster.src = name === 'desktop' ? 'assets/poster.webp' : 'assets/frames/portrait/f0001.webp';
      needsDraw = true;
    }
    sizeCanvas();
    setScroll(window.scrollY);
    if (!started) { current = target; started = true; }   // first time: start right where the page is
    pump();
    wake(true);
  }

  // Called by main.js with every scroll position (from Lenis's scroll event)
  var cueHidden = false;
  function setScroll(y) {
    var p = (y - filmTop) / filmScroll;
    var t = posFromProgress(p < 0 ? 0 : p > 1 ? 1 : p);
    var moved = indexAt(t) !== indexAt(target);
    if (t !== target) direction = t > target ? 1 : -1;   // which way the visitor is moving
    target = t;
    if (moved && active) {
      pump();                                       // new nearby frames to fetch first
      feedBitmaps();                                // and bitmaps ahead of us
    }
    var hide = y > 24;
    if (hide !== cueHidden) { cueHidden = hide; cue.classList.toggle('is-hidden', hide); }
    wake(false);                                    // ALWAYS restart the loop
  }

  /* ---------- Text cards (move with the scroll) ----------
     Every element with class "timed" has data-in and data-out (frame numbers).
     Its look is worked out from filmFrame(), so the text moves exactly
     with the picture and plays backward when you scroll back:
       - its lines rise out of their masks over RISE frames, STAGGER frames apart
       - labels, body text and buttons (.fade) follow FADE_DELAY frames later
       - the card drifts DRIFT px in from its own side (left cards from the
         left, right cards from the right; centred cards only rise)
       - the whole card fades out over the last FADE_OUT frames before data-out
     A card whose data-out is the last frame (the finale) never fades out.
     Only transform and opacity change (the cheapest things to animate). */
  var RISE = 15, STAGGER = 3, FADE_DELAY = 6, FADE_IN = 8, FADE_OUT = 12, DRIFT = 12;
  // How far a hidden line sits below its mask (CSS uses the same number).
  // A bit more than 100%, because the masks leave room under each line for
  // the serif's tails (y, g, p).
  var LINE_HIDE = 130;
  // The opening card is on screen at frame 1, before any scrolling, so it
  // plays in by itself when the page opens (INTRO_FPS frames per second).
  var INTRO_FPS = 18, INTRO_FRAMES = 40;
  var introStart = null;
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { introStart = performance.now(); wake(false); });   // wait for the headline font
  } else {
    introStart = performance.now();
  }

  timed.forEach(function (el) {
    el._in = +el.dataset.in;
    el._out = +el.dataset.out;
    el._stay = el._out >= FRAME_COUNT;
    el._lines = el.querySelectorAll('.line > span');
    el._fades = el.querySelectorAll('.fade');
    el._card = el.querySelector('.card');
    el._drift = el.classList.contains('align-right') ? DRIFT
              : el.classList.contains('align-center') ? 0 : -DRIFT;
    // Frames after data-in until everything has landed
    el._settle = Math.max((el._lines.length - 1) * STAGGER + RISE, FADE_DELAY + RISE);
    el._on = false;
    el._moving = false;
  });

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function easeOut(x) { return 1 - Math.pow(1 - x, 3); }     // fast start, soft landing

  // Only touch the page when a value really changed (keeps scrolling light)
  function setStyle(node, prop, value) {
    var key = '_' + prop;
    if (node[key] !== value) { node[key] = value; node.style[prop] = value; }
  }

  function updateCards(f, intro) {      // f = filmFrame() (1-based, with fractions)
    for (var k = 0; k < timed.length; k++) {
      var el = timed[k];
      var t = f - el._in;                       // frames since this card started
      if (el._in === 1) t += intro;
      var fadeOut = el._stay ? 1 : clamp01((el._out - f) / FADE_OUT);
      var alpha = t < 0 ? 0 : Math.min(clamp01(t / FADE_IN), fadeOut);
      var on = alpha > 0;
      if (on !== el._on) {
        el._on = on;
        el.classList.toggle('is-on', on);     // CSS: visible + clickable
      }
      // "is-moving" turns on will-change (CSS) only while the card animates
      var moving = on && (t < el._settle || fadeOut < 1);
      if (moving !== el._moving) {
        el._moving = moving;
        el.classList.toggle('is-moving', moving);
      }
      if (!on) continue;

      setStyle(el, 'opacity', alpha.toFixed(3));
      for (var j = 0; j < el._lines.length; j++) {
        var x = easeOut(clamp01((t - j * STAGGER) / RISE));
        setStyle(el._lines[j], 'transform', x === 1 ? 'none' : 'translateY(' + ((1 - x) * LINE_HIDE).toFixed(2) + '%)');
      }
      // Sideways drift of the whole card, from its own side
      if (el._card && el._drift) {
        x = easeOut(clamp01(t / (RISE + FADE_DELAY)));
        setStyle(el._card, 'transform', x === 1 ? 'none' : 'translateX(' + ((1 - x) * el._drift).toFixed(1) + 'px)');
      }
      x = easeOut(clamp01((t - FADE_DELAY) / RISE));
      for (j = 0; j < el._fades.length; j++) {
        setStyle(el._fades[j], 'opacity', x.toFixed(3));
        setStyle(el._fades[j], 'transform', x === 1 ? 'none' : 'translateY(' + ((1 - x) * 12).toFixed(1) + 'px)');
      }
    }
  }

  /* ---------- Chapter indicator ----------
     Every scene with data-chapter gets a small tick on the progress line,
     placed where that chapter starts. The current chapter's name shows
     beside the line (big screens only, see CSS). */
  var chapters = Array.prototype.slice.call(film.querySelectorAll('[data-chapter]')).map(function (el) {
    var start = +el.dataset.in;
    var tick = document.createElement('span');
    tick.className = 'progress__tick';
    // Same maths as the scroll map, so the tick lines up with the fill
    tick.style.top = (cumulative[start - 1] / cumulative[FRAME_COUNT] * 100).toFixed(2) + '%';
    progress.appendChild(tick);
    return { start: start, end: +el.dataset.out, name: el.dataset.chapter, tick: tick, past: false };
  });
  var shownChapter = null;

  function updateChapters(frameNumber) {      // frameNumber is 1-based
    var now = null;
    for (var i = 0; i < chapters.length; i++) {
      var c = chapters[i];
      var past = frameNumber >= c.start;
      if (past !== c.past) { c.past = past; c.tick.classList.toggle('is-past', past); }
      if (past) now = c;
    }
    // A chapter's name stays until the next one starts; the last one ends with its card
    if (now && now === chapters[chapters.length - 1] && frameNumber > now.end) now = null;
    if (now !== shownChapter) {
      if (shownChapter) shownChapter.tick.classList.remove('is-current');
      if (now) now.tick.classList.add('is-current');      // amber tick
      shownChapter = now;
      if (now) {
        chapterName.textContent = now.name;
        chapterName.style.top = now.tick.style.top;
      }
      chapterName.classList.toggle('is-on', !!now);
    }
  }

  /* ---------- The animation loop ----------
     One requestAnimationFrame loop. It runs while something moves and goes
     to sleep when the film has reached the scroll position. wake() starts
     it again: on every scroll, on resize, and when a frame finishes loading. */
  var running = false, lastTime = 0, lastIndex = -1, lastIntro = -1, cardsAt = -1;

  function wake(redraw) {
    if (redraw) needsDraw = true;
    if (running) return;
    running = true;
    lastTime = 0;
    requestAnimationFrame(step);
  }

  function step(now) {
    var dt = lastTime ? Math.min(100, now - lastTime) : 16.7;
    lastTime = now;

    // Glide toward the scroll target (scaled by time, so 60 Hz and 120 Hz feel the same)
    var diff = target - current;
    if (diff !== 0) {
      if (Math.abs(diff) > JUMP) current = target;
      else current += diff * (1 - Math.pow(1 - EASE, dt / 16.7));
      if (Math.abs(target - current) < 0.01) current = target;    // close enough: arrive
    }

    var intro = introStart === null ? 0 : Math.min(INTRO_FRAMES, (now - introStart) / 1000 * INTRO_FPS);
    var f = filmFrame();

    if (current !== cardsAt || intro !== lastIntro) {
      updateCards(f, intro);
      progressFill.style.transform = 'scaleY(' + progressFromPos(current).toFixed(4) + ')';
      cardsAt = current;
      lastIntro = intro;
    }
    var index = indexAt(f - 1);
    if (index !== lastIndex) {
      updateChapters(index + 1);
      releaseBitmaps(active);
      feedBitmaps();
      lastIndex = index;
    }
    draw();
    if (debug) showDebug();

    // Keep going while the film glides or the intro plays; otherwise sleep
    var introPlaying = introStart === null || intro < INTRO_FRAMES;
    if (current !== target || introPlaying || needsDraw) {
      requestAnimationFrame(step);
    } else {
      running = false;
      if (debug) showDebug();
    }
  }

  /* ---------- Debug overlay (only with ?debug in the address) ---------- */
  var debug = /[?&]debug\b/.test(location.search) ? document.createElement('pre') : null;
  if (debug) {
    debug.setAttribute('aria-hidden', 'true');
    debug.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;margin:0;padding:8px 10px;' +
      'background:rgba(0,0,0,.8);color:#fff;font:12px/1.4 ui-monospace,Consolas,monospace;pointer-events:none;border-radius:6px';
    document.body.appendChild(debug);
  }
  function showDebug() {
    debug.textContent =
      'target frame  ' + (indexAt(target) + 1) + '\n' +
      'film frame    ' + (indexAt(filmFrame() - 1) + 1) + '  (text cards use this)\n' +
      'drawn frame   ' + (drawnIndex >= 0 ? drawnIndex + 1 : 'poster') + '\n' +
      'drawn from    ' + drawnLevel + '\n' +
      'loaded        ' + active.loadedCount + ' / ' + FRAME_COUNT + '  (' + active.name + (LITE ? ', lite' : '') + ')\n' +
      'bitmaps alive ' + active.bmpLive.length + (CAN_BITMAP ? '' : '  (not supported: images only)') + '\n' +
      'downloading   ' + loads + '\n' +
      'loop          ' + (running ? 'running' : 'sleeping');
  }

  /* ---------- Start ---------- */
  // Re-measure after the window settles (resize / rotation), not on every pixel
  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 150);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.addEventListener('load', measure);   // fonts/images can shift the layout

  measure();
  if (debug) setInterval(showDebug, 250);     // keeps the panel fresh while the loop sleeps

  // Small hook for main.js
  window.TrinetraFilm = {
    setScroll: setScroll,
    measure: measure,
    // Scroll position of a frame (n is 1-based)
    scrollForFrame: function (n) {
      var i = Math.max(0, Math.min(FRAME_COUNT - 1, n - 1));
      var mid = (cumulative[i] + cumulative[i + 1]) / 2;   // middle of that frame's scroll slice
      return filmTop + (mid / cumulative[FRAME_COUNT]) * filmScroll;
    },
    filmEnd: function () { return filmTop + filmScroll; },
    // For testing in the browser console
    state: function () {
      return { want: indexAt(target) + 1, at: indexAt(filmFrame() - 1) + 1,
               drawn: drawnLevel === 'poster' ? 'poster' : active.name + drawnIndex, level: drawnLevel, set: active.name,
               loaded: active.loadedCount, bitmaps: active.bmpLive.length, running: running };
    }
  };
})();
