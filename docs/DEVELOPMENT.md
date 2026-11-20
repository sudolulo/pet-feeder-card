# Development

## Layout

- `dist/`: the four ES modules that make up the card. `pet-feeder-card.js` is the
  entry point; it imports `freshfeed-model.js` and loads the editor modules on demand.
- `test/`: `node:test` unit and DOM tests. They use synthetic states only.
- `harness/`: a local browser harness. `harness/index.html` renders the card with a mock
  `hass` object in a grid of scenarios, and `harness/shoot.mjs` drives it with Playwright.
- `docs/card-spec.md`: design notes for the card's layout and behavior.
- `assets/brand/`: the project mark and its render script.

## Tests

Use Node 22 or newer (CI uses Node 22).

```sh
npm ci
npm test
```

The YAML examples in the README are parsed during the tests, which needs Python with
PyYAML (set `PETSAFE_YAML_PYTHON` to use a specific interpreter).

## Visual harness

```sh
npx playwright install chromium
npm run shoot
```

`npm run shoot` renders every scenario in light and dark themes, runs layout and
accessibility checks, and writes screenshots to a new directory under `harness/out/`.
The harness uses mock data only and never contacts Home Assistant or a feeder.

## Releases

Bump `package.json` and add a `CHANGELOG.md` entry in the same commit, then tag
`v<version>`. Releases have no assets: HACS installs the four modules from `dist/`
in the tagged tree.
