# LaundryApp · Maseno website

A responsive customer marketplace and operations application built alongside the existing Flutter app. The Flutter source is unchanged. This folder contains the React website, Express API, persistent SQLite data, Swifta adapter, operational scripts and executable journey tests.

## Run locally

Requires Node.js 20.19+ (22 LTS recommended) and npm.

```bash
cd website
npm ci
cp .env.example .env # Only if a local .env does not already exist
npm run dev
```

Open http://localhost:5173. For a production-build preview including the offline shell, stop the dev server and run `npm run build && npm run preview`. The API runs at port 4000. Match `APP_ORIGIN` to the browser URL, including hostname and port. The current preview uses simulated payments; it sends no real STK requests. Use **Explore demo accounts** to move between customer, Mama Fua, delivery rider and admin. Those accounts share the same booking data, so a booking can be followed through the whole service lifecycle. Real customer/provider/rider registration also works.

SQLite files and private uploaded images live under `data/`, which is ignored by Git. `.env` is also ignored. Never put payment secrets in frontend variables, screenshots, source code or `VITE_` environment variables.

## Customer experience

- Local Maseno service discovery, profiles, verification badges, actual completed-booking reviews, favourites and rebooking.
- Guest-first three-step booking: quick small/medium/large/duvet/blanket/shoes/custom laundry, advanced item/kg/fixed pricing, pickup, home washing, house cleaning and custom jobs with proposed budgets.
- Item counts, weight, photos, notes, hostel landmarks, saved addresses, immediate/scheduled requests and East Africa Time display.
- Server-calculated itemised estimates, configured surcharges/promos, preferred-provider matching and upfront/deposit/pay-after options.
- Durable order history, start PIN, bag tags, status timelines, ETA, optional provider location sharing, phone/WhatsApp after assignment, notifications, printable booking receipts, support and disputes.
- Weekly, fortnightly and monthly repeat requests and student packages. Packages are **pay per visit**, with the displayed package price divided across visits. They are not prepaid wallets. Each repeat request uses current pricing and requires provider acceptance. There are no automatic M-Pesa deductions; pause/resume is available in the dashboard.

## Providers, transport and admin

Individual Mama Fua, laundry businesses and cleaning companies have private verification submissions, public profile photos, categories, service areas/radius, availability, accept/decline, sequential work stages and earnings. Material profile changes require re-verification. An individual provider can handle their own collection/return; businesses can use assigned riders. Rider accounts require admin approval and vehicle details. Service commission is captured when booking, and the person handling transport earns those fees in full. Completed pickup and delivery legs remain in the original rider's earnings/history after reassignment.

Admin manages approvals, accounts, service requests, provider/rider assignment and reassignment, cancellation returns, payment/refund records, disputes, review moderation, pricing, quick loads, item prices, surcharges, commissions, promotions, areas and student packages. Cancellation before processing refunds only money actually received; collected bags retain a separate return workflow. Refund transfers and partner payouts are recorded by staff after they are performed externally; they are not automatically transferred.

## Swifta integration

`server/swifta.js` implements the supplied API contract:

```text
POST https://app.swifta.co.ke/v1/stk/push
Authorization: Bearer <server-only SWIFTA_API_KEY>
{ phone, amount, ref, metadata: { order_id, payment_id } }
```

Set `PAYMENT_ADAPTER=swifta` to make real requests. The default stays `demo` locally. `disabled` allows pay-after bookings while connecting payments. A server-issued reference and an immutable settlement ledger prevent duplicate credit. The initiation record is reserved before network I/O so early webhooks are handled. Ambiguous network failures require reconciliation instead of blindly initiating another charge.

The [official Swifta documentation](https://docs.swifta.co.ke/) describes a different legacy contract (`/stkpush`, `x-api-key`) and `/poll/:checkoutRequestId`. Set `SWIFTA_API_STYLE=legacy` if that is the app contract. The provided v1 initiation contract is implemented, but **its live response shape, status endpoint and callback contract still need verification with your Swifta app**. `SWIFTA_POLL_PATH` is configurable for this reason. Do not enable production payments before that verification.

The new website receives callbacks at `/api/swifta/webhook` and `/api/swifta/callback`. Configure its public HTTPS URL in the Swifta dashboard; the environment URL alone does not register it. Supply `SWIFTA_WEBHOOK_SECRET` and optionally `SWIFTA_APP_ID`. The implemented signed webhook contract uses HMAC-SHA256 of the exact raw JSON and `x-swifta-signature`, validates amount/phone/reference/order ownership, and ignores unrelated transactions. Unsigned success callbacks are rejected.

The supplied `parseify.online` callback URLs are retained only as reference environment settings. The website does not forward events to them or change that existing app's settings. The supplied key is kept only in the ignored local `.env`; rotate it before launch because it was shared in chat. Automated tests use dummy keys and mocked provider responses, never real charges.

## Live deployment

1. Create a dedicated persistent installation and HTTPS domain. Use one API instance on one host for this SQLite deployment; do not mount SQLite over network storage.
2. Install dependencies and build: `npm ci && npm run build`.
3. Set `NODE_ENV=production`, `DEMO_MODE=false`, `APP_ORIGIN=https://your-domain`, `DATABASE_PATH=./data/laundry.sqlite` and `UPLOAD_DIR=./data/live-uploads`. Use a **fresh live database**. Startup refuses databases containing demo accounts. Configure real Swifta credentials/contracts or choose `PAYMENT_ADAPTER=disabled`.
4. Set `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PHONE`, and a unique `ADMIN_PASSWORD` of at least 14 characters in the private environment, run `npm run admin:create`, then remove the bootstrap password from persistent environment settings. The admin role cannot be self-registered.
5. Run `npm start` under a process supervisor. It listens on `127.0.0.1:4000`, serves the built website and API, and creates due recurring requests once per minute. `deploy/laundryapp.service` and `deploy/Caddyfile` are adaptable VPS examples. Adjust paths/user/domain and `TRUST_PROXY=1` only behind that single trusted proxy.
6. Configure signed Swifta webhooks for this domain; complete a controlled approved payment/cancellation/refund check before launch. Replace the draft legal text with the actual business identity, support arrangements and data-retention terms. Set real prices and onboard genuine verified providers/riders.
7. Run `npm run db:backup` and separately back up the private upload directory and environment secrets. Backups contain personal data: restrict access, encrypt off-host copies and test a restore. Keep the whole `data/` directory persistent across updates. Use `npm run recurring:run` for an explicit scheduler invocation if needed; multiple invocations are transactionally guarded against duplicate requests.

Sessions use HttpOnly cookies, production Secure cookies, same-origin mutation checks, role/order ownership, scrypt passwords and session invalidation. Uploads are limited, re-encoded to WebP with metadata stripped, and private except approved public avatars. Provider payment/contact details are scoped. Webhook verification, rate limits, audit trails and settlement/refund ledgers are included.

## Validation and review evidence

```bash
npm run check       # TypeScript + production build + API integration tests
npm run test:e2e    # Builds, then Chrome UI journeys using an isolated demo database
npm audit --omit=dev
```

Browser tests use `/usr/bin/google-chrome` when available; set `CHROME_PATH` for another Chromium executable or install the Playwright browser with `npx playwright install chromium`. They run against built assets on port 5174 and an isolated API on 4100; the user's preview database and payment credentials are not used. API tests use temporary databases and dummy payment secrets.

See [the review report](docs/review-report.md) for review iterations and results, [feature parity](docs/flutter-parity.md) for the Flutter baseline mapping, and `docs/screenshots/` for rendered evidence. Generated photography is optimised under `public/images/`; the exact generation prompts are in `docs/image-prompts.json`, and full-resolution originals are in the repository's `generated-assets/` folder. DM Sans is self-hosted with its OFL license.

## Practical limits

Live Swifta interoperability and public deployment are not yet verified. No automated refunds/payouts, live GPS, SMS/email delivery, OTP, password recovery or native offline booking are implemented. In-app notifications refresh while the page is open; the website requires connectivity for current quotes and transactions. The built website caches public application assets and previously viewed, user-scoped booking/history information in this browser tab for up to 24 hours. Cached views are labelled offline, and mutations/payments still require connectivity. Changing accounts or signing out clears private cached views. Session booking drafts survive navigation/reload, with explicit connection errors and retries. SQLite provides durable server storage rather than the APK's on-device SQLite. Generated people and preview provider profiles are clearly marked as sample content; live providers/reviews must come from onboarding and completed bookings. Policies remain launch drafts until business details are supplied.
