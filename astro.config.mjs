import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://merakian.net',
  integrations: [
    sitemap(),
  ],
  output: 'static',
  build: {
    format: 'directory',
  },
  vite: {
    // Exclude Netlify Functions and node_modules from Vite
    build: {
      rollupOptions: {
        external: ['resend', 'zod'],
      },
    },
    ssr: {
      external: ['resend', 'zod'],
    },
  },
});
