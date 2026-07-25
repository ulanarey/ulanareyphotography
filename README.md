# ulanareyphotography.com

Travel photography portfolio of **Ulana Rey, PharmD** — coastlines, cities, and
mountains photographed around the world, from Kauai to Prague.

Live site: https://ulanareyphotography.com

## Stack

Static site — no build step, no dependencies to install.

- Hand-written HTML, CSS, and vanilla JavaScript (ES modules)
- A scroll-driven photo reel rendered with [Three.js](https://threejs.org/) (loaded via CDN),
  with a plain sticky-image fallback for reduced-motion and no-WebGL visitors
- Hosted on GitHub Pages

## Structure

```
index.html            # single-page site
css/main.css
js/main.js             # builds the reel + collections, drives the WebGL transition
images/full/           # photographs (slug.webp + slug.jpg pairs)
images/manifest.json   # single source of truth for photos, order, and captions
CNAME · robots.txt · sitemap.xml · llms.txt
```

## Maintaining the photos

The reel and collections are driven entirely by `images/manifest.json`. To add or
swap a photo: drop `slug.webp` + `slug.jpg` (max 2400px long edge) into
`images/full/`, add or edit its manifest entry (slug, title, region, accent color,
alt text), and commit. Nothing else needs to change.

---

© Ulana Rey. All photographs by Ulana Rey. All rights reserved.
