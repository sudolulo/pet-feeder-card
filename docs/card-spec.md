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

## Visual reference

The Whisker card preview is at `docs/whisker-reference.png` (copy of
https://raw.githubusercontent.com/homeassistant-extras/whisker/main/docs/assets/robot.png).
Match its structure and polish:

1. Header row: card name (left, ~22px, medium weight); status label + coloured status icon
   (right). Thin divider under the header.
2. Body: a round 44px "menu" button at top-left (opens the controls dialog); round 52px
   action buttons centred along the top; the illustration centred and large (~60% card
   width); a pill-shaped chip on the left edge, vertically lower-middle, with an icon + value.
3. Gauges: uppercase small label ("FOOD", or the configured label) above a rounded 8px bar.
   Bar colour: green >= 50%, amber 20-49%, red < 20%. Optional percentage text.
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
name: FreshFeed             # optional, default from model
color: black                # optional artwork colour: black | white
food_label: Food            # optional gauge label
art_level: hopper           # aqara only: hopper | bowl
entities:                   # every key optional; card renders what is configured
  status: sensor.x          # raw status string (see normalisation)
  food_level: sensor.x      # enum string or numeric 0-100
  error: binary_sensor.x    # 'on' = fault
  last_feed: sensor.x       # numeric portions of the last feed (chip)
  last_fed: sensor.x        # timestamp state; if state is not a timestamp, use last_changed
  portions_today: sensor.x
  weight_today: sensor.x
  counter: sensor.x         # meals delivered
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

`confirm: true` means the first tap turns the button into an armed state (filled
`--warning-color`, icon `mdi:check`, tooltip "Tap again to confirm") for 4 seconds; a second
tap within that window calls the service; otherwise it disarms. Never dispense on one tap
unless `confirm: false`.

Tapping the status icon, the chip, a gauge or a footer item fires `hass-more-info` for the
underlying entity. The controls dialog: an `ha-dialog` (or a simple in-card overlay if
`ha-dialog` is unavailable) whose content is one row per `controls` entity, created with
`window.loadCardHelpers()` -> `createRowElement({ entity })`, each row receiving `hass`.

Provide `static getStubConfig()` (model freshfeed, no entities), `getCardSize()` (7) and
`getGridOptions()` (`{ columns: 12, min_columns: 6, rows: 'auto' }`). Throw a clear
`Error` from `setConfig` if `model` is missing or unknown. No visual editor.

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

`relativeTime(date, now)` -> "just now" (<45s), "N minutes ago", "N hours ago", "N days ago",
and for future dates "in N minutes" / "in N hours" / "tomorrow at 07:00"-style is NOT needed:
use "in N minutes", "in N hours", "in N days".

## Engineering constraints

- One deployable ES module: `card/pet-feeder-card.js`. No build step, no npm runtime deps,
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
  and `harness/shoot.mjs` uses Playwright (installed into this project's `node_modules`,
  using the already-cached Chromium under `~/.cache/ms-playwright`; do not download browsers
  into `/tmp`) to write PNGs to `harness/out/`. Scenarios: FreshFeed ready/high,
  feeding/low (animation paused at a mid frame), empty, fault, offline; Aqara C1 ready
  bowl full with schedule, bowl empty; each in a light and a dark theme (set the theme CSS
  variables on the harness page).
