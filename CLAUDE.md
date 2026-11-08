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
js/film.js        (scroll film: canvas + frames + text cards)
js/main.js        (everything else: Lenis, reveals, nav)
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
- `prefers-reduced-motion`: skip the film and show 4 still frames (f0040, f0700, f1000, f1160) as a simple stacked section with the same text.

### Text cards timed to frames
Text is real HTML on top of the canvas (never burned into the images). Each card is visible only between its frames.

| Text | In (frame) | Out (frame) | Placement |
|---|---|---|---|
| Label "Trinetra Creations · Raipur" + headline "Every hoarding starts / as a *blank sheet.*" | 1 | 120 | bottom-left |
| "From our floor…" | 588 | 650 | centred (screen is black here) |
| "*…to your skyline.*" (gradient) | 613 | 667 | centred, under the line above |
| "Imagine." | 836 | 924 | centred, in a row, violet |
| "Believe." | 861 | 924 | centred, in a row, magenta |
| "Achieve." | 887 | 924 | centred, in a row, saffron |
| Label "Imagine · Believe · Achieve" + headline "Your brand, / *seen by the whole city.*" + buttons | 1080 | 1189 (stays) | left third, vertically centred (hoarding is on the right) |

The black moments (frames ~588–667 and ~836–924) are deliberate: the text must fill them so the viewer never notices a black screen.
Text animation: each line rises out of a mask (`overflow: hidden` wrapper, inner span moves from `translateY(105%)` to `0`), about 1 s with an ease-out curve, 0.09 s stagger between lines. Fade labels and buttons in slightly after.
Add a soft dark gradient behind text only where needed for readability (bottom gradient for the opening, left gradient for the finale).
A thin progress line on the right edge shows how far through the film the visitor is. A "Scroll" cue at the start fades out once scrolling begins.

## Mobile first (most visitors are on phones)
Design and test **phone first (390×844)**, then scale up to tablet and desktop. The phone version must feel at least as premium as desktop, never like a squeezed desktop page.
- **Film on phones:** text never covers the main subject. Opening and finale text sit at the **bottom** of the screen over a soft dark gradient; black-moment text is centred. Headlines around 10–12vw, labels at least 11px, body at least 16px.
- **Thumb-friendly:** every button and link at least 48px tall, main actions in the lower half of the screen.
- **Sticky action bar on phones:** after the film ends, a slim bar fixed to the bottom with two buttons: **Call** and **WhatsApp** (brand gradient on the primary one). It respects the iPhone home-bar safe area (`env(safe-area-inset-bottom)`). Hide it during the film.
- **Use `svh`/`dvh` units** for full-screen sections so the mobile browser's address bar doesn't cause jumps.
- **Touch:** no hover-only features. Anything that reacts to hover on desktop has a tap or scroll-based version on phones.
- **Performance on mobile data:** poster shows instantly; on slow connections or Save-Data, load every 2nd frame; images below the film are lazy-loaded.
- **Test widths:** 360, 390, 430 (phones), 768 (tablet), 1280 and 1920 (desktop), in both portrait and landscape on phones.

## Demo content (this is a sample site)
The client has not given real details yet, so the site uses realistic **sample content**:
- Phone and WhatsApp: use the obvious dummy **+91 98XXX XXXXX**, and `https://wa.me/` with no number. Never a real-looking number.
- Work photos: sample images of hoardings for **fictional brands only**, never real companies. Captions use generic areas of Raipur and plausible sizes.
- No invented client names, years in business, project counts, ratings or awards.
- Footer shows a small line in Geist Mono: "Demo website · sample content".
- Add `<meta name="robots" content="noindex, nofollow">` to every page and `Disallow: /` in robots.txt until the client approves the site. Leave a clear comment showing how to switch it to "index" later.

## Typography (direction "C · Cinema")
- **Headlines:** Instrument Serif (Google Fonts), regular. The one highlighted phrase per screen is *italic* with the brand gradient as text fill.
- **Body, buttons, links:** Geist.
- **Labels and specs:** Geist Mono, uppercase, letter-spacing ~0.08em, small.
- Headline sizes scale with the screen (`clamp()`), large and calm; line-height about 0.95; `text-wrap: balance`.
- Body text max ~34 characters per line inside the film, ~65 elsewhere.
- Only one gradient phrase per screen.

## Colours
```
--night:   #0a0810   (page background, violet-tinted black)
--panel:   #15121c
--ink:     #f3eef6   (main text)
--mute:    #a89eb2   (secondary text)
--violet:  #9b4dff
--magenta: #e8399a
--saffron: #ff8a3d
gradient:  violet → magenta → saffron (left to right)
```
Dark site only.

## Interactions
- Lenis smooth scrolling for the whole page.
- Primary button: white pill, on hover a brand-gradient fill sweeps in from left to right and the text turns white.
- Text links: an underline grows from left to right on hover.
- Visible keyboard focus everywhere.

## Sections after the film
1. **What we do:** "Design. Print. *Install.*" with three columns (Design / Print / Install), each with one short line and a Geist Mono spec line with sample sizes and materials (e.g. "Up to 40 × 20 ft", "Star flex · Vinyl · Backlit").
2. **Work:** a grid of 6 sample hoarding photos for fictional brands (assets/work/work-1.webp … work-6.webp), with short captions (area of Raipur and size).
3. **Contact:** big headline, dummy phone and WhatsApp (see Demo content), "Raipur, Chhattisgarh", a "Plan your hoarding" button.
4. **Footer:** Trinetra Creations, CEO Ashutosh Mishra, Raipur, year.

## Quality bar
- Must feel smooth on a mid-range Android phone and an iPhone.
- No horizontal scrolling at any width. Test at 390px and 1440px wide.
- Good SEO basics: title, meta description, real headings in HTML, alt text.
- Never invent facts about Trinetra (client names, numbers, years). Use clearly marked placeholders instead.
