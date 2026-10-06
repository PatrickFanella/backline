# Frontend Documentation: Backline UI

This frontend is built using **React** with **TypeScript** and bundled by **Vite**. It serves as the visual interface for interacting with the Backline backend.

---

## 📦 Project Stack

**Main Technologies:**

- React + TypeScript
- Tailwind CSS for styling
- Vite for fast builds and hot reloads
- REST API communication with the backend

---

## 📁 Folder Structure Overview

**Key Directories:**

- `src/pages/`: Top-level views (dashboard, login, settings, etc.)
- `src/components/`: Reusable UI components (charts, cards, nav)
- `src/context/`: React contexts for global state (like theme)
- `src/hooks/`: Custom React hooks for logic reuse
- `src/lib/`: Utility functions for interacting with the API

---

## 🧭 Routing

Pages are organized in the `src/pages/` directory and handled via React Router (or similar). Each page represents a route such as:

- `/` – Home or landing page
- `/dashboard` – Displays analytics and live data
- `/login` – Initiates Discord OAuth login flow
- `/settings` – User or admin settings for configuration

---

## 🔌 API Integration

The frontend communicates with the backend via REST APIs. Common endpoints include:

- `GET /ghosts` – Show inactive users
- `GET /lurkers` – Analyze passive viewers
- `GET /clients` – Show multi-device activity
- `GET /heatmap` – Visualize activity over time
- `GET /me` – Get authenticated user info (after login)

These calls are made using helper functions in `src/lib/` and consumed in the pages.

---

## 🎨 Styling

Tailwind CSS is used for all styling. Utility classes are applied directly to JSX elements to manage layout, spacing, and typography.

---

## 🔐 Authentication

- Users authenticate via Discord OAuth.
- On login, an access token and refresh token are received and stored in cookies or local storage.
- Protected routes like `/dashboard` require a valid session.

---

## 🧠 Global State

React Context is used for managing global state, including:

- Theme (dark/light)
- User session info
- Possibly active guild or permissions

---

## 🧪 Development

**To run the frontend locally:**

```bash
npm install
npm run dev
```

Make sure your `.env` includes the correct API base URL (likely pointing to `localhost:3001`).

---

## 🌐 Deployment

This app can be built and served using Vite:

```bash
npm run build
```

This creates a static output in `dist/` which can be deployed to platforms like Netlify, Vercel, or GitHub Pages.

---

This documentation summarizes the technical structure and intent of the frontend codebase for Backline. Reach out if you'd like visual diagrams, onboarding guides, or admin panel walkthroughs.
