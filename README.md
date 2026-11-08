# Trinetra v2

A one-page website for **Trinetra Creations**, a hoarding and flex-printing company in Raipur.
As you scroll, a short film plays: a blank sheet is printed, carried out, installed and lit up as a giant city hoarding. After the film come short sections (What we do, How it works, Why Trinetra, FAQ, Work, Contact).

This is a **demo for the client** with sample content (dummy phone number, sample projects). Search engines are blocked until the client approves (see `robots.txt`).

Built with plain HTML, CSS and JavaScript. The only library is [Lenis](https://github.com/darkroomengineering/lenis) for smooth scrolling, loaded from a CDN.

## Run it locally

1. Open this folder in **VS Code**.
2. Install the **Live Server** extension (by Ritwick Dey) if you don't have it.
3. Right-click `index.html` → **Open with Live Server**.

Don't double-click `index.html`: the film frames are loaded by JavaScript, which needs a local server.
(`404.html` loads its styles from the live site, so it only looks right once deployed.)

## Folder structure

```
index.html            the page
404.html              "page not found" page (GitHub Pages uses it automatically)
css/style.css         all styles (phone first, then bigger screens)
js/film.js            the scroll film: canvas, frames, timed text
js/main.js            everything else: smooth scroll, header, reveals, carousel
assets/
  frames/desktop/     1,189 film frames for wide screens (1280×720)
  frames/portrait/    1,189 film frames for phones (405×720)
  poster.webp         first frame, shown while the film loads
  logo.png            full logo
  logo-mark.png       small eye mark for the header
  og-image.jpg        share image for WhatsApp, LinkedIn, etc.
  icons/              favicon and app icons
  work/               work photos (work-1.webp … work-6.webp) go here
robots.txt            blocks search engines during the demo
sitemap.xml           page list for search engines
site.webmanifest      app name, colours and icons for phones
```

## Before going live for real

- Replace `+91 98XXX XXXXX` and the `https://wa.me/` links with the real number (search for `DEMO:` in `index.html`).
- Add real work photos to `assets/work/` (instructions in the Work section of `index.html`).
- Switch on search engines: follow the steps at the top of `robots.txt`.
