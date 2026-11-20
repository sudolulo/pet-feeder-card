# Pet Feeder Card

[![HACS custom](https://img.shields.io/badge/HACS-custom-orange)](https://hacs.xyz/docs/faq/custom_repositories/)
[![Release](https://img.shields.io/github/v/release/sudolulo/pet-feeder-card)](https://github.com/sudolulo/pet-feeder-card/releases)
[![License](https://img.shields.io/github/license/sudolulo/pet-feeder-card)](LICENSE)

A Home Assistant dashboard card for the PetSafe FreshFeed and Aqara C1 pet feeders. Version **0.4.2**.

![FreshFeed card in light and dark themes, with synthetic data](docs/images/card-pair.png)

- Shows feeder status, food level, the next meal and recent feeding at a glance.
- Shows the six-meal tray estimate for FreshFeed.
- Opens a FreshFeed dialog for the schedule, history and guarded commands when used with the [FreshFeed integration](https://github.com/sudolulo/petsafe-freshfeed).
- Includes a visual editor that finds FreshFeed devices automatically; YAML works too.

This is a community project, not affiliated with PetSafe or Aqara.

## Requirements

- Home Assistant 2026.10.0 or newer for the FreshFeed integration. The Aqara and raw modes work with any entities you already have.
- [HACS](https://hacs.xyz/) for the easiest installation.

## Installation

1. In HACS, open **Custom repositories** and add `https://github.com/sudolulo/pet-feeder-card` with type **Dashboard**.
2. Download **Pet Feeder Card**. HACS normally adds the dashboard resource for you. If it does not, add `/hacsfiles/pet-feeder-card/pet-feeder-card.js` as a JavaScript module resource.
3. Refresh the browser.

To install by hand, copy the four files in `dist/` (`pet-feeder-card.js`, `freshfeed-model.js`, `pet-feeder-card-editor.js`, `freshfeed-editor-model.js`) to `/config/www/pet-feeder-card/` and add `/local/pet-feeder-card/pet-feeder-card.js` as a module resource. All four files are needed.

## Quick start

Add the card from the dashboard editor and pick your feeder. The editor reads the Home Assistant registry to find FreshFeed devices and entities. If it cannot, fill in the fields yourself or use one of the YAML examples below; replace every example ID with your own.

## FreshFeed raw example

Replace example IDs with your own. Raw mode displays selected literal states without inferred health or controls.

```yaml
type: custom:pet-feeder-card
model: freshfeed
mode: raw
raw_entities:
  - sensor.example_state
  - binary_sensor.example_fault
```

## Aqara example

Use entities supplied by an existing integration, such as Zigbee2MQTT.

```yaml
type: custom:pet-feeder-card
model: aqara_c1
entities:
  food_level: sensor.example_food_level
  portions_today: sensor.example_portions_today
```

These raw and Aqara examples configure no actions and send no device commands. Missing or unavailable entities do not prove a fault.

## FreshFeed semantic example

Install the [FreshFeed integration](https://github.com/sudolulo/petsafe-freshfeed) separately and replace all example bindings with your actual integration entry and entities. This example configures no action buttons, but is **not inherently read-only**: the FreshFeed dialog can save schedules and expose guarded commands and recovery when integration controls are enabled and administrator and state checks permit them.

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

## Confirmed Feed fragment

Add this actions-only fragment to the semantic example if you want a Feed button. The existing `freshfeed.entry_id` supplies the entry ID; the card supplies `confirmed: true` only after its confirmation gesture.

```yaml
actions:
  - name: Feed
    icon: mdi:food-drumstick
    action: petsafe_freshfeed.command
    data:
      operation: feed
    confirm: true
```

## Configuration reference

- `type`: `custom:pet-feeder-card`. Required `model`: `freshfeed` or `aqara_c1`.
- `mode`: `standard` by default; `raw` is FreshFeed only. Raw requires `raw_entities`: 1 to 32 unique `sensor` or `binary_sensor` entity IDs with lowercase letters, digits or underscores in the object ID, and disallows nonempty `entities`, `actions` and `controls` and the `freshfeed` mapping. It forces chip off, empty footer and no meal tray. `raw_entities` is prohibited in standard mode.
- `name` defaults to FreshFeed or Aqara C1; `color` is `black` or `white` (defaults black for FreshFeed, white for Aqara); `food_label` defaults to Food; `art_level` is `hopper` (default) or `bowl`.
- `meal_slots` is an integer from 1 to 12 or null (no tray); defaults to 6 for FreshFeed and null for Aqara.
- `entities` maps any of `status`, `food_level`, `error`, `last_feed`, `last_fed`, `portions_today`, `weight_today`, `counter`, `meals_left`, `schedule`, `next_meal`, `temperature`, `camera` to entity IDs.
- Optional `freshfeed` enables semantic integration features only in FreshFeed standard mode. Supply all five nonempty fields and no others: `entry_id`, `schedule_entity`, `write_status_entity`, `quick_feed_entity`, `history_entity`. Use your real entry ID.
- `chip` defaults to `last_feed`; set false or null to hide it. `footer` defaults to [`last_fed`, `portions_today`, `next_meal`] and accepts at most 3 items. Both accept display keys `last_feed`, `last_fed`, `portions_today`, `weight_today`, `counter`, `next_meal`, `temperature`, `food_level`.
- `actions` defaults to an empty list and accepts at most 3 buttons. Each requires `action: domain.service` and may specify `name`, `icon`, `target`, `data` and `confirm`. Name defaults to the action, icon to `mdi:gesture-tap-button`, and confirmation defaults true. With `freshfeed` bound, only `petsafe_freshfeed.command` with data containing exactly `operation: feed`, `defrost`, or `refilled` is allowed; no target, extra data fields or `confirm: false`. Cancel and recovery belong to the dialog.
- `controls` defaults to an empty list of entity IDs. With `freshfeed` bound, `text` and `button` entity controls are prohibited.

## Safety

- Controls stay off until you enable them in the integration options, and they need an administrator. Automations are not authorized automatically.
- Every command asks for confirmation. Cancel is not an emergency stop.
- An empty tray blocks Feed. If the feeder has not reported its quick-feed state, a recent local reading can still allow a command, so a pending feed could cause an extra meal. Check the feeder before acting.
- Recovery reads the feeder's local reports and sends no command. It can clear an uncertain operation but does not prove the feeder finished it. Do not retry a command that may have been sent, and do not delete or reset storage as a workaround.

## Schedule and estimates

- The dialog keeps showing the last known schedule and lets you edit it; an unknown schedule is not an empty one. In Fully local mode a schedule that was never seen cannot be replaced until the feeder reports it. A schedule read from the cloud is labelled as such.
- A warning appears when you edit within five minutes of a meal. It does not block saving.
- Food and meals left are estimates from the tray position and the last refill, not measurements.
- History counts only what Home Assistant saw locally. Offline gaps are not filled in, and the next meal is a projection, not a promise.

## Troubleshooting

- Check **Settings > System > Repairs** and the integration's diagnostics download.
- If the feeder is unavailable, check its power, network and address. Reconfigure the address rather than deleting the integration.
- The official PetSafe app is only needed for first Wi-Fi setup and firmware updates.
- See the [integration README](https://github.com/sudolulo/petsafe-freshfeed) for setup, privacy and the optional notification blueprints. HACS does not install blueprints automatically; they only notify or update helpers and never command the feeder.

## Support

Report problems at https://github.com/sudolulo/pet-feeder-card/issues. Security issues: see [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
