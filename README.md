
# 🪹 Nest — Toast POS → QuickBooks Sync

> Bridge between Toast POS and QuickBooks Online. Scan sales reports, map fields to journal entries, and sync seamlessly.

Created by **John Paul O. Escuadra** · Made with ❤️ in the Philippines

---

## What It Does

Nest is a Chrome extension + backend that automates the daily journal entry process for restaurants using Toast POS and QuickBooks Online:

1. **Scan** — Reads the Toast Sales Summary page (17 sections, 100+ fields)
2. **Map** — Links each Toast field to a QuickBooks account with Debit/Credit posting
3. **Preview** — Shows the journal entry with auto-balance, consolidation, and entity assignment
4. **Sync** — Creates the journal entry directly in QuickBooks Online

---

## Architecture

```
┌─────────────────────┐       ┌─────────────────────┐       ┌──────────────────┐
│  Toast POS Page      │       │  Nest Backend        │       │  QuickBooks API  │
│  (Sales Summary)     │       │  (Express + Prisma)  │       │  (OAuth 2.0)     │
│                      │       │                      │       │                  │
│  scanner.ts ─────────┼──►   │  /api/scans          │       │                  │
│  (content script)    │       │  /api/mappings       │       │                  │
│                      │       │  /api/quickbooks/*   │──────►│  JournalEntry    │
└─────────────────────┘       │  /api/auth/*         │       │  Account, Class  │
                              │  /api/locations       │       │  Vendor, etc.    │
┌─────────────────────┐       │                      │       └──────────────────┘
│  Chrome Extension    │       │  PostgreSQL          │
│  (Popup + Service    │──────►│  (Render hosted)     │
│   Worker)            │       └─────────────────────┘
└─────────────────────┘
```

---

## Project Structure

```
Nest/
├── Backend/                  # Express API server
│   ├── prisma/
│   │   ├── schema.prisma     # Database schema (PostgreSQL)
│   │   └── seed.ts           # Admin user seeder
│   ├── src/
│   │   ├── index.ts          # Express server entry point
│   │   ├── middleware/       # JWT auth middleware
│   │   ├── routes/           # API route handlers
│   │   │   ├── auth.ts       # Login, signup, password reset
│   │   │   ├── quickbooks.ts # QB OAuth, JE creation, list sync
│   │   │   ├── locations.ts  # Multi-location management
│   │   │   ├── mappings.ts   # Field → account mappings CRUD
│   │   │   ├── rules.ts      # Rules engine CRUD
│   │   │   ├── scans.ts      # Scan record storage
│   │   │   ├── admin.ts      # Admin dashboard APIs
│   │   │   └── password.ts   # Password reset flow
│   │   ├── services/
│   │   │   └── qb.service.ts # QB API calls (JE, accounts, token refresh)
│   │   └── types/
│   │       └── index.ts      # Shared TypeScript types
│   ├── .env.production.example
│   └── package.json
│
├── Frontend/                 # Chrome Extension (Manifest V3)
│   ├── manifest.json         # Extension config
│   ├── src/
│   │   ├── background/
│   │   │   └── service-worker.ts  # Floating window, scan save, QB auth
│   │   ├── content/
│   │   │   └── scanner.ts        # DOM scraper for Toast pages
│   │   ├── popup/
│   │   │   ├── App.tsx            # Main app with tab navigation
│   │   │   ├── components/
│   │   │   │   ├── ScanView.tsx           # Scan tab
│   │   │   │   ├── MappingView.tsx        # Mapping tab
│   │   │   │   ├── JournalEntryPreview.tsx # Preview & sync tab
│   │   │   │   ├── QBDataView.tsx         # QB data browser
│   │   │   │   ├── SyncView.tsx           # Sync history
│   │   │   │   ├── SettingsView.tsx       # QB connect, locations
│   │   │   │   ├── HelpPanel.tsx          # Help & guide overlay
│   │   │   │   ├── SearchableSelect.tsx   # Dropdown with search
│   │   │   │   ├── SmartDatePicker.tsx    # Date picker
│   │   │   │   ├── LoginView.tsx          # Login/signup
│   │   │   │   └── AdminDashboard.tsx     # Admin panel
│   │   │   ├── hooks/              # useAuth, useLocations, useQuickBooks
│   │   │   ├── contexts/           # QBContext (shared QB lists)
│   │   │   ├── lib/
│   │   │   │   └── api.ts          # Backend API client
│   │   │   └── types/
│   │   │       └── qb.ts           # QB entity types
│   │   └── types/
│   │       └── index.ts            # Shared types (Mapping, ScanData, etc.)
│   └── package.json
│
├── docs/                     # Development prompts & documentation
└── render.yaml               # Render deployment config
```

---

## Quick Start

### Prerequisites

- **Node.js** 18+
- **PostgreSQL** database (local or hosted)
- **Intuit Developer** account with a QuickBooks app ([developer.intuit.com](https://developer.intuit.com))
- **Google Chrome** (for the extension)

### 1. Backend Setup

```bash
cd Backend

# Install dependencies
npm install

# Set up environment variables
cp .env.production.example .env
# Edit .env with your actual values (see Environment Variables below)

# Generate Prisma client & push schema
npx prisma generate
npx prisma db push

# Seed the admin user
npm run prisma:seed

# Start the dev server
npm run dev
```

### 2. Frontend (Chrome Extension) Setup

```bash
cd Frontend

# Install dependencies
npm install

# Build the extension
npm run build
```

### 3. Load the Extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `Frontend` folder
5. The 🪹 Nest icon appears in your toolbar

### 4. First-Time Use

1. Click the Nest icon — a floating window opens
2. Log in with your admin credentials (from the seed)
3. Go to **Settings** → Connect QuickBooks
4. Navigate to a Toast Sales Summary page
5. Click **Scan** → **Mapping** → **Preview** → **Sync**

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/nest` |
| `JWT_SECRET` | Secret for JWT tokens (min 32 chars) | `your-long-random-string` |
| `JWT_EXPIRES_IN` | JWT token expiry | `7d` |
| `QB_CLIENT_ID` | Intuit app client ID | From Intuit Developer portal |
| `QB_CLIENT_SECRET` | Intuit app client secret | From Intuit Developer portal |
| `QB_REDIRECT_URI` | OAuth callback URL | `https://your-backend.onrender.com/api/quickbooks/callback` |
| `QB_AUTH_URL` | Intuit OAuth authorize URL | `https://appcenter.intuit.com/connect/oauth2` |
| `QB_TOKEN_URL` | Intuit token exchange URL | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` |
| `QB_API_BASE_URL` | QB API base URL | `https://quickbooks.api.intuit.com/v3/company` (production) or `https://sandbox-quickbooks.api.intuit.com/v3/company` (sandbox) |
| `QB_ENVIRONMENT` | `production` or `development` | `production` |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `production` |

---

## Scanner — 17 Toast Sections

The content script extracts data from these Toast Sales Summary sections using `data-testid` selectors:

| # | Section | Type | Selector Pattern |
|---|---------|------|------------------|
| 1 | Revenue Summary | Key-Value | `revenue-summary-table-body` |
| 2 | Net Sales Summary | Key-Value | `net-sales-summary-table-body` |
| 3 | Tip Summary | Key-Value | `tip-summary-table-body` |
| 4 | Cash Activity | Key-Value | `cash-activity-table-body` |
| 5 | Cash Summary | Key-Value | `cash-summary-table-body` |
| 6 | Unpaid Orders | Key-Value | `unpaid-orders-summary-data-table-body` |
| 7 | Void Summary | Key-Value | `void-summary-table-body` |
| 8 | Payments Summary | Multi-Column | `payments-summary-table-*` |
| 9 | Sales Category | Multi-Column | `sales-categories-data-table-*` |
| 10 | Tax Summary | Multi-Column | `tax-summary-data-table-*` |
| 11 | Discount | Multi-Column | `discount-data-table-*` |
| 12 | Service Charge | Multi-Column | `service-charge-data-table-*` |
| 13 | Revenue Center | Multi-Column | `RevenueTable-data-table-*` |
| 14 | Service Daypart | Multi-Column | `Services-data-table-*` |
| 15 | Dining Options | Multi-Column | `dining-options-data-table-*` |
| 16 | Service Mode | Multi-Column | `service-mode-summary-data-table-*` |
| 17 | Deferred | Multi-Column | `Deferred-data-table-*` |

---

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Email/password login |
| POST | `/api/auth/request-access` | Request account |
| POST | `/api/auth/forgot-password` | Password reset request |

### Locations
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/locations` | List user's locations |
| POST | `/api/locations` | Create location |
| PUT | `/api/locations/:id` | Update location |
| DELETE | `/api/locations/:id` | Delete location |

### Mappings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/locations/:id/mappings` | List mappings for location |
| POST | `/api/locations/:id/mappings` | Create mapping |
| PUT | `/api/mappings/:id` | Update mapping |
| DELETE | `/api/mappings/:id` | Delete mapping |

### QuickBooks
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/quickbooks/auth-url` | Get OAuth authorization URL |
| GET | `/api/quickbooks/callback` | OAuth callback (browser redirect) |
| GET | `/api/quickbooks/status` | Check QB connection status |
| POST | `/api/quickbooks/journal-entry` | Create journal entry in QB |
| GET | `/api/quickbooks/accounts` | Fetch QB accounts |
| GET | `/api/quickbooks/classes` | Fetch QB classes |
| GET | `/api/quickbooks/employees` | Fetch QB employees |
| GET | `/api/quickbooks/vendors` | Fetch QB vendors |
| GET | `/api/quickbooks/customers` | Fetch QB customers |
| GET | `/api/quickbooks/tax-codes` | Fetch QB tax codes |
| GET | `/api/quickbooks/sync-all` | Sync all QB lists at once |

### Scans
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scans` | Save scan data |
| GET | `/api/locations/:id/scans` | List scans for location |

### Admin
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/requests` | List access requests |
| POST | `/api/admin/requests/:id/approve` | Approve request |
| POST | `/api/admin/requests/:id/reject` | Reject request |
| GET | `/api/admin/users` | List all users |
| DELETE | `/api/admin/users/:id` | Delete user |

---

## Deployment (Render)

The `render.yaml` file configures automatic deployment:

1. Push to your GitHub repo
2. Connect the repo to [Render](https://render.com)
3. Render auto-detects `render.yaml` and deploys the backend
4. Set `DATABASE_URL` and `JWT_SECRET` as secret env vars in Render dashboard
5. Update `QB_REDIRECT_URI` to match your Render URL
6. Update the `BASE_URL` in `Frontend/src/popup/lib/api.ts` and `Frontend/src/background/service-worker.ts` to match

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | Chrome Manifest V3, React 18, TypeScript, Tailwind CSS |
| Build | esbuild (extension), tsc (backend) |
| Backend | Express, Prisma ORM, TypeScript |
| Database | PostgreSQL |
| Auth | JWT (email/password), Intuit OAuth 2.0 |
| Hosting | Render (free tier) |
| Email | Resend (password reset, access requests) |

---

## License

Private project — all rights reserved.

---

## Contact

For technical support, bugs, or feature requests:

✉️ paulescuadra25@gmail.com

Created by **John Paul O. Escuadra**
