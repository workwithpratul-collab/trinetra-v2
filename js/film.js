/* =========================================================
   Trinetra v2 · film.js
   The scroll film: draws 1,189 frames on a <canvas> while you scroll,
   moves the timed text cards with the scroll, and runs the chapter
   indicator on the right edge.

   How it stays smooth:
   - Frames are downloaded as small compressed files, then DECODED ahead
     of time into ready-to-draw pictures (ImageBitmap). Drawing a decoded
     picture is instant; drawing an undecoded one makes the browser
     decode it on the spot, which is what caused the stutter.
   - Only the frames near the playhead (±40) are kept decoded; the rest
     are freed so phones don't run out of memory.
   - The playhead glides toward the scroll position instead of jumping,
     so a fast scroll plays through the frames instead of skipping them.
   - This file never listens to scroll itself. main.js owns the one
     animation loop: it gives us the scroll position (setScroll) and
     calls tick() once per screen refresh.
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
  var MAX_DECODES = 4;        // at most 4 frames being decoded at the same time
  var NEAR = 60;              // download every frame within ±60 of the playhead first
  var KEEP = 40;              // keep frames within ±40 of the playhead decoded
  var RELEASE = 46;           // free decoded frames further away than this (a little slack, so frames don't flicker in and out)
  var EASE = 0.18;            // playhead moves 18% of the way to the scroll target per frame (at 60 fps)
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

  // Can this browser decode into an ImageBitmap? (Older Safari can't: we
  // then fall back to <img> + img.decode(), and keep those images.)
  var CAN_BITMAP = typeof window.createImageBitmap === 'function' && typeof window.fetch === 'function';

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
  // The other way round: playhead position → share of the film (0..1),
  // used for the progress line so it matches the ticks.
  function progressFromPos(x) {
    var i = Math.min(FRAME_COUNT - 1, Math.floor(x));
    return (cumulative[i] + (x - i) * (cumulative[i + 1] - cumulative[i])) / cumulative[FRAME_COUNT];
  }
  // Playhead position → the frame index to draw (a whole number)
  function frameAt(x) { return Math.min(FRAME_COUNT - 1, Math.floor(x)); }

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
      state: new Uint8Array(FRAME_COUNT),   // 0 = not asked for, 1 = downloading, 2 = downloaded, 3 = failed
      files: new Array(FRAME_COUNT),        // downloaded file, still compressed (small)
      pics: new Array(FRAME_COUNT),         // decoded picture, ready to draw
      decoding: new Uint8Array(FRAME_COUNT),
      live: [],                             // indexes that have a decoded picture right now
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

  /* ---------- Playhead ---------- */
  var target = 0;      // where the scroll position says we should be
  var current = 0;     // where the film actually is (glides toward target)
  var needsDraw = true;

  /* ---------- Downloading ---------- */
  var loads = 0;

  // Which frame to download next: the nearest missing frame around the
  // playhead first (expanding outward), then the far-away passes.
  function nextToLoad(set) {
    var c = frameAt(target);
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
      download(active, i);
    }
  }

  function download(set, i) {
    set.state[i] = 1;
    loads++;
    function finish(ok) {
      loads--;
      if (!ok) set.state[i] = 3;
      pump();
    }
    if (CAN_BITMAP) {
      fetch(frameUrl(set, i)).then(function (res) {
        if (!res.ok) throw new Error(res.status);
        return res.blob();
      }).then(function (file) {
        set.files[i] = file;
        set.state[i] = 2;
        finish(true);
        if (set === active) feedDecoder();      // decode it if it's near the playhead
      }).catch(function () { finish(false); });
    } else {
      // Fallback: an <img>, decoded with img.decode() before we use it
      var img = new Image();
      img.src = frameUrl(set, i);
      img.decode().then(function () {
        set.pics[i] = img;
        set.state[i] = 2;
        finish(true);
        if (set === active) needsDraw = true;
      }, function () { finish(false); });
    }
  }

  /* ---------- Decoding (only near the playhead) ---------- */
  var decodes = 0;

  // Decode downloaded frames within ±KEEP of the scroll target, nearest first
  function feedDecoder() {
    if (!CAN_BITMAP || !active) return;
    var c = frameAt(target);
    for (var d = 0; d <= KEEP && decodes < MAX_DECODES; d++) {
      decode(active, c + d);
      if (d) decode(active, c - d);
    }
  }

  function decode(set, i) {
    if (i < 0 || i >= FRAME_COUNT || decodes >= MAX_DECODES) return;
    if (set.state[i] !== 2 || set.pics[i] || set.decoding[i]) return;
    set.decoding[i] = 1;
    decodes++;
    createImageBitmap(set.files[i]).then(function (pic) {
      decodes--;
      set.decoding[i] = 0;
      if (set !== active || isFar(i)) {
        pic.close();                            // no longer needed: free it straight away
      } else {
        set.pics[i] = pic;
        set.live.push(i);
        needsDraw = true;                       // a closer frame may now exist
      }
      feedDecoder();
    }, function () {
      decodes--;
      set.decoding[i] = 0;
      set.state[i] = 3;
      feedDecoder();
    });
  }

  // Far from both the frame on screen and the scroll target?
  function isFar(i) {
    return Math.abs(i - current) > RELEASE && Math.abs(i - target) > RELEASE;
  }

  // Free decoded frames that are far away (they can be decoded again
  // from the downloaded file, without downloading it again)
  function releaseFar(set) {
    if (!CAN_BITMAP) return;
    var keep = [];
    for (var k = 0; k < set.live.length; k++) {
      var i = set.live[k];
      if (set === active && !isFar(i)) { keep.push(i); continue; }
      set.pics[i].close();
      set.pics[i] = null;
    }
    set.live = keep;
  }

  // Nearest decoded frame to i (looks backward and forward)
  function nearestDecoded(set, i) {
    if (set.pics[i]) return i;
    for (var d = 1; d < FRAME_COUNT; d++) {
      if (i - d >= 0 && set.pics[i - d]) return i - d;
      if (i + d < FRAME_COUNT && set.pics[i + d]) return i + d;
    }
    return -1;
  }

  /* ---------- Drawing ---------- */
  // Shown until the first frame is decoded (same files the <head> preloads)
  var posters = { desktop: new Image(), portrait: new Image() };
  posters.desktop.onload = posters.portrait.onload = function () { needsDraw = true; };

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
  function drawCover(pic, isDesktopFrame, focusX) {
    var cw = canvas.width, ch = canvas.height;
    var iw = pic.naturalWidth || pic.width, ih = pic.naturalHeight || pic.height;
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
    ctx.drawImage(pic, sx, sy, sw, sh, 0, 0, cw, ch);
  }

  var drawnKey = '';        // what is on the canvas right now

  function draw(frame) {
    var n = nearestDecoded(active, frame);
    var key = n >= 0 ? active.name + n : 'poster';
    if (!needsDraw && key === drawnKey) return;   // nothing changed: skip
    needsDraw = false;
    var isDesktop = active.name === 'desktop';
    if (n >= 0) {
      drawCover(active.pics[n], isDesktop, isDesktop ? null : portraitFocus(n));
    } else if (posters[active.name].naturalWidth) {
      drawCover(posters[active.name], isDesktop);
    } else {
      return;
    }
    drawnKey = key;
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
      if (old) releaseFar(old);                 // frees all of the old set's decoded frames
      var poster = posters[name];
      if (!poster.src) poster.src = name === 'desktop' ? 'assets/poster.webp' : 'assets/frames/portrait/f0001.webp';
      needsDraw = true;
    }
    sizeCanvas();
    setScroll(window.scrollY);
    if (!started) { current = target; started = true; }   // first time: start right where the page is
    pump();
    feedDecoder();
  }

  // Called by main.js with every scroll position (from Lenis's scroll event)
  function setScroll(y) {
    var p = (y - filmTop) / filmScroll;
    var t = posFromProgress(p < 0 ? 0 : p > 1 ? 1 : p);
    if (frameAt(t) !== frameAt(target)) {
      target = t;
      pump();                                   // new nearby frames to fetch
      feedDecoder();                            // and to decode
    } else {
      target = t;
    }
    var hide = y > 24;
    if (hide !== cueHidden) { cueHidden = hide; cue.classList.toggle('is-hidden', hide); }
  }
  var cueHidden = false;

  /* ---------- Text cards (move with the scroll) ----------
     Every element with class "timed" has data-in and data-out (frame numbers).
     Its look is worked out from the exact playhead position, so the text
     moves with the film and plays backward when you scroll back:
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
    document.fonts.ready.then(function () { introStart = performance.now(); });   // wait for the headline font
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

  function updateCards(f, intro) {      // f = exact frame (1-based, with fractions)
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
      // "is-moving" turns on will-change (CSS) only while the card animates,
      // so the browser keeps it on its own layer just for that time.
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

  /* ---------- One step, once per screen refresh (called by main.js) ---------- */
  var lastFrame = -1, lastIntro = -1, lastTime = 0, cardsAt = -1;

  function tick(now) {
    var dt = lastTime ? Math.min(100, now - lastTime) : 16.7;
    lastTime = now;

    // Glide the playhead toward the scroll target. The step is scaled by
    // time, so it feels the same on 60 Hz and 120 Hz screens.
    var diff = target - current;
    if (diff !== 0) {
      if (Math.abs(diff) > JUMP) current = target;
      else current += diff * (1 - Math.pow(1 - EASE, dt / 16.7));
      if (Math.abs(target - current) < 0.01) current = target;    // close enough: stop gliding
    }

    var intro = introStart === null ? 0 : Math.min(INTRO_FRAMES, (now - introStart) / 1000 * INTRO_FPS);

    // Nothing moving and nothing new to draw? Then do no work at all.
    if (current === cardsAt && intro === lastIntro && !needsDraw) return;

    if (current !== cardsAt || intro !== lastIntro) {
      updateCards(current + 1, intro);
      progressFill.style.transform = 'scaleY(' + progressFromPos(current).toFixed(4) + ')';
      cardsAt = current;
      lastIntro = intro;
    }
    var frame = frameAt(current);
    if (frame !== lastFrame) {
      updateChapters(frame + 1);
      releaseFar(active);
      feedDecoder();
      lastFrame = frame;
    }
    draw(frame);
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

  // Small hook for main.js
  window.TrinetraFilm = {
    tick: tick,
    setScroll: setScroll,
    measure: measure,
    // Scroll position of a frame (n is 1-based)
    scrollForFrame: function (n) {
      var i = Math.max(0, Math.min(FRAME_COUNT - 1, n - 1));
      var mid = (cumulative[i] + cumulative[i + 1]) / 2;   // middle of that frame's scroll slice
      return filmTop + (mid / cumulative[FRAME_COUNT]) * filmScroll;
    },
    filmEnd: function () { return filmTop + filmScroll; },
    // For testing in the browser console: which frame is wanted vs. drawn
    state: function () {
      return { want: frameAt(target) + 1, at: frameAt(current) + 1, drawn: drawnKey, set: active.name, decoded: active.live.length };
    }
  };
})();
