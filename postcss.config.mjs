// PostCSS configuration for Tailwind v3 (Astro 7 has no @astrojs/tailwind integration).
// Astro/Vite auto-detects this file, so Tailwind is wired into the CSS pipeline
// without any Astro integration package.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
