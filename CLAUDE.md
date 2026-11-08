# Trinetra v2: cinematic scroll-film website

## What this is
A brand-new one-page website for **Trinetra Creations**, a hoarding and flex-banner company in **Raipur** (design, large-format printing and installation). CEO: **Ashutosh Mishra** (his name goes in the footer).
The site works as an **advertisement for Trinetra**: a visitor scrolls and a short film plays, telling the story of a banner from a blank sheet to a giant city hoarding with the Trinetra logo. After the film come a few short sections and a contact block.

This is a pitch demo for the client, hosted on **GitHub Pages**.

## How to work with me (the developer)
- I'm learning. After each step, explain in plain, simple words what you built and why, file by file. Go a little slower and keep it simple.
- Plain **HTML, CSS and JavaScript**. No frameworks, no build tools.
- Allowed libraries (from a CDN, pinned versions): **GSAP + ScrollTrigger**, **Lenis** (smooth scroll). Nothing else without asking.
- Small, clear files with comments. Commit with Git after each working step.
- Test with VS Code **Live Server** (not by double-clicking the HTML file, because images loaded by script need a server).

## Folder layout
```
index.html
css/style.css
js/film.js        (scroll film: canvas + frames + text cards + chapter ticks)
js/main.js        (everything else: Lenis, reveals, nav, FAQ)
assets/frames/desktop/f0001.webp  … f1189.webp   (1280×720, landscape screens)
assets/frames/portrait/f0001.webp … f1189.webp   (405×720, tall phone frames, already cropped to follow the subject)
assets/logo.png
assets/poster.webp   (copy of frame f0001, shown while frames load)
```

## The scroll film (the main feature)
- 1,189 frames at 24 fps (about 49.5 seconds of film). Frames are named `f0001.webp` to `f1189.webp`.
- Draw the frames on a full-screen `<canvas>` inside a **pinned (sticky) section**. Scrolling moves through the frames. Scrolling back plays it backward.
- Scroll length: about **14–16 screen heights** for the whole film, so it feels slow and cinematic. Tune by feel.
- Choose the frame set by **screen shape**, not width: if the viewport is taller than it is wide (width/height < 0.8), use **portrait** frames; otherwise use **desktop** frames. Re-check on resize and orientation change.
- Draw with "cover" fitting (fill the screen, crop the overflow), centred, like CSS `object-fit: cover`. The portrait frames are already cropped to follow the subject, so no extra panning is needed.
- Desktop frames only: draw **zoomed in by about 4%** to crop off the small "Veo" watermark in the bottom-right corner. Portrait frames already have it removed.
- **Loading:** show the poster immediately. Load frames progressively: first every 8th frame across the whole film (so scrolling works at once at lower smoothness), then fill in the rest. Always draw the nearest frame that has loaded. Never block the page waiting for all frames.
- Use `requestAnimationFrame` and only redraw when the frame number changes.
- `prefers-reduced-motion`: skip the film and show the scenes as a simple stacked section, one still frame per scene with the same text and positions (stills: f0040, f0185, f0330, f0480, f0700, f0800, f1000, f1040, f1160).

### Text cards timed to frames
Text is real HTML on top of the canvas (never burned into the images). Each card is visible only between its frames. Cards never overlap.
"Desktop" = desktop frames, "Phone" = portrait frames. *text* = the serif accent phrase. Alignment follows placement: right-side cards are right-aligned, centred cards are centred, the rest left-aligned (same side on phones and desktop).

| Frames | Label | Headline | Body | Desktop | Phone |
|---|---|---|---|---|---|
| 1–75 | Trinetra Creations · Raipur | Every hoarding starts as a *blank sheet.* | (none) | bottom-left | top |
| 135–220 | 01 · Print | Printed in-house, *colour-true.* | Large-format machines in our own facility, so your brand colours stay exact from the first sheet to the last. | top-right | top, right-aligned |
| 275–380 | 02 · Finish | Every edge, *reinforced.* | Hemmed borders and metal eyelets along every side keep the flex tight through wind and monsoon rain. | top-left | bottom |
| 430–505 | 03 · Our crew | One team, *start to finish.* | The people who print your hoarding are the people who carry it out and put it up. | top-right | bottom, right-aligned |
| 588–650 | (none) | *From our floor…* (whole line in the serif italic) | (none) | centred | centred |
| 613–667 | (none) | …TO YOUR SKYLINE. (Big Shoulders 900, amber) | (none) | centred, under the line above | same |
| 760–832 | 04 · Install | Installed safely, *at any height.* | Harnessed, helmeted installers mount and tension every banner on site. | top-left | top |
| 836–924 | (none) | Imagine. / Believe. / Achieve. (appear at 836, 861, 887; violet, magenta, saffron) | (none) | centred, in a row | centred, stacked |
| 935–1060 | 05 · Light | Seen *day and night.* | Floodlit and backlit options keep your message working long after sunset. | bottom-centre (headline on one line) | bottom, centred |
| 1080–1189 | Imagine · Believe · Achieve | Your brand, *seen by the whole city.* + buttons | (none) | left third, vertically centred | bottom |

Safe margins: desktop 5.5vw from the edges; phones 20px at the sides, top cards start below the fixed header. Respect safe-area insets.
The black moments (frames ~588–667 and ~836–924) are deliberate: the text must fill them so the viewer never notices a black screen.
Text animation is **scroll-linked** (it plays backward when you scroll back): each line rises out of a mask (`overflow: hidden` wrapper, inner span from `translateY(130%)` to `0`; the extra room under each line is for the serif's tails) over ~15 frames with an ease-out curve, 3 frames stagger between lines; label, body and buttons fade up a few frames later; each card fades out over its last ~12 frames. Cards also drift ~12px in from their own side (left cards from the left, right cards from the right; centred cards only rise). The opening card plays in by itself on page load.
Soft dark gradient on the side where the text sits (top-left or top-right corner for top cards, bottom for bottom cards, full-width bottom for the bottom-centre card, left for the finale), only as strong as needed for WCAG AA contrast. Very bright frames (the Print scene) get a deeper one (`scene--bright`).
**Chapter labels:** each chapter card's label starts with a short amber hairline (32px × 1px) on the side the text is aligned to (both sides for centred cards); the chapter number is amber. Right-aligned and centred cards keep body text to ~30 characters per line.
**Chapter indicator:** a thin progress line on the right edge (brand gradient fill) with 5 ticks at the start frames of Print, Finish, Crew, Install, Light; the current tick and chapter name are amber. On big screens right-aligned cards keep at least 150px from the right edge so they never meet the chapter name. On big screens the current chapter name shows beside the line in tiny Barlow Semi Condensed; on phones (and phones held sideways) just the line with ticks. A "Scroll" cue at the start fades out once scrolling begins.

## Mobile first (most visitors are on phones)
Design and test **phone first (390×844)**, then scale up to tablet and desktop. The phone version must feel at least as premium as desktop, never like a squeezed desktop page.
- **Film on phones:** text never covers the main subject. Text sits where the card table says (top or bottom) over a soft dark gradient; black-moment text is centred. Film headlines about 13vw, labels at least 11px, body at least 16px.
- **Thumb-friendly:** every button and link at least 48px tall, main actions in the lower half of the screen.
- **Sticky action bar on phones:** after the film ends, a slim bar fixed to the bottom with two buttons: **Call** and **WhatsApp** (WhatsApp is the amber primary button). It respects the iPhone home-bar safe area (`env(safe-area-inset-bottom)`). Hide it during the film.
- **Use `svh`/`dvh` units** for full-screen sections so the mobile browser's address bar doesn't cause jumps.
- **Touch:** no hover-only features. Anything that reacts to hover on desktop has a tap or scroll-based version on phones.
- **Performance on mobile data:** poster shows instantly; on slow connections or Save-Data, load every 2nd frame; images below the film are lazy-loaded.
- **Test widths:** 360, 390, 430 (phones), 768 (tablet), 1280 and 1920 (desktop), in both portrait and landscape on phones.

## Demo content (this is a sample site)
The client has not given real details yet, so the site uses realistic **sample content**:
- Phone and WhatsApp: use the obvious dummy **+91 98XXX XXXXX**, and `https://wa.me/` with no number. Never a real-looking number.
- Work photos: sample images of hoardings for **fictional brands only**, never real companies. Captions use generic areas of Raipur and plausible sizes.
- No invented client names, years in business, project counts, ratings or awards.
- Footer shows a small label line: "Demo website · sample content".
- Add `<meta name="robots" content="noindex, nofollow">` to every page and `Disallow: /` in robots.txt until the client approves the site. Leave a clear comment showing how to switch it to "index" later.

## Typography (direction "D · Highway" + a serif accent, about 75% / 25%)
- **Headlines:** Big Shoulders Display (Google Fonts), weight 800, UPPERCASE, letter-spacing 0.005em, line-height 0.88, `text-wrap: balance`.
- **Contrast face: Instrument Serif** (regular and italic), used ONLY for:
  - the **highlighted phrase** in every headline (one per screen): Instrument Serif *italic*, lowercase, 1.1× the headline size, same baseline, letter-spacing -0.012em. Example: EVERY HOARDING STARTS AS A *blank sheet.* Colour: only the serif phrase is coloured (see "Accent phrase colours"); the Big Shoulders words stay `--ink`.
  - "*From our floor…*" in the film (the answer "…TO YOUR SKYLINE." stays Big Shoulders, amber);
  - **section intros** (the 1–2 sentence lead under a section headline): Instrument Serif regular, 20px phones, 22–26px desktop, line-height 1.3, `--ink`;
  - the footer tagline "*Imagine · Believe · Achieve*" (italic).
- **Body, buttons, links:** Barlow 400 (body) and 500 (buttons). Body line-height 1.55.
- **Labels and specs:** Barlow Semi Condensed 600, uppercase, letter-spacing 0.18em, at least 11px.
- Load from Google Fonts with `preconnect` and `display=swap`. No other fonts.
- Sizes: film headlines `clamp(3rem, 7vw, 7.5rem)` on wide screens (also capped by screen height), about 13vw on phones; section headlines `clamp(2.6rem, 6vw, 6rem)`; body 17–18px on phones, 18–19px on desktop.
- Body text max ~32 characters per line inside the film (~30 for right-aligned and centred cards), ~60 elsewhere.
- Only one serif accent phrase per screen. No gradient-filled text anywhere.

## Colours
Calm warm neutrals with ONE accent. Dark site only.
```
--night:   #0b0a0d   (page background)
--panel:   #16141a
--ink:     #f4efe8   (warm white, main text)          17:1 on --night
--mute:    #9e968e   (secondary text)                 6.8:1 on --night
--amber:   #ffa23a   (the single accent)              9.9:1 on --night
--line:    rgba(244, 239, 232, 0.14)
```
**Amber** (floodlights, sodium street lights) is used sparingly, only for: chapter numbers and hairlines, the active chapter tick and name, spec lines (sizes and materials), "…TO YOUR SKYLINE.", the FAQ open/close icon, and the primary button fill.
**Brand colours** (`--brand-violet` #9b4dff, `--brand-magenta` #e8399a, `--brand-saffron` #ff8a3d, gradient violet → magenta → saffron) are reserved for exactly four places: the logo itself; "Imagine. Believe. Achieve." in the black moment (one colour per word); the progress line fill; the primary button's hover sweep.

**Accent phrase colours** (scene-light tokens, ONLY for the serif phrase in headlines): `--violet-soft` #b892ff (factory LED), `--saffron` #ff9a4d (printed arc), `--amber`, `--rose` #ff7aa8 (twilight, magenta banner), `--gold` #ffd27a (lit hoarding at night).
Film: blank sheet → ink · 01 Print → violet-soft · 02 Finish → saffron · 03 Crew → amber · From our floor… → ink · 04 Install → rose · 05 Light → gold · finale → amber. Sections after the film: amber, except Contact ("up there.") → gold. All measured ≥ 5.9:1 over the real frames + gradients.
Every text colour must pass WCAG AA on its background.

## Interactions
- Lenis smooth scrolling for the whole page.
- Primary button: amber pill with `--night` text; on hover a brand-gradient fill sweeps in from left to right. The text stays `--night` (dark on the gradient passes AA; white would not).
- Text links: an underline grows from left to right on hover.
- Visible keyboard focus everywhere.

## Sections after the film
Each of What we do, How it works, Work and Contact has a 1–2 sentence intro under the headline (in Instrument Serif). Layouts vary from section to section so the page has rhythm:
1. **What we do:** headline LEFT, three items in a row. "Design. Print. *Install.*" with three columns (Design / Print / Install), each with one short line and a spec label line with sample sizes and materials (e.g. "Up to 40 × 20 ft", "Star flex · Vinyl · Backlit").
2. **How it works:** headline and intro CENTRED above the steps. "Four steps to *your skyline.*", 4 steps (Brief, Design, Print, Install) with number, title and one line. Phones: vertical timeline with a thin neutral line joining the steps. Desktop: four columns.
3. **Why Trinetra:** "Big, bright and *built to last.*", 4 points (title + one line). Desktop: two columns, headline sticky on the left while the points scroll on the right. Phones: stacked.
4. **FAQ:** headline left, accordion right (desktop); stacked on phones. "Before you *book.*", an accordion built with `<details>` (tap or keyboard, one open at a time).
5. **Work:** headline RIGHT-aligned above the grid. A grid of 6 sample hoarding photos for fictional brands (assets/work/work-1.webp … work-6.webp), with short captions (area of Raipur and size).
6. **Contact:** everything CENTRED, very large headline, dummy phone and WhatsApp (see Demo content), "Raipur, Chhattisgarh", a "Plan your hoarding" button.
7. **Footer:** Trinetra Creations, tagline "*Imagine · Believe · Achieve*" (serif italic), CEO Ashutosh Mishra, Raipur, year.

## Quality bar
- Must feel smooth on a mid-range Android phone and an iPhone.
- No horizontal scrolling at any width. Test at 390px and 1440px wide.
- Good SEO basics: title, meta description, real headings in HTML, alt text.
- Never invent facts about Trinetra (client names, numbers, years). Use clearly marked placeholders instead.
