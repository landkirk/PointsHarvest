# Contributing to Points Harvest

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/landkirk/PointsHarvest.git
   cd PointsHarvest
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start dev mode**
   ```bash
   npm run extension:watch
   ```

4. **Load the extension** — open `chrome://extensions`, enable Developer Mode, click "Load unpacked", and select the `dist/` folder.

Changes to source files rebuild automatically. Reload the extension in Chrome to pick up updates.

## Submitting Changes

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Run lint and type-check before committing:
   ```bash
   npm run extension:lint:fix
   npm run extension:build
   ```
4. Open a pull request against `main`

## Code Style

This project uses ESLint and Prettier. Run `npm run extension:lint:fix` to auto-format. CI will check this on PRs.

## Content Scripts

Content scripts (`src/content/`) cannot use ES module `import`/`export` — they are bundled as IIFEs by esbuild. See [DEVELOP.md](DEVELOP.md) for architecture details.

## License

By contributing, you agree that your contributions will be licensed under the project's [MPL-2.0 with Additional Restrictions](LICENSE).
