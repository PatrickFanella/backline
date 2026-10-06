# Backline app design system

The app extends the selected Poster Crew identity in [BACKLINE.md](./BACKLINE.md). Brand masters, logos and licensed fonts remain owned by SUBCULT Studio. Product styles use the generated assets; changing dashboard tokens does not modify those masters.

## Tokens and themes

[Global CSS](../../frontend/src/index.css) owns theme values. [Tailwind configuration](../../frontend/tailwind.config.js) exposes them as `bl` utilities with opacity support. Light mode uses warm paper with dark ink; dark mode uses ink with paper text. Light, dark and system selection retain the existing storage and keyboard shortcut.

| Role                                             | Use                                                   |
| ------------------------------------------------ | ----------------------------------------------------- |
| `canvas`, `recessed`, `deep`                     | Page backgrounds and nested regions                   |
| `panel`, `surface`                               | Cards, inputs and secondary controls                  |
| `ink`, `muted`                                   | Primary and supporting text                           |
| `border`                                         | Panel and input boundaries                            |
| `accent`                                         | Purple links, focus indicators and chart marks        |
| `action`                                         | Solid purple backgrounds with white labels            |
| `success`, `warning`, `danger`                   | Theme-aware status text and subtle status backgrounds |
| `success-solid`, `warning-solid`, `danger-solid` | Solid status backgrounds with white labels            |

Use semantic roles for new components. Do not add Catppuccin classes or fixed gray/blue palettes. Keep `accent` separate from `action`: dark mode lightens accent text, while action backgrounds stay dark enough for white labels. Status meanings also need text or icons, rather than color alone.

The landing page retains its scoped paper composition and original purple and green identity colors. Dashboard variations provide readable text and action contrast for denser layouts in both themes.

## Typography and layout

Oswald Bold is the heading and wordmark face. Space Grotesk is the body and control face. JetBrains Mono is for code and technical labels. All three are self-hosted globally through the shared font stylesheet. The VitePress site reads the same generated public assets and uses the Backline fonts and palette. Use Tailwind's normal type scale: small supporting text, base body text, extra-large section headings and three-extra-large page headings.

Keep page content inside the existing maximum-width containers. Use 16px mobile gutters and 32px desktop gutters, with 16–32px spacing between sections. Outlined panels use small corners; shared cards add a restrained offset shadow. Reserve circles for avatars, status dots and compact icon badges.

## Components and application shell

[BrandHeader](../../frontend/src/components/BrandHeader.tsx) provides the Backline mark, home link, page navigation, language control and theme switch on app routes. The landing page keeps its own navigation. Login, OAuth callback and status use public links; protected routes use server setup, moderation, activity and status links. Access enforcement remains in the existing route guards.

Shared buttons support primary, secondary, danger and ghost states. Preserve labels, keyboard focus, disabled states and loading feedback. Shared cards, statistics, skeletons, toasts, settings forms and analytics use the same palette. Chart colors come from [design helpers](../../frontend/src/lib/design.ts); canvas graphs and image exports resolve the CSS tokens to actual colors.

The app honors reduced-motion preferences through Framer Motion and CSS. Focus outlines remain visible. Tables retain their existing overflow containers; navigation wraps at narrow widths.

## Verification boundaries

Use frontend lint, tests and a production build for changes. Browser checks should cover login, server setup, status, activity, theme changes, narrow layouts and generated font/logo loading. Fixture API responses can verify layout without live Discord credentials, but do not qualify OAuth, authorization or Discord delivery.
