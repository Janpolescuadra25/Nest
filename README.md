# Qyra

> Seamless POS to QuickBooks sync, right from your browser.

Qyra is a Chrome extension that bridges point-of-sale systems with QuickBooks Online. Scan receipts, invoices, and spreadsheets — map them to the right QuickBooks fields using configurable templates — and sync transactions in seconds.

## Features

### Transaction Sync
- **5 transaction types**: Journal Entries, Bills, Vendor Credits, Cheques, and Bill Payments
- **Batch sync**: Sync multiple transactions at once with per-item error handling (synced / skipped / failed)
- **Duplicate detection**: Automatic dedup with configurable rules and force-sync override
- **Retry**: Retry failed syncs individually or in bulk from the sync log
- **Sync log**: Full history of all sync attempts with status tracking

### Scan and Capture
- **POS text**: Paste or scrape text output from POS terminal screens
- **Image OCR**: Upload receipt or invoice photos, parsed via Google Gemini AI
- **Excel import**: Upload .xlsx files with transaction data, auto-parsed into scan records

### Template System
- **Per-type templates**: Create export templates for each transaction type (Journal Entry, Bill, Vendor Credit, Cheque)
- **Column mapping**: Map POS data columns to QuickBooks fields with a visual mapping editor
- **Default values**: Set default vendor, account, department, payment terms, and more per template
- **Template wizard**: Create templates from a live scan preview
- **Active/inactive management**: Enable or disable templates without deleting them

### Product Intelligence
- **Fuzzy matching**: Automatically match product names using configurable rules (contains, starts with, exact, regex)
- **Auto-suggest mappings**: Product matches suggest column mappings with confidence scoring
- **Unmatched panel**: Review and manually handle unmatched products

### Team and Access
- **Role hierarchy**: Owner (full access) and Admin (location-scoped access)
- **Invite-based onboarding**: Send invite links to add team members without sharing passwords
- **Multi-location**: Each admin manages their assigned business locations
- **Email verification**: Verify email addresses during signup
- **Password reset**: Secure password reset flow via email

### Billing
- **Stripe integration**: Checkout sessions and webhook-powered event handling
- **Multiple plans**: Tiered pricing with configurable plan IDs

## Architecture

```
                    +-------------------+
                    |   Business POS  |
                    |                   |
                    |   Receipts        |
                    |   Invoices        |
                    |   Excel Exports   |
                    +--------+----------+
                             |
                             v
              +------------------------------+
              |    Qyra Chrome Extension     |
              |                              |
              |  Scan Modes:                 |
              |    - POS text scraping        |
              |    - Image OCR (Gemini AI)    |
              |    - Excel file upload        |
              |                              |
              |  Template Engine:            |
              |    - Column-to-field mapping  |
              |    - Default values per type  |
              |    - Active/inactive mgmt     |
              |                              |
              |  Sync Operations:            |
              |    - Single and batch sync    |
              |    - Duplicate detection      |
              |    - Retry failed items       |
              |    - Force-sync override      |
              +--------------+---------------+
                             |
                             v
              +------------------------------+
              |       Qyra Backend API       |
              |     (Express + Prisma)       |
              |                              |
              |  Transaction Types:          |
              |    Journal Entry | Bill      |
              |    Vendor Credit | Cheque    |
              |    Bill Payment              |
              |                              |
              |  Platform:                   |
              |    Team and location mgmt    |
              |    Stripe subscriptions      |
              |    Email verification        |
              |    Product matching (fuzzy)  |
              +--------------+---------------+
                             |
                             v
                   +------------------+
                   | QuickBooks Online |
                   +------------------+
```

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- A QuickBooks Online developer account (sandbox or production)
- A Google AI Studio API key (for image OCR)
- A Stripe account (for subscription billing)
- A Resend account (for transactional emails)
- Google Chrome (for loading the extension)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Janpolescuadra25/Nest.git
cd Nest
```

2. Install backend dependencies:
```bash
cd Backend
npm install
```

3. Install frontend dependencies:
```bash
cd ../Frontend
npm install
```

4. Set up the database:
```bash
cd Backend
npx prisma migrate deploy
npx prisma db seed
```

5. Configure environment variables (see Environment Variables section below)

6. Start the backend:
```bash
cd Backend
npm run dev
```

7. Build and load the Chrome extension:
```bash
cd Frontend
npm run build
```
Then go to `chrome://extensions`, enable Developer Mode, and load the `Frontend/dist` directory as an unpacked extension.

## Environment Variables

Copy `.env.example` and `.env.production.example` from `Backend/` and fill in the values.

### QuickBooks
| Variable | Description |
|----------|-------------|
| `QB_CLIENT_ID` | QuickBooks app client ID |
| `QB_CLIENT_SECRET` | QuickBooks app client secret |
| `QB_REDIRECT_URI` | OAuth callback URL |
| `QB_ENVIRONMENT` | `sandbox` or `production` |

### Database and Auth
| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `ENCRYPTION_KEY` | Encryption key for QB OAuth tokens |

### Application
| Variable | Description |
|----------|-------------|
| `APP_URL` | Backend base URL (for email links and redirects) |
| `FRONTEND_URL` | Frontend URL (CORS allowed origin) |
| `ALLOWED_EXTENSION_ID` | Chrome extension ID for auth |
| `GEMINI_API_KEY` | Google Gemini API key (OCR) |
| `RESEND_API_KEY` | Resend API key (emails) |
| `RESEND_FROM_ADDRESS` | Sender email address |
| `PORT` | Backend port (default: 5000) |

### Stripe
| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_*_PRICE_ID` | Price IDs for each plan tier (4 plans) |

### Initial Seed
| Variable | Description |
|----------|-------------|
| `OWNER_EMAIL` | Initial owner account email |
| `OWNER_PASSWORD` | Initial owner account password |
| `OWNER_NAME` | Initial owner display name |

## Project Structure

```
Nest/
├── Backend/
│   ├── src/
│   │   ├── routes/            # API route handlers (auth, owner, admin, scans, quickbooks, etc.)
│   │   ├── lib/               # Shared utilities (errors, prisma client, email, encryption, stripe)
│   │   ├── middleware/        # Auth, rate limiting, role validation, audit logging
│   │   ├── services/          # Business logic (QuickBooks service, etc.)
│   │   └── utils/             # Helper functions (invite utils, etc.)
│   ├── prisma/
│   │   ├── schema.prisma      # Database schema (User, Location, ScanRecord, SyncLog, Template, etc.)
│   │   └── migrations/        # Database migrations (21 migrations)
│   ├── tests/                 # Backend tests
│   └── .env.example           # Environment variable template
├── Frontend/
│   ├── src/
│   │   ├── popup/             # Extension popup UI
│   │   │   ├── components/    # React components (SyncView, MappingView, ScanView, etc.)
│   │   │   ├── lib/           # Utilities (API client, payload builders, mapping utils)
│   │   │   ├── hooks/         # Custom React hooks
│   │   │   └── contexts/      # React contexts (QuickBooks connection, etc.)
│   │   ├── types/             # TypeScript type definitions (index.ts, qb.ts)
│   │   └── background/        # Service worker
│   └── dist/                  # Built extension (loaded in Chrome)
├── docs/                      # Documentation
└── render.yaml                # Root Render config
```

## Tech Stack

### Backend
- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **ORM**: Prisma (PostgreSQL)
- **QuickBooks**: Intuit QuickBooks Node.js SDK
- **AI / OCR**: Google Generative AI (Gemini)
- **Payments**: Stripe
- **Email**: Resend
- **Excel**: xlsx (SheetJS)
- **Validation**: Zod
- **Security**: Helmet, express-rate-limit, bcryptjs
- **File Upload**: Multer
- **Math**: mathjs

### Frontend (Chrome Extension)
- **UI**: React 18 + TypeScript
- **Styling**: Tailwind CSS
- **Build**: esbuild
- **Testing**: Vitest

## Deployment

Qyra is configured for deployment on [Render.com](https://render.com):

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Set the environment variables listed above in the Render dashboard
4. The `render.yaml` configuration handles build commands, start commands, and environment variable keys

The backend automatically runs `prisma migrate deploy` on each deploy to keep the database schema in sync.

## License

Private repository. All rights reserved.

