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

[BrandHeader](../../frontend/src/components/BrandHeader.tsx) provides the Backline mark, home link, page navigation, language control and theme switch on app routes. The landing page keeps its own navigation. Login, OAuth callback and status use public links; protected routes use overview, server setup, moderation, activity and status links. Access enforcement remains in the existing route guards.

Every protected page is built from the same parts, exported from [`components/ui`](../../frontend/src/components/ui/index.ts):

| Part                                   | Purpose                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Page`, `PageHeader`, `Section`        | Main landmark with gutters, an eyebrow/title/description header with an actions slot, and titled sections             |
| `ServerSwitcher`                       | The server picker shown on every server-scoped page; selection lives in the guild store                              |
| `Input`, `Select`, `Textarea`, `Checkbox` | Labelled controls with hint and error text wired through `aria-describedby`; `compact` keeps short controls narrow |
| `Alert`                                | Inline message with icon and tone. Danger announces as `alert`, other tones as `status`; pass `role="none"` to opt out |
| `Badge`                                | Uppercase mono label for states and categories                                                                        |
| `Stat`                                 | Key figure inside a `<dl>`                                                                                            |
| `Table`                                | Scrollable data table with a hidden caption                                                                           |
| `EmptyState`                           | Why a list is empty and what to do next                                                                               |
| `Button`, `Card`, `StatCard`, skeletons | Existing primitives, unchanged                                                                                       |

Plain elements can adopt the same look through classes in [the global stylesheet](../../frontend/src/index.css): `bl-button-primary`, `bl-button-secondary`, `bl-button-danger` and `bl-button-sm` for buttons and links; `bl-input`, `bl-input-compact`, `bl-label`, `bl-check`, `bl-legend`, `bl-hint` for forms; `bl-form-notice` and `bl-form-alert` for inline form results; `bl-badge-*`, `bl-alert-*`, `bl-chip`, `bl-eyebrow-app`, `bl-details`, `bl-stat` and `bl-table` for the rest. The module configuration forms use these classes rather than ad-hoc utilities.

Chart colors come from [design helpers](../../frontend/src/lib/design.ts); canvas graphs and image exports resolve the CSS tokens to actual colors.

The app honors reduced-motion preferences through Framer Motion and CSS. Focus outlines remain visible. Tables sit inside `bl-table-wrap` overflow containers; navigation wraps at narrow widths.

## Page patterns

- **Overview** (`/overview`) summarizes the selected server: enabled modules by category, modules waiting on the operator, moderation actions still in flight, API service state, and the five most recent cases. It reads existing endpoints only.
- **Server setup** (`/servers`) is a module catalog. Modules are grouped by the categories in [`lib/modules.ts`](../../frontend/src/lib/modules.ts) (community, safety, engagement, automation, operator), each card shows a state badge (`Enabled`, `Off`, `Needs operator`), and settings or history open inside a `details` disclosure that starts collapsed. A search box and state chips narrow the list. The Enable/Disable control keeps its `aria-pressed` state.
- **Moderation** (`/moderation`) uses a two-column form with hints, a primary submit and a secondary refresh, and a table of cases with state badges. Request-key reuse and locking behavior are unchanged.
- **Status** and **Activity** keep their data and copy, wrapped in the shared page header and cards.

Each server-scoped page reads the manageable server list through [`useServers`](../../frontend/src/hooks/useServers.ts). Server setup uses `sync` mode, which clears a selection that is no longer manageable; other pages use `passive` mode so a failed read never drops the current server.

## Verification boundaries

Use frontend lint, tests and a production build for changes. Browser checks should cover login, overview, server setup, moderation, status, activity, theme changes, narrow layouts and generated font/logo loading. Fixture API responses can verify layout without live Discord credentials, but do not qualify OAuth, authorization or Discord delivery.
