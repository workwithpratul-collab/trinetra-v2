/* =========================================================
   Trinetra v2 · main.js
   Everything except the film: smooth scrolling (Lenis),
   anchor links, header state, scroll reveals, work carousel, FAQ.
   ========================================================= */
(function () {
  'use strict';

  var root = document.documentElement;
  var filmOn = root.classList.contains('film-on');
  var film = window.TrinetraFilm || null;          // set by film.js
  var lenis = null;

  /* ---------- 1. Smooth scrolling (Lenis) ----------
     Only when motion is allowed. If the Lenis file fails to load,
     the page simply uses normal browser scrolling. */
  if (filmOn && window.Lenis) {
    lenis = new window.Lenis({
      lerp: 0.085,                 // mouse wheel: lower = smoother, floatier
      wheelMultiplier: 0.9,        // a little less distance per wheel notch
      syncTouch: true,             // phones: Lenis also smooths finger swipes...
      syncTouchLerp: 0.07,
      touchInertiaMultiplier: 24,  // ...with a shorter "fling" than native (default 35)
      allowNestedScroll: true,     // sideways carousels still swipe natively
      autoRaf: false               // we run Lenis from our own loop (section 2)
    });
    window.TrinetraLenis = lenis;
  }

  /* ---------- 2. ONE loop and ONE scroll listener for the whole page ----------
     Every screen refresh: Lenis moves the scroll a little, then the film
     draws. Lenis's "scroll" event is the single place the scroll position
     comes from; it feeds the film, the header and the swipe catcher.
     (Without Lenis, the browser's own scroll event does the same job.) */
  function onScroll(y, e) {
    if (film) film.setScroll(y);
    updateHeader(y);
    if (e) catchSwipe(y, e);
  }
  if (lenis) {
    lenis.on('scroll', function (e) { onScroll(e.scroll, e); });
  } else {
    window.addEventListener('scroll', function () { onScroll(window.scrollY, null); }, { passive: true });
  }
  if (lenis || film) {
    requestAnimationFrame(function loop(time) {
      if (lenis) lenis.raf(time);     // 1. smooth scroll step (fires "scroll" if it moved)
      if (film) film.tick(time);      // 2. film + text cards (does nothing when idle)
      requestAnimationFrame(loop);
    });
  }

  /* ---------- 3. "Catch" fast swipes at text cards ----------
     If a fast swipe or wheel spin enters a text moment, glide to the
     middle of it and pause briefly, so the words can be read. */
  var CATCH = [
    { enter: 588,  hold: 632 },    // From our floor… to your skyline.
    { enter: 836,  hold: 906 },    // Imagine. Believe. Achieve.
    { enter: 1080, hold: 1150 }    // Your brand, seen by the whole city.
  ];
  var FAST = 28;                   // px per frame; slower scrolling is never touched
  var programmatic = false;        // true while WE are scrolling (anchors, catches)
  var lastY = window.scrollY;

  function catchSwipe(y, e) {
    if (!film) return;
    var prev = lastY;
    lastY = y;
    // Only real swipes and wheel spins ('smooth'). Never jumps such as the
    // browser restoring your position, dragging the scrollbar, or keyboard.
    if (programmatic || e.isScrolling !== 'smooth' || Math.abs(e.velocity) < FAST) return;
    if (Math.abs(y - prev) > window.innerHeight) return;   // a jump, not a swipe

    for (var i = 0; i < CATCH.length; i++) {
      var c = CATCH[i];
      var enterY = film.scrollForFrame(c.enter);
      var holdY = film.scrollForFrame(c.hold);
      var goingDown = prev < enterY && y >= enterY;   // crossed the start going down
      var goingUp = prev > holdY && y <= holdY;       // crossed the middle going up
      if (goingDown || goingUp) {
        glideTo(holdY, 1.1, true);
        break;
      }
    }
  }

  // Smooth scroll to a position. lock = ignore input while gliding.
  function glideTo(y, duration, lock) {
    if (!lenis) { window.scrollTo(0, y); return; }
    programmatic = true;
    lenis.scrollTo(y, {
      duration: duration,
      lock: !!lock,
      easing: function (t) { return 1 - Math.pow(1 - t, 3); },   // ease-out
      onComplete: function () { programmatic = false; lastY = window.scrollY; }
    });
  }

  /* ---------- 4. Anchor links (#contact, #work, #top) ---------- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (id === '#' || id.length < 2) return;
    var target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();

    var y = id === '#top' ? 0 : target.getBoundingClientRect().top + window.scrollY;
    // Long trips (through the whole film) take a bit longer, but never drag on
    var distance = Math.abs(y - window.scrollY);
    var duration = Math.min(2.4, 0.8 + distance / 9000);
    if (lenis) glideTo(y, duration, false);
    else window.scrollTo({ top: y, behavior: filmOn ? 'smooth' : 'auto' });

    // Move keyboard focus to the section, so Tab continues from there
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    if (history.replaceState) history.replaceState(null, '', id);
  });

  /* ---------- 5. Header: subtle during the film, solid after ----------
     Called from onScroll (section 2). The class "is-past-film" also
     slides the phone action bar into view. */
  var filmEl = document.querySelector('.film');
  function updateHeader(y) {
    var bottom = film ? film.filmEnd() : filmEl.offsetTop + filmEl.offsetHeight - window.innerHeight;
    var isPast = y > bottom - 2;
    if (isPast !== headerPast) {
      headerPast = isPast;
      root.classList.toggle('is-past-film', isPast);
    }
  }
  var headerPast = null;
  window.addEventListener('resize', function () { updateHeader(window.scrollY); });
  updateHeader(window.scrollY);

  /* ---------- 6. Scroll reveals ----------
     Elements with class "reveal" fade and rise in when they enter the screen.
     The hiding CSS only applies after we add "reveal-on" here, so if this
     script never runs, nothing is ever hidden. */
  var reveals = document.querySelectorAll('.reveal');
  if (filmOn && 'IntersectionObserver' in window) {
    root.classList.add('reveal-on');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);          // reveal once, then forget it
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.01 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ---------- 7. Work carousel counter ("1 / 6") on phones ---------- */
  var track = document.querySelector('.work__track');
  var current = document.querySelector('.work__current');
  if (track && current) {
    var items = track.children;
    document.querySelector('.work__total').textContent = items.length;
    var ticking = false;
    track.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var step = items[1] ? items[1].offsetLeft - items[0].offsetLeft : 1;
        var index = Math.round(track.scrollLeft / step);
        // At the very end, the last card can't reach the left edge: count it anyway
        if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 4) index = items.length - 1;
        current.textContent = Math.min(items.length, index + 1);
      });
    }, { passive: true });
  }

  /* ---------- 8. FAQ: one answer open at a time ----------
     Modern browsers already do this because every <details> has name="faq".
     This covers older browsers: opening one closes the others. */
  var faqs = document.querySelectorAll('.faq__item');
  Array.prototype.forEach.call(faqs, function (item) {
    item.addEventListener('toggle', function () {
      if (!item.open) return;
      Array.prototype.forEach.call(faqs, function (other) {
        if (other !== item && other.open) other.open = false;
      });
    });
  });

  /* ---------- 9. Footer year ---------- */
  var year = document.querySelector('.year');
  if (year) year.textContent = new Date().getFullYear();
})();
