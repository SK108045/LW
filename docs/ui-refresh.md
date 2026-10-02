# Visual and motion refresh — 2 October 2026

The website now uses a forest-green and cream palette, lime accents, a larger photographic hero, a serif headline accent, rounded controls, stronger service cards and a dark footer. Shared styling carries through providers, plans, booking and operational dashboards.

Motion is implemented with CSS and the browser's Web Animations API, without another dependency. It includes staggered hero entrances, one-time scroll reveals, hover/touch feedback, menu and modal entrances, booking-step transitions, selection feedback and an animated FAQ. The floating delivery card stops after two cycles. Reduced-motion preferences disable the effects; scroll content remains visible even without animation support.

Three checks informed the final result:

1. Implemented the visual direction and inspected desktop, tablet and phone browser captures. Adjusted the tablet heading spacing and the custom basket control.
2. Ran all eight browser journeys. Fixed featured-plan contrast and improved the booking estimate's due-now row after reviewing secondary pages.
3. Rebuilt and captured the final pages, checked that lazy images loaded, and refreshed the existing in-app browser preview. Final screenshot checks reported no page errors or horizontal overflow.

Validation:

- Production TypeScript/build passed.
- Eight browser journeys passed, including all prior customer/provider/rider/admin workflows and the new motion, accordion, mobile-navigation and reduced-motion check.
- Journey viewport checks cover 360, 390, 430, 768, 1366, 1440 and 1536px.
- Additional final captures cover home at 360/390/768/1440px and booking/providers/plans/services at 390/1440px.
- Screenshots and the capture result are in `screenshots/ui-refresh/`.

The preview remains at http://127.0.0.1:5173/ with simulated payments. The existing live-payment and deployment limits in the README still apply.

## Follow-up polish

Added an interactive homepage load selector with pickup/at-home comparison. Prices update from the configured catalogue and the selected load and location carry through to booking. Service cards now have photographs, duration labels and prices that include pickup and return where applicable. Provider cards show specialties, clearer availability and favourite feedback, and the homepage has a loading placeholder for provider data. The mobile menu has clearer touch targets and icons, closes on outside click/Escape, and restores focus on Escape.

The service-card walkthrough also exposed an existing dry-cleaning entry issue: it opened with unsupported quick-load pricing. It now defaults to fixed pricing. The new browser check verifies homepage prices and selection, menu keyboard behavior, provider navigation, and matching service-card/booking prices for dry cleaning, wash-and-iron, express and bedding.

Five relevant browser journeys passed in this pass (full laundry lifecycle, responsive layouts, home/deposit/offline lifecycle, motion/accessibility, and the new service-choice journey). After the last price consistency change, the new service-choice journey passed again. Production build passed. Additional rendered captures for the price selector, provider section and service cards are in `screenshots/ui-refresh/`.
