# Portfolio

Personal portfolio website, built with [Astro](https://astro.build) and [three.js](https://threejs.org).

The landing page is a climb up a 3D mountain. The scene is built and rendered in Blender (`blender/climb.py`) to 120 stills per orientation, doubled to 239 with frame interpolation, which the home page plays as you scroll. Scrolling is free: the climb video follows the scroll position, and the sharp still of a stop shows when it rests on one. At the top, one more scroll takes you into the page. This keeps the climb smooth on any device, without running WebGL on the home page.

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

## Re-rendering the landing frames

1. Render 120 frames per orientation in Blender. This writes `public/berg/l` (landscape, 2560x1440) and `public/berg/p` (portrait, 1080x2340):

   ```
   blender -b -P blender/climb.py -- --render l
   blender -b -P blender/climb.py -- --render p
   ```

2. Double them to 239 with [rife-ncnn-vulkan](https://github.com/nihui/rife-ncnn-vulkan) (model `rife-v4.6`). Download the release for your OS and pass its folder. The script puts one RIFE in-between frame between each pair, checks that the originals are unchanged at the even numbers, and then replaces the 120 frames with the 239:

   ```
   node scripts/double-frames.mjs <rife-ncnn-vulkan folder> l <work folder>
   node scripts/double-frames.mjs <rife-ncnn-vulkan folder> p <work folder>
   ```

   Add `--dry` to check the paths and frame mapping without running RIFE.

3. Give the short first stretch (frames 000 to 022) one more frame between every two. This adds `000h.webp` to `021h.webp` to both folders:

   ```
   node scripts/first-stretch-frames.mjs <rife-ncnn-vulkan folder> <work folder>
   ```

4. Cut the videos the home page scrubs with the scroll (needs `ffmpeg` on the PATH). ffmpeg adds a motion-interpolated frame between every two, and three at the slow start and end, so the climb is 660 frames at 60 per second. This writes `climb.mp4` and `climb-rev.mp4` (the same climb backward) to both folders, plus a lighter `climb-1080` pair for landscape, and takes about fifteen minutes:

   ```
   node scripts/build-climb.mjs
   ```

   The frame numbers in `scripts/build-climb.mjs` and `src/scripts/frames.js` must match.

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
