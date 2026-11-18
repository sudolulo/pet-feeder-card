# Pet Feeder Card

<img src="assets/brand/readme.png" width="192" alt="Original teal and navy six-compartment feeder mark">

A Home Assistant dashboard card for PetSafe FreshFeed and Aqara C1.
Distribution version **0.4.0** (independent of the integration's version).
Original artwork and code are MIT licensed. This community project is not affiliated
with PetSafe, FreshFeed or Aqara; names are their respective owners' trademarks.

## Compatibility

| Component | Compatibility |
|---|---|
| Integration 0.5.0 | Standalone HA >= 2026.10.0, TinyTuya 1.20.0, protocol 3.5; Tuya Local is not required. |
| Legacy and migration | Fingerprint-compatible Tuya Local 2026.10.0; migration only HA 2026.10.x. |
| Card 0.4.0 | Aqara and raw modes are independent. |

The visual editor discovers feeder entities when registry access permits; use manual
YAML if discovery is unavailable or ambiguous. The five-minute near-meal warning is
advisory only, not verified app pre-defrost parity; saving remains allowed. Estimates
assume a filled tray and use compartment position, not measured food or consumption.
Observed-meal statistics start at zero without backfill, exclude offline gaps and
unsaved increments, and may lose recent increments on abrupt power loss. Diagnostics
omit identifying data; Repairs advise without mutating retained intent. Guarded
services reject missing or non-administrator contexts; automations are not automatically
authorized.

HACS does not automatically install root blueprints. Import these source URLs or
manually copy YAML into `/config/blueprints/automation/petsafe_freshfeed/`.
They notify or update helpers only, not feeder commands. These source links do not
assert publication or availability.

- Low estimated meals: [source](https://raw.githubusercontent.com/sudolulo/petsafe-freshfeed/main/blueprints/automation/petsafe_freshfeed/low_estimated_meals.yaml) / [import](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fraw.githubusercontent.com%2Fsudolulo%2Fpetsafe-freshfeed%2Fmain%2Fblueprints%2Fautomation%2Fpetsafe_freshfeed%2Flow_estimated_meals.yaml)
- Feeder attention: [source](https://raw.githubusercontent.com/sudolulo/petsafe-freshfeed/main/blueprints/automation/petsafe_freshfeed/feeder_attention.yaml) / [import](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fraw.githubusercontent.com%2Fsudolulo%2Fpetsafe-freshfeed%2Fmain%2Fblueprints%2Fautomation%2Fpetsafe_freshfeed%2Ffeeder_attention.yaml)
- Refill/cleaning: [source](https://raw.githubusercontent.com/sudolulo/petsafe-freshfeed/main/blueprints/automation/petsafe_freshfeed/refill_cleaning_reminder.yaml) / [import](https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fraw.githubusercontent.com%2Fsudolulo%2Fpetsafe-freshfeed%2Fmain%2Fblueprints%2Fautomation%2Fpetsafe_freshfeed%2Frefill_cleaning_reminder.yaml)

## Install

Add `https://github.com/sudolulo/pet-feeder-card` to HACS custom repositories as
**Dashboard** (plugin), then download. This is not a default-catalog listing claim.
The module resource URL is:

```yaml
url: /hacsfiles/pet-feeder-card/pet-feeder-card.js
type: module
```

If HACS already registered the resource, do not add a duplicate. Refresh your browser after installation.
All four sibling modules must be installed together: `dist/pet-feeder-card.js`,
`dist/freshfeed-model.js`, `dist/pet-feeder-card-editor.js` and
`dist/freshfeed-editor-model.js`. Imports use version queries. For manual installation,
copy **all four** files to `/config/www/pet-feeder-card/` and use the module resource
`/local/pet-feeder-card/pet-feeder-card.js`. Do not use a single-file release asset.

## Minimal read-only configurations

Replace the example entity IDs with your own Home Assistant entities. FreshFeed raw
mode displays literal selected states without inferred health, food levels, controls
or datapoint decoding. It accepts 1–32 unique sensor/binary_sensor IDs:

```yaml
type: custom:pet-feeder-card
model: freshfeed
mode: raw
raw_entities:
  - sensor.example_dp_4
  - binary_sensor.example_dp_110
```

Aqara C1 standard mode, for entities supplied by your existing integration (for example
Zigbee2MQTT); raw mode is not supported for Aqara:

```yaml
type: custom:pet-feeder-card
model: aqara_c1
entities:
  food_level: sensor.example_food_level
  portions_today: sensor.example_portions_today
```

These examples configure no actions and send no device commands. Missing or
unavailable entities do not prove a device fault. For FreshFeed semantic schedules,
history and guarded controls, separately install the
[FreshFeed integration](https://github.com/sudolulo/petsafe-freshfeed), bind its actual
entry ID plus schedule/write-status/quick-feed/history entities in the card's
`freshfeed` mapping, and explicitly opt in to controls in integration options.
Standalone entries do not require Tuya Local; legacy entries require a fingerprint-compatible
Tuya Local source. HACS installation is not universal device/runtime compatibility.

The following semantic example is read-only by default; replace every example binding
with the actual integration entry and entities. Actions require separate explicit configuration.

```yaml
type: custom:pet-feeder-card
model: freshfeed
freshfeed:
  entry_id: example_entry_123
  schedule_entity: sensor.example_schedule
  write_status_entity: sensor.example_write_status
  quick_feed_entity: sensor.example_quick_feed
  history_entity: sensor.example_history
entities:
  status: sensor.example_status
  food_level: sensor.example_food_level
  meals_left: sensor.example_meals_left
  last_fed: sensor.example_last_fed
  next_meal: sensor.example_next_meal
  error: binary_sensor.example_fault
```

Guarded controls and recovery require administrator context and explicit confirmation;
uncertainty is not cleared by deleting storage. Cancel is not an emergency stop.
History is HA-observed reports/transitions, not cloud history; DP151 retrieval/decoding
is unsupported. Device observations and submitted commands do not prove physical
feeding or command causality. See the integration README for full safety limitations.

Issues: https://github.com/sudolulo/pet-feeder-card/issues.
Canonical development: https://git.arch.fyi/flan/pet-feeder-card.
See [LICENSE](LICENSE) and [NOTICE](NOTICE).
