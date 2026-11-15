# Pet Feeder Card

<img src="assets/brand/readme.png" width="192" alt="Original teal and navy six-compartment feeder mark">

A Home Assistant dashboard card for PetSafe FreshFeed and Aqara C1.
Distribution version **0.3.0** (independent of the integration's version).
Original artwork and code are MIT licensed. This community project is not affiliated
with PetSafe, FreshFeed or Aqara; names are their respective owners' trademarks.

## Install

Add `https://github.com/sudolulo/pet-feeder-card` to HACS custom repositories as
**Dashboard** (plugin), then download. This is not a default-catalog listing claim.
The module resource URL is:

```yaml
url: /hacsfiles/pet-feeder-card/pet-feeder-card.js
type: module
```

If HACS already registered the resource, do not add a duplicate. Refresh your browser after installation.
Both `dist/pet-feeder-card.js` and `dist/freshfeed-model.js` must be installed together;
the entry module imports its sibling with a version query. For manual installation,
copy **both** files to `/config/www/pet-feeder-card/` and use the module resource
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
That integration requires an existing fingerprint-compatible tuya_local source;
HACS installation is not universal device/runtime compatibility.

Guarded controls and recovery require administrator context and explicit confirmation;
uncertainty is not cleared by deleting storage. Cancel is not an emergency stop.
History is HA-observed reports/transitions, not cloud history; DP151 retrieval/decoding
is unsupported. Device observations and submitted commands do not prove physical
feeding or command causality. See the integration README for full safety limitations.

Issues: https://github.com/sudolulo/pet-feeder-card/issues.
Canonical development: https://git.arch.fyi/flan/pet-feeder-card.
See [LICENSE](LICENSE) and [NOTICE](NOTICE).
