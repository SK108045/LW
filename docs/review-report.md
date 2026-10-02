# Implementation and product review

Reviewed locally on 1 October 2026. The website was implemented, run in real Chromium, visually inspected, corrected and rerun across three deliberate review passes, with further fixes when the final walkthrough exposed issues. Screenshots are rendered browser captures, not design mockups.

## Implemented

Customer, individual Mama Fua, laundry-business, cleaning-company, rider and admin workflows; a Maseno landing page with six generated local service photographs; real accounts; server-owned estimates; quick/advanced laundry, home washing, cleaning and custom-budget jobs; photos and saved addresses; scheduled and repeat bookings/packages; start PIN, bag handling, sequential timelines, contact fallback, receipts, reviews, favourites, rebooking, notifications, disputes, approval and assignment tools, configurable pricing, earnings and durable SQLite records.

Swifta initiation/status/webhook integration is modular and server-only. The current preview simulates payments. Signed callbacks, early-callback races, unique settlements, reconciliation protection and refund accounting are implemented and tested with dummy credentials. Production defaults refuse demo data and require proper payment configuration. Operational launch and backup instructions are provided in the README.

## Pass 1 — Functionality

**Found:** early webhooks could race initiation; replayed payment events could credit twice; late balances could distort processed refunds; collected bags needed a separate cancellation return; a delivered job could not advance to completion; original pickup-rider earnings/history could disappear after a different delivery rider took over; self transport and staff privacy required explicit handling; logout could hang; profile changes and repeated plans had verification/accounting gaps.

**Changed and reran:** reserve payment records before network I/O, record immutable unique settlements, separate pending versus already-processed refunds, retain transport legs, support cancellation returns and individual-provider transport, fix completion/logout, scope contacts/payment details/PINs, re-review material provider changes, bind package discounts to their actual repeat schedule, keep a single subscription record and synchronise pause/resume. Idempotency is scoped to customer plus request fingerprint. Admin cannot double assign a rider or remove the last rider from a trip already underway. Agreed commission is captured at booking; transport fees remain with the person doing the trip, including self transport and prior assignment history.

**Evidence:** API integration tests, full laundry and home lifecycles, browser customer/provider/rider/admin journeys, tracking and earnings screenshots.

## Pass 2 — UI and UX

**Found:** the preview account selector obscured content; the mobile estimate retained a desktop sticky offset and overlapped controls; a full estimate dominated small screens; teaser prices made transport charges too easy to miss; a hero badge overlapped its delivery sticker; the join portrait crop cut the face; narrow tablet typography and repetitive long mobile sections weakened the landing flow.

**Changed and re-inspected:** move demo access to the top strip and use a role dialog, compact the mobile estimate with optional fee details, clear the inherited sticky offset, include pickup/return in homepage quick prices, simplify mobile service/how-it-works sections, give providers useful indicative rates and scrollable comparison cards, remove the overlapping badge, adjust portrait/hero crops and tablet headlines, consolidate package benefits, increase useful labels and maintain consistent controls. Admin tables include a sideways-scroll hint on phones; mobile dashboards prioritise useful bookings and shortcuts over an oversized promotional image. The final mobile screenshot also exposed a missing space when a desktop line break was hidden; that text was corrected and visually rechecked.

**Evidence:** home and booking screenshots at 360, 390, 430, 768, 1366 and 1440 pixels; all four operational dashboards at 360, 768, 1366 and 1536 pixels. No page-wide horizontal overflow was detected. Native scroll areas intentionally retain horizontal scrolling for tables/tabs.

## Pass 3 — First-time product review

**Walked through:** a new Maseno customer discovers a Mama Fua, chooses home washing without an account, selects tomorrow's visit in East Africa Time, adds an address/photo, registers at checkout, pays a deposit, loses the booking-confirmation response, retries, reloads offline, reconnects, completes the PIN-based home service, pays the balance, saves the provider and signs out.

**Found and fixed:** implicit form labels included unrelated option/help text; provider verification used the booking's “Booking received” label; controlled availability bounced while waiting for the API; the payment close button left `?pay=true` in the URL; a completed deposit stayed in the next balance-payment dialog; changing modal callbacks reset focus while typing; service links could leave an old booking selection mounted; a local environment flag produced development React in a production build; offline reload needed a real cached public shell and clearly-labelled private views; private photos should show a reconnect notice instead of broken images offline.

**Changed and reran:** explicit labels and descriptions, contextual verification badges, optimistic availability with rollback, shared payment-close cleanup, stable modal focus handling, query-keyed booking forms, enforced production-mode build, a public-only service worker and user-scoped tab cache with account-change/sign-out cleanup. Offline writes/payments are blocked; draft and previously viewed booking information remain available. A lost response followed by retry produced exactly one booking and one saved address/photo set. Completed-job empty states now point customers to history and receipts.

## Final validation

| Check | Result |
|---|---|
| TypeScript and optimised production build (`npm run check`) | Passed |
| API integration suites | 11 passed |
| Actual-browser journeys (`npm run test:e2e`) | 7 passed; the first-time product and responsive role-dashboard journeys passed again after final fixes |
| Customer → payment → pickup → laundry stages → delivery → review → rebook | Passed through UI |
| Business registration → document upload → admin approval → online → request → processing → earnings | Passed through UI |
| Custom-budget job → dispute → admin reply; student plan → repeat/pause | Passed through UI |
| New real account → scheduled home washing → photos → deposit → PIN → completed → balance | Passed through UI |
| Lost confirmation → idempotent retry; offline reload → reconnect; modal keyboard typing | Passed through UI |
| Different transport riders, self transport, commission changes, cancellation returns and late refunds | Passed through API |
| Signed Swifta contract, invalid signature, replay and early callback | Passed with mocked provider responses; no real charge |
| Production refusing demo data; empty fresh live database | Passed |
| Responsive widths | 360, 390, 430, 768, 1366, 1440, 1536 |
| Unexpected uncaught page errors | None in passing browser journeys |
| Production dependency audit | 0 reported vulnerabilities after updating Sharp |
| Provided payment key in public/source/build files | No matches; key remains only in ignored `.env` with mode 0600 |
| Existing Flutter source/configuration | Unchanged |

The controlled slow-network check used a fresh 390px Chrome context, 4x CPU slowdown, 180ms network latency, approximately 1Mbps download and 512kbps upload. Home content became ready in **2.6 seconds** and navigation to a usable booking estimate in **1.0 second**. This is an emulator result, not a physical Android benchmark. The raw measurement is in `slow-network-check.json`. All optimised generated image assets together are approximately 480 KiB; fonts are self-hosted and routes are lazy-loaded.

The local production-build preview is available at http://127.0.0.1:5173. Use **Explore demo accounts** in the top strip to try the complete team. The preview's data and payments are explicitly demonstration data; automated browser tests use a different database and ports.

## Remaining launch work and limits

- Deploy to a public HTTPS domain, create a fresh live database/admin, onboard real verified providers/riders, and configure actual operational prices and support arrangements.
- Confirm the supplied Swifta v1 response/status/callback contract with the Swifta app, add its webhook secret, register this website's callback URL, and complete an approved live payment/refund check. Existing Parseify callback URLs were left unchanged and are only retained as reference settings. Rotate the key shared in chat before launch.
- Refund transfers and partner payouts are manual; the application records their references and separates earnings from customer receipts. Packages are pay per visit, with no automatic debits or prepaid-wallet entitlement accounting.
- No live GPS, SMS/email push, phone/email OTP or self-service password recovery. In-app notifications refresh while the website is open. Offline mode supports previously viewed data and drafts; current estimates, bookings, payments and operational changes need connectivity.
- Publish final business/legal/privacy/retention details in place of the explicitly marked launch draft. Generated people and preview provider profiles are sample content. Real reviews require completed bookings.
- This installation uses one host and SQLite. Persist and back up both the database and private uploads; test restore and use a different database architecture if scaling across hosts.
