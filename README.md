# Portfolio

Personal portfolio website, built with [Astro](https://astro.build) and [three.js](https://threejs.org).

The landing page is a climb up a 3D mountain. The scene is built with three.js on `/berg-3d/` and rendered to 120 stills per orientation, which the home page plays as you scroll, blending neighbouring frames. Every scroll glides to the next stop on the path. This keeps the climb smooth on any device, without running WebGL on the home page.

The inner pages share one light design: ice-blue paper, slate ink and a coral accent. The About page opens on a contour map of the climb so far, drawn on a canvas, with a stop for each step.

| Route                 | Page                         |
| --------------------- | ---------------------------- |
| `/`                   | Mountain landing (stills)    |
| `/over-mij/`          | About, with the contour map  |
| `/over-mij/skills/`   | Skills in three levels       |
| `/over-mij/ervaring/` | Education and experience     |
| `/projecten/`         | Projects, linking to GitHub  |
| `/ai/`                | How I work with AI           |
| `/diensten/`          | Services: websites and n8n   |
| `/werk/`              | Open for work                |
| `/contact/`           | Contact form (not wired yet) |
| `/berg-3d/`           | The live 3D scene (unlisted) |

## Tech stack

- Astro (static output)
- three.js for the 3D scene the landing frames are rendered from
- Playwright to render those frames
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
| `npm run frames`       | Render the landing stills      |

## Re-rendering the landing frames

After changing the 3D scene, start `npm run dev` and run `npm run frames` in a second terminal. It renders the scene in headless Chromium with software WebGL and writes `public/berg/l` (landscape) and `public/berg/p` (portrait). Install the browser once with `npx playwright install chromium`.

## Project structure

```
src/
  components/  Contour map hero, About intro, footer
  data/        Page order for the menu and next links
  layouts/     Base document and the inner page layout
  pages/       One file per route
  scripts/     Client-side scripts (3D scene, frame player, contour map)
  styles/      Landing styles, design tokens and inner page styles
public/        Static files served as-is (images, landing frames, favicon)
scripts/       Render script for the landing frames
```

## License

[MIT](LICENSE)
