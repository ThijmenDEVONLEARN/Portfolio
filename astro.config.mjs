import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://thijmen.codes',
  i18n: {
    defaultLocale: 'nl',
    locales: ['nl', 'en'],
    routing: { prefixDefaultLocale: false },
  },
});
