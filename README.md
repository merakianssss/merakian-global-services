# Merakian Global Website

Modern corporate website for Merakian Global Services — a premium provider of travel, recruitment, courier, and logistics solutions.

Built with Astro 4.x and Tailwind CSS 3.x, featuring the "Aura Global" luxury dark-mode design system.

## Tech Stack

- **Framework**: Astro 4.x (static-first, zero-JS by default)
- **Styling**: Tailwind CSS 3.x with custom design tokens
- **Icons**: Google Material Symbols Outlined
- **Fonts**: Libre Caslon Text (headings) + Hanken Grotesk (body)
- **Deployment**: Netlify (static output)

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Opens at `http://localhost:4321`

### Build

```bash
npm run build
```

Output in `dist/` — optimized, minified, and ready for deployment.

### Preview

```bash
npm run preview
```

Preview the production build locally before deployment.

## Project Structure

```
website/
├── public/
│   ├── images/         # Static images
│   ├── favicon.png     # Site favicon
│   └── og-image.png    # Social sharing image
├── src/
│   ├── components/     # Reusable Astro components
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── Hero.astro
│   │   ├── MobileNav.astro
│   │   ├── DesktopNav.astro
│   │   ├── PageLayout.astro
│   │   ├── ContactForm.astro
│   │   ├── ServiceCard.astro
│   │   ├── WorkflowStep.astro
│   │   └── KPIBlock.astro
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── pages/          # File-based routing
│   │   ├── index.astro     # Home
│   │   ├── services.astro  # Services catalog
│   │   ├── process.astro   # Workflows
│   │   ├── recruitment.astro # Recruitment & manpower
│   │   ├── contact.astro    # Contact & enquiry form
│   │   └── 404.astro       # Not found page
│   └── styles/
│       └── global.css   # Tailwind + custom utilities
├── astro.config.mjs
├── tailwind.config.mjs
├── tsconfig.json
└── package.json
```

## Pages

| Route | Description |
|-------|-------------|
| `/` | Home — hero, why us, services overview, KPIs |
| `/services` | Services — full catalog across 4 categories |
| `/process` | Process — 10-step recruitment + travel + courier workflows |
| `/recruitment` | Recruitment — hero, value props, workflow diagram |
| `/contact` | Contact — international reach, enquiry form, contact info |
| `/404` | Not found page |

## Deployment

### Netlify (Recommended)

1. Push to GitHub
2. Connect repository to Netlify
3. Build command: `npm run build`
4. Publish directory: `dist`

Or use `netlify.toml` for automatic configuration.

### Manual Deploy

```bash
npm run build
# Upload dist/ to your hosting provider
```

## Contact

**Merakian Global Services**
Dr. Kapil Songara
+91 9819990424
kapil.songara@merakian.net
www.merakian.net
