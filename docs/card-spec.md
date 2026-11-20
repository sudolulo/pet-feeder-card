# pet-feeder-card -- spec

A Home Assistant Lovelace custom card (`type: custom:pet-feeder-card`) that shows a pet
feeder the way the Whisker card shows a Litter-Robot: a header with name and status, a large
centred product illustration, floating round action buttons, a side chip, level gauge bars
and a footer of metrics. Two feeder models are supported by artwork and defaults:

- `freshfeed` -- PetSafe FreshFeed refrigerated wet-food feeder (PFD00-18290). A low, wide,
  matte-black round puck: domed lid with a rectangular serving window at the front (food
  visible through it), a horizontal seam between lid and base, a vent grille on the left side
  of the base, a thin horizontal LED light strip on the front right of the base, three short
  feet. Default colour `black`.
- `aqara_c1` -- Aqara Smart Pet Feeder C1 (ZNCWWSQ01LM), dry kibble. A tall white cylinder
  with a rounded lid, a tinted translucent hopper window on the front showing the kibble
  level, and a food bowl protruding at the front of the base. Default colour `white`.

## Release 0.4.0 semantic presentation

Integration 0.5.0 is independently versioned. FreshFeed semantic configuration uses
`freshfeed.entry_id`, `schedule_entity`, `write_status_entity`, `quick_feed_entity`
and `history_entity`, plus the existing `entities` routes. It is read-only by default;
controls require explicit opt-in and guarded services require administrator context.
Aqara and raw observations remain independent of the integration.

`getConfigElement()` lazily imports the visual editor. Registry discovery uses exact
entry/device/entity bindings, never friendly-name guesses; denied or ambiguous discovery
offers manual YAML. Existing advanced configuration is retained unless changing feeder
or incompatible model requires an explicit reset.

FreshFeed labels use Estimated meals, Estimated empty tray and Estimated last meal.
Compartment position assumes a filled tray; it does not measure food or consumption.
History uses friendly event labels and HA locale/time-zone formatting, retaining raw
machine attributes. Unknown service errors use fixed safe copy, never raw exceptions.
The inclusive 0..5 minute near-meal advisory examines draft and current schedules in
HA's time zone, including DST folds/gaps. It warns but never disables saving; unavailable
timing is disclosed, not guessed. It is not verified app pre-defrost parity.

Controls dialogs use `role=dialog`, `aria-modal=true` and visible title linkage, trap
keyboard focus, support Escape and restore focus on close. The background is inert;
HA more-info remains usable. Narrow/short layouts scroll internally without losing drafts.
Observed totals are best-effort local observations, not consumption: no historical
backfill, no offline coverage and possible loss of unsaved increments on abrupt power loss.
Diagnostics omit identity and Repairs never mutate retained intent.

## Visual reference

The layout follows the structure of the
[Whisker card](https://github.com/homeassistant-extras/whisker):

1. Header row: card name (left, ~22px, medium weight); status label + coloured status icon
   (right). Thin divider under the header.
2. Body: a round 44px "menu" button at top-left (opens the controls dialog); round 52px
   action buttons centred along the top; the illustration centred and large (~60% card
   width); a pill-shaped chip on the left edge, vertically lower-middle, with an icon + value.
3. Gauges: uppercase small label ("FOOD", or the configured label) above a rounded 8px bar.
   Bar colour: green >= 50%, amber 20-49%, red < 20%. Optional percentage text.
   When the meal tray applies (see below) it replaces the food gauge in this area.
4. Footer below a divider: 2-3 items, each `icon + value` (relative time strings like
   "51 minutes ago" for timestamps).

Use only Home Assistant theme CSS variables (`--primary-text-color`,
`--secondary-text-color`, `--card-background-color`, `--divider-color`, `--success-color`,
`--warning-color`, `--error-color`, `--info-color`, `--state-icon-color`) with sensible
fallbacks, so it looks right in light and dark themes.

## Artwork

Inline SVG generated in JS (no external image files). Both illustrations must be
theme-independent product colours with soft shading (linear/radial gradients, a soft floor
shadow ellipse). State-driven visuals:

- FreshFeed LED strip colour: blue (`#3b82f6`) normal, amber when food low, red on fault or
  empty, grey when offline. While `feeding`, the food visible in the serving window slides in
  (CSS keyframe translate) and the LED pulses. A small snowflake glyph near the strip.
- Aqara C1 hopper window fill height follows the food percentage (if the food entity is for
  the bowl, not the hopper, use `art_level: bowl` -> show food heaped in the bowl when > 0
  and an empty bowl at 0). While `feeding`, 3-5 kibble dots fall into the bowl (CSS keyframes).
- `offline`: the whole illustration at 40% opacity, greyscale filter.
- Respect `prefers-reduced-motion` (no animation).

## Configuration

```yaml
type: custom:pet-feeder-card
model: freshfeed            # freshfeed | aqara_c1 (required)
mode: standard              # optional: standard (default) | raw
name: FreshFeed             # optional, default from model
color: black                # optional artwork colour: black | white
food_label: Food            # optional gauge label
art_level: hopper           # aqara only: hopper | bowl
meal_slots: 6               # optional meal-tray compartments, integer 1-12
                            # (default 6 for freshfeed; aqara_c1 has no default -> no tray)
entities:                   # every key optional; card renders what is configured
  status: sensor.x          # raw status string (see normalisation)
  food_level: sensor.x      # enum string or numeric 0-100
  error: binary_sensor.x    # 'on' = fault
  last_feed: sensor.x       # numeric portions of the last feed (chip)
  last_fed: sensor.x        # timestamp state (FreshFeed requires a valid timestamp; Aqara falls back to last_changed)
  portions_today: sensor.x
  weight_today: sensor.x
  counter: sensor.x         # meals delivered since the last refill (drives the meal tray)
  meals_left: sensor.x      # alternative for the meal tray: meals remaining; counter wins if both
  schedule: sensor.x        # Aqara/Zigbee2MQTT schedule string, used to compute next meal
  next_meal: sensor.x       # alternative: timestamp/datetime state (input_datetime too)
  temperature: sensor.x
  camera: camera.x          # adds a round camera button top-right -> more-info of camera
chip: last_feed             # which entity key the left chip shows (default last_feed)
footer: [last_fed, portions_today, next_meal]   # entity keys, in order; max 3
actions:                    # round buttons along the top, in order; max 3
  - name: Feed
    icon: mdi:food-drumstick
    action: select.select_option       # domain.service
    target: { entity_id: select.x }
    data: { option: START }
    confirm: true                      # default true
controls:                   # entity ids listed in the controls dialog (menu button)
  - select.x
```

### Raw observations

The default is `mode: standard`; `raw_entities` is accepted only with `mode: raw`.

Use `mode: raw` to show selected Home Assistant states as read-only observations, without
semantic entity mappings, actions, or controls. Raw mode is supported only for the FreshFeed;
`raw_entities` is required and must contain 1-32 unique valid `sensor.*` or
`binary_sensor.*` entity ID strings. Do not configure non-empty `entities`, `actions`, or
`controls` in raw mode (empty or omitted values are allowed). For example:

```yaml
type: custom:pet-feeder-card
model: freshfeed
mode: raw
raw_entities:
  - sensor.example_dp_4
  - binary_sensor.example_dp_110
```

Raw observations display each entity's Home Assistant display name (falling back to its
entity ID) and literal state. Missing, unknown, and unavailable states remain distinct. The availability badge means only that the selected Home Assistant
states are present and available; it does not indicate freshness, device health, or feed status.
The card makes no claim about whether a selected entity is locally or cloud sourced; the
operator must select verified local bindings when local provenance matters. Selecting a row
opens its read-only Home Assistant entity information.
A collapsible Device data panel shows the selected observations without decoding datapoints.
Raw mode keeps the FreshFeed artwork and original project six-slot logo, not a manufacturer
logo, and does not reference official SVG assets. It does not show calendars, food gauges,
temperature, meal counts, camera or actions from raw datapoints. `color` and `art_level` are
still validated in raw mode; `chip` is normalized to `false`, `footer` to `[]`, and
`meal_slots` to `null`.

`confirm: true` means the first tap turns the button into an armed state (filled
`--warning-color`, icon `mdi:check`, tooltip "Tap again to confirm") for 4 seconds; a second
tap within that window calls the service; otherwise it disarms. Never dispense on one tap
unless `confirm: false`.

### Meal tray

The FreshFeed holds 6 meal compartments that rotate to the serving window in order 1..6;
the device counts meals delivered since the last refill (reset on refill). When
`meal_slots` is set (default for `freshfeed`) and a `counter` or `meals_left` entity is
configured, the gauge area shows a meal tray instead of the food gauge (`food_level` still
drives the status and the LED colour). Same 60% width as the gauges:

- FreshFeed header: uppercase `ESTIMATED MEALS`; "Estimated 4 of 6 left",
  "Estimated last meal" (1 left), "Estimated empty tray" (0 left) or "Unknown".
  Other model labels retain their existing meanings. Coloured green when 3 or more
  are left, amber at 1-2, red at 0, neutral when unknown (the gauge colour variables).
- A row of `meal_slots` equal rounded tiles (gap 6px, 34px high, radius 9px), numbered:
  - full: warm wet-food gradient (`#d9874a` -> `#a85a2b`) with highlight dots, white number;
  - serving: the same food at reduced saturation, a 2px `--info-color` ring and
    `mdi:silverware-fork-knife` instead of the number (title "Meal N is in the serving window");
  - eaten: hollow, 1.5px dashed `--divider-color` border, number in
    `--secondary-text-color` and a faint `mdi:check`;
  - unknown: hollow dashed with "?".
- The next compartment (first full one) has a caption below it: the next meal time in 24h
  `HH:MM` local when `next_meal` (or an Aqara `schedule`) is configured and known, else "next".
- Tile titles read "Meal 4 - full", "Meal 2 - eaten". The whole row is one tap target that
  fires `hass-more-info` for the counter (or meals_left) entity.
- Below a 220px tray width (narrow cards) the gap, tile height and font shrink so six tiles
  fit inside a 320px-wide card.

Tapping the status icon, the chip, a gauge or a footer item fires `hass-more-info` for the
underlying entity. The controls dialog: an `ha-dialog` (or a simple in-card overlay if
`ha-dialog` is unavailable) whose content is one row per `controls` entity, created with
`window.loadCardHelpers()` -> `createRowElement({ entity })`, each row receiving `hass`.

Provide `static getStubConfig()` (model freshfeed, no entities), `getCardSize()` (7) and
`getGridOptions()` (`{ columns: 12, min_columns: 6, rows: 'auto' }`). Throw a clear
`Error` from `setConfig` if `model` is missing or unknown. The lazy visual editor is
optional; manual YAML remains supported.

## Normalisation (pure functions, exported, unit tested)

`normalizeStatus({ status, error, available })` -> `{ key, label, icon, color }`
precedence: `available === false` or status `unavailable`/`unknown` -> offline; error on ->
fault; then status string (case-insensitive):

| raw states                                   | key      | label        | icon                       | colour var        |
|----------------------------------------------|----------|--------------|----------------------------|-------------------|
| standby, idle, ready, (no status entity)     | ready    | Ready        | mdi:check-circle-outline   | --success-color   |
| feeding, dispensing                          | feeding  | Feeding      | mdi:food-drumstick         | --info-color      |
| feeding_complete, done                       | done     | Fed          | mdi:check-all              | --success-color   |
| no_food, last_meal, empty, run_out           | empty    | Out of food  | mdi:alert-circle-outline   | --error-color     |
| (error on)                                   | fault    | Fault        | mdi:alert-octagon-outline  | --error-color     |
| (offline)                                    | offline  | Offline      | mdi:wifi-off               | --disabled-color  |
| anything else                                | ready    | Title-cased raw string | mdi:information-outline | --secondary-text-color |

`normalizeFoodLevel(state)` -> `{ pct: number|null, label: string }`:
numeric 0-100 -> that pct and label `"<n>%"`; case-insensitive strings: high, enough, full
-> 100 "Full"; medium, half -> 50 "Half"; low, insufficient -> 20 "Low"; empty, run_out ->
0 "Empty"; unavailable/unknown/none/'' -> null "Unknown"; other strings -> null and the raw
string title-cased.

`parseAqaraSchedule(str)` -> array of `{ days, hour, minute, size }`; input is a
Python-literal list string such as
`[{'days': 'everyday', 'hour': 7, 'minute': 0, 'size': 3}, {'hour': 9, 'size': 3}]`.
Missing `minute` -> 0, missing `days` -> 'everyday', missing size -> 1. Invalid input -> [].

`nextMeal(schedule, now: Date)` -> `{ at: Date, size }` or null: earliest upcoming slot
strictly after `now` within the next 7 days. Supported `days` values (Zigbee2MQTT Aqara C1):
`everyday`, `workdays` (Mon-Fri), `weekend` (Sat-Sun), single days `mon`..`sun`, and
hyphen-joined day lists such as `mon-wed-fri-sun`, `tue-thu-sat`. Uses local time.

`mealSlots({ slots, delivered, left })` -> `{ slots: [{ n, state, next }], left, delivered, known }`.
`delivered` (meals served since the refill) and `left` (meals remaining) are numbers or
null; `delivered` wins when both are given, otherwise `delivered = slots - left`. The result
is clamped to 0..slots. With neither a finite `delivered` nor `left` (unavailable,
non-numeric) -> `known: false`, `left`/`delivered` null and every slot state `unknown`.
Slot states: `n < delivered` -> `eaten`; `n == delivered` (delivered >= 1) -> `serving` (that
compartment is in the window now); `n > delivered` -> `full`. `next` is true only on the
first `full` slot. `buildModel` exposes the tray as `meals: { entity, slots, left, total,
label, text, color }`, each slot carrying `time` (the `HH:MM` label on the next slot, else
null).

`relativeTime(date, now)` -> "just now" (<45s), "N minutes ago", "N hours ago", "N days ago",
and for future dates "in N minutes" / "in N hours" / "tomorrow at 07:00"-style is NOT needed:
use "in N minutes", "in N hours", "in N days".

## Engineering constraints

- Four sibling ES modules installed together: `dist/pet-feeder-card.js`,
  `dist/freshfeed-model.js`, `dist/pet-feeder-card-editor.js` and
  `dist/freshfeed-editor-model.js`, with imports versioned to the card release.
  No build step, no npm runtime deps,
  no Lit import (HA does not expose Lit to custom cards reliably): plain `HTMLElement` +
  shadow DOM, re-render on `set hass` only when a watched entity's state object changed.
- The module must import cleanly in Node for tests: guard `customElements.define` and the
  `HTMLElement` base (`globalThis.HTMLElement ?? class {}`). Export the pure functions.
- Register in `window.customCards` (type `pet-feeder-card`, name `Pet Feeder Card`,
  description).
- No emoji anywhere. Comment non-obvious logic.
- Tests: `node --test test/` (Node 24, `node:test` + `node:assert`), no dependencies.
- Visual harness: `harness/index.html` renders the card with a mock `hass` object
  (`states`, `callService` that logs, `formatEntityState` optional) in a grid of scenarios,
  and `harness/shoot.mjs` uses Playwright to write PNGs to `harness/out/`. Scenarios: FreshFeed ready/high,
  feeding/low (animation paused at a mid frame), empty, fault, offline; Aqara C1 ready
  bowl full with schedule, bowl empty; each in a light and a dark theme (set the theme CSS
  variables on the harness page).
