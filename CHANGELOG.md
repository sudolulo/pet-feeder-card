# Changelog

## [0.5.0] - 2026-11-23

### Added
- A Reset after refill button appears on FreshFeed cards and becomes prominent when the tray is estimated empty; it uses the same tap-again confirmation as Feed.

### Changed
- Clearer README covering installation, configuration examples and the FreshFeed controls.
- Bug report template, security policy and a short developer guide; maintainer-only dashboard tools are no longer in the repository.

### Fixed
- The visual harness checks that the controls panel stays inside the viewport and that every control row can be scrolled into view, matching the full-screen dialog.

## [0.4.2] - 2026-11-19

### Changed
- The card now lives in its own repository with the distribution modules under `dist/`; installed files and the resource path are unchanged.

## [0.4.1] - 2026-11-19

### Fixed
- Release a matching operation/session latch after local abandonment and show execution unknown. The 0.5.0 backend retains the strict fallback.
- Unknown quick-feed state no longer blocks Feed or Defrost on its own; the integration's admission decides, and active or pending states still block.

### Added
- Opening the schedule dialog requests a schedule refresh, with a retry button while the schedule is unknown.

## [0.4.0] - 2026-11-18

### Added
- Lazy visual editor with manual configuration fallback, accessible dialogs, friendly
  history and errors, and a five-minute advisory for schedule edits.

## [0.3.0] - 2026-10-30

### Added
- Opt-in, read-only FreshFeed mode for displaying selected Home Assistant entity
  names and literal states without assigning data-point meanings or offering controls.
- Raw observations panel with distinct missing, unknown, unavailable, and available states,
  plus responsive visual coverage and live-resource-only deployment guidance.

### Changed
- Existing FreshFeed standard cards now display `Unknown` for absent or unrecognized
  statuses rather than implying readiness. Offline and fault precedence is unchanged.
- FreshFeed `last_fed` now requires a valid, explicitly zoned timestamp at or before the
  current time. Non-timestamp states no longer fall back to `last_changed` and display
  `Unknown` instead. Operators upgrading existing cards must bind a verified last-feed
  timestamp to retain this display; Aqara's `last_changed` fallback is unchanged.
- Raw mode does not verify whether selected entities are local or cloud sourced; operators
  must verify their bindings when local provenance matters.

## [0.2.0] - 2026-10-20

### Added
- Meal tray row for the FreshFeed: one tile per compartment showing which meals are
  eaten, which one is in the serving window and which are still full, with "4 of 6 left" /
  "Last meal" / "Refill needed" and the next meal time under the next compartment. It
  replaces the food gauge when a `counter` or `meals_left` entity is configured.
- `meal_slots` option (1-12, default 6 for `freshfeed`) and the `meals_left` entity key.
- Pure `mealSlots()` helper with unit tests; harness checks for the tray, including
  tile fit inside a narrow card.

## [0.1.0] - 2026-10-20

### Added
- `custom:pet-feeder-card` with SVG artwork for the PetSafe FreshFeed and Aqara C1,
  state-driven LED, food and kibble animations, light/dark theme support and
  reduced-motion handling.
- Two-tap confirmation for feed actions, keyboard focus kept on the armed button.
- In-card controls overlay built from Home Assistant entity rows.
- Pure helpers with unit tests: status and food-level normalisation, Aqara schedule
  parsing, next-meal calculation, relative time.
- Playwright harness with a mock `hass`, behaviour checks and screenshots.
- Websocket tooling to install the cards and verify the live dashboard.

### Fixed
- Controls overlay no longer closes when the masonry view re-parents cards.
