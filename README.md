# Portfolio

Personal portfolio website, built with [Astro](https://astro.build) and [three.js](https://threejs.org).

The landing page is a 3D mountain rendered in the browser. Scrolling the page moves the camera and draws a path from the valley to the summit. Phones and low-end devices get a lighter scene, and browsers without WebGL get a static fallback.

The inner pages share one light design: warm paper, ink and a tangerine accent. The About page opens on a contour map of the climb so far, drawn on a canvas, with a stop for each step.

| Route                 | Page                         |
| --------------------- | ---------------------------- |
| `/`                   | 3D mountain landing          |
| `/over-mij/`          | About, with the contour map  |
| `/over-mij/skills/`   | Skills in three levels       |
| `/over-mij/ervaring/` | Education and experience     |
| `/projecten/`         | Projects, linking to GitHub  |
| `/ai/`                | How I work with AI           |
| `/diensten/`          | Services: websites and n8n   |
| `/werk/`              | Open for work                |
| `/contact/`           | Contact form (not wired yet) |

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
  components/  Contour map hero
  data/        Page order for the menu and next links
  layouts/     Base document and the inner page layout
  pages/       One file per route
  scripts/     Client-side scripts (3D mountain, contour map)
  styles/      Landing styles, design tokens and inner page styles
public/        Static files served as-is (images, favicon)
```

## License

[MIT](LICENSE)
