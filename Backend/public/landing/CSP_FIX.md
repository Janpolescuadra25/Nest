# CSP Fix — Landing Page Inline Scripts

## Problem
The landing page at `qyra.space` was stuck loading after deploying the intro overlay. The page appeared blank/infinite-loading because the intro overlay never dismissed.

## Root Cause
Helmet's Content Security Policy in `Backend/src/index.ts` blocks inline `<script>` tags:

```javascript
// Backend/src/index.ts L98-109
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "https://cdn.tailwindcss.com"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
  },
}));
```

The `scriptSrc` directive does NOT include `'unsafe-inline'`, so three inline `<script>` blocks in `index.html` were blocked from executing. The intro overlay IIFE was one of these blocked scripts — it never ran, so the overlay stayed permanently visible.

## Solution
Moved all three inline `<script>` blocks into an external file `Backend/public/js/landing.js`, which already existed with partial code (mobile menu only) but was not referenced from `index.html`.

The external file is served by Express static middleware:

```javascript
// Backend/src/index.ts L110
app.use(express.static(path.join(__dirname, '../public')));
```

This serves `public/` at the root URL with no prefix, so `<script src="/js/landing.js">` resolves correctly.

The landing page route sends the HTML file:

```javascript
// Backend/src/index.ts L184
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/landing/index.html'));
});
```

## Commit
`bbd5b09`

## Files Modified
- `Backend/public/landing/index.html` — removed 3 inline `<script>` blocks, added `<script src="/js/landing.js">`
- `Backend/public/js/landing.js` — added 5 sections: IntersectionObserver, intro overlay IIFE, mobile menu, smooth scroll, signup form

## External Script Sections
| # | Section | Purpose |
|---|---|---|
| 1 | IntersectionObserver | Scroll-reveal animations on feature cards |
| 2 | Intro overlay IIFE | Dismisses the full-screen intro after 3.5s per slide (10.5s total for 3 slides) |
| 3 | Mobile menu | Hamburger menu toggle for mobile nav |
| 4 | Smooth scroll | Anchor link smooth scrolling |
| 5 | Signup form | Email validation and submission handler |

## Important Decisions
- **Did NOT add `'unsafe-inline'` to CSP** — that would weaken security for the entire application.
- **Did NOT use nonce-based CSP** — would require server-side templating for the landing page.
- **Used external script file** — simplest CSP-compliant solution, works with existing static file serving.
- **Preserved `landing.js` pre-existing code** — the file already contained the mobile menu code; new sections were appended.
