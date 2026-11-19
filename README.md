# Portfolio

Personal portfolio website, built with [Astro](https://astro.build) and [three.js](https://threejs.org).

The landing page is a 3D mountain rendered in the browser. Scrolling the page moves the camera and draws a path from the valley to the summit. Phones and low-end devices get a lighter scene, and browsers without WebGL get a static fallback.

## Tech stack

- Astro (static output)
- three.js for the 3D landing scene
- Prettier for formatting
- GitHub Actions for CI

## Getting started

Requires Node.js 22 (see `.nvmrc`).

```bash
npm install
npm run dev
```

The site runs at http://localhost:4321.

## Scripts

| Command                | What it does                   |
| ---------------------- | ------------------------------ |
| `npm run dev`          | Start the dev server           |
| `npm run build`        | Build the site into `dist/`    |
| `npm run preview`      | Serve the production build     |
| `npm run format`       | Format all files with Prettier |
| `npm run format:check` | Check formatting (used in CI)  |

## Project structure

```
src/
  layouts/   Shared page layout
  pages/     One file per route
  scripts/   Client-side scripts (3D mountain scene)
  styles/    Page styles
public/      Static files served as-is
```

## License

[MIT](LICENSE)
