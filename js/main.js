/* =========================================================
   Trinetra v2 · main.js
   Everything except the film: smooth scrolling (Lenis),
   anchor links, header state, scroll reveals.
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
      autoRaf: true
    });
    window.TrinetraLenis = lenis;
  }

  /* ---------- 2. "Catch" fast swipes at text cards ----------
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

  if (lenis && film) {
    lenis.on('scroll', function (e) {
      var y = e.scroll;
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
    });
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

  /* ---------- 3. Anchor links (#contact, #work, #top) ---------- */
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

  /* ---------- 4. Header: subtle during the film, solid after ---------- */
  var filmEl = document.querySelector('.film');
  function filmBottom() {
    return film ? film.filmEnd() : filmEl.offsetTop + filmEl.offsetHeight - window.innerHeight;
  }
  var past = null;
  function updateHeader() {
    var isPast = window.scrollY > filmBottom() - 2;
    if (isPast !== past) {
      past = isPast;
      root.classList.toggle('is-past-film', isPast);
    }
  }
  if (lenis) lenis.on('scroll', updateHeader);
  else window.addEventListener('scroll', updateHeader, { passive: true });
  window.addEventListener('resize', updateHeader);
  updateHeader();
})();
