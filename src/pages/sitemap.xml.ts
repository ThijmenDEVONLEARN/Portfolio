// The sitemap: the home page plus the inner pages from data/pages.ts.
import type { APIRoute } from 'astro';
import { pages } from '../data/pages';

export const GET: APIRoute = ({ site }) => {
  const urls = ['/', ...pages.map((p) => p.href)]
    .map((path) => `<url><loc>${new URL(path, site)}</loc></url>`)
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
};
