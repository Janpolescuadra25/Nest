# Qyra — Chrome Web Store Listing

## Extension Name
Qyra — Financial Automation

## Brief Description (132 chars max)
Scan POS reports & invoices, extract transactions with AI, and sync to QuickBooks Online automatically.

## Detailed Description
Qyra simplifies restaurant bookkeeping by turning POS reports, invoices, and bill payments into accurate QuickBooks transactions. Install the extension, connect your QuickBooks account, and let Qyra handle the hard work with AI-driven extraction.

With support for multiple POS platforms like Toast Tab, SALIDO, and Oracle Restaurants, Qyra scans browser-based reports, PDF invoices, and Excel exports. It extracts transaction details, maps them to the right accounts, and prepares data for a fast review.

The workflow is built for speed and accuracy: install the extension, connect QuickBooks, scan the current POS page or upload files, review the extracted entries, and sync them automatically. The result is smoother bookkeeping with less manual data entry.

Qyra is ideal for restaurant owners, accountants, and bookkeepers managing multi-location POS data. It helps teams maintain clean financial records while speeding up the scan-to-sync process.

## Categories
- Productivity
- Finance

## Language
English

## Required Permissions Justification
- activeTab: Needed to scan the current page when the user activates Qyra from the extension popup.
- storage: Stores user session data, preferences, and QuickBooks connection tokens locally.
- tabs: Required to access tab URLs for POS platform detection and content script injection.
- scripting: Injects POS-specific scanner scripts into supported restaurant platform pages.
- windows: Opens the Qyra management dashboard in a new tab for configuration and review.

- localhost:3000 — Local development server.
- *.onrender.com — Qyra backend API server.
- *.toasttab.com — Toast Tab POS platform scanning.
- *.salido.com — Salido POS platform scanning.
- *.oraclerestaurants.com — Oracle Restaurants POS platform scanning.
- appcenter.intuit.com — QuickBooks OAuth authentication.
- oauth.platform.intuit.com — QuickBooks OAuth authentication.
- sandbox-quickbooks.api.intuit.com — QuickBooks API connectivity.

Conclusion: `<all_urls>` is currently present for web accessible resources and broad script injection support. It is likely broader than needed for the targeted POS domains; the current codebase uses content scripts and script injection only for Toast, SALIDO, and Oracle URLs, so `<all_urls>` may be removable with careful validation.

## Screenshot Requirements Checklist
The following screenshots are needed for the store listing (user must capture these manually):
- [ ] Screenshot 1: Extension popup showing the main dashboard/scanning view (1280x800 or 640x400)
- [ ] Screenshot 2: Welcome overlay with Qyra logo and fade-in animation (1280x800 or 640x400)
- [ ] Screenshot 3: Scanning flow — POS report being scanned with results (1280x800 or 640x400)
- [ ] Screenshot 4: QuickBooks sync confirmation/status view (1280x800 or 640x400)

## Pre-Submission Checklist
- [ ] `<all_urls>` host permission decision made (remove or justify)
- [ ] All screenshots captured
- [ ] Fresh production build validated (`npm run build` completes cleanly)
- [ ] Extension loads in Chrome without errors
- [ ] Chrome Web Store developer account created
- [ ] $5 one-time developer registration fee paid
- [ ] Privacy policy URL provided (required if extension requests host permissions)
