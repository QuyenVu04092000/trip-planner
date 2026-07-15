import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// When building on GitHub Actions, GITHUB_REPOSITORY = "username/repo-name"
// → base becomes "/repo-name/" so assets load correctly on GitHub Pages.
// Locally (no GITHUB_REPOSITORY set) → base is "/" as normal.
const base = process.env.GITHUB_REPOSITORY
  ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
  : '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5179 },
});
