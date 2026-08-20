# Particle + Line Constellation Animation

## Overview
Canvas 2D particle system with connecting lines, rendered behind the hero section of the Qyra landing page. Particles drift slowly, and lines are drawn between nearby particles to create a constellation effect.

## Commit
`1b2e061`

## Files Modified
- `Backend/public/landing/index.html` (and `web/index.html`)
- `Backend/public/js/landing.js` (and `web/js/landing.js`)

## Implementation Details

### HTML Changes
- **L123**: Hero `<section>` has `relative z-0` added to its class, creating a real stacking context so the canvas stays behind non-positioned hero content.
- **L124**: A `<canvas id="particle-canvas">` element is inserted as the first child of the hero section:
  ```html
  <canvas id="particle-canvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1"></canvas>
  ```

### JavaScript Changes
- **Section 6** of `landing.js` (L136 in Backend, L139 in web) — approximately 110 lines.
- Wrapped in an IIFE to avoid polluting the global scope.
- Uses the Canvas 2D API only (no libraries).

### Configuration
| Parameter | Value |
|---|---|
| Particle count (desktop) | 60 |
| Particle count (mobile) | 30 |
| Connection distance | 120px |
| Particle color | Emerald palette (various shades) |
| Particle size | 1.5–2.5px radius |
| Line opacity | Scales with distance (closer = more opaque) |

### Performance Features
- **HiDPI support**: Canvas resolution is scaled by `devicePixelRatio` for crisp rendering on Retina/HiDPI displays.
- **IntersectionObserver pausing**: Animation pauses when the hero section scrolls out of the viewport.
- **visibilitychange pausing**: Animation pauses when the browser tab is hidden.
- **Debounced resize**: Window resize events are debounced to avoid excessive canvas resizes.

### Dual Deployment
Both `Backend/public/landing/` and `web/` are kept in sync. Known differences:
- Logo path: `web/` uses `icons/qyra-logo.png`
- Script src: `web/` uses `js/landing.js` (no `/js/` prefix)
- `web/js/landing.js` L5: `var API_BASE = 'https://nest-backend-mddn.onrender.com';`

### CSS Stacking Context
The hero section uses `relative z-0` to create a real stacking context. The canvas uses `z-index: -1`. Per CSS 2.1 Appendix E painting order, this places the canvas:
- Above the hero's background (painted in step 4)
- Below the hero's non-positioned content (painted in step 8)
