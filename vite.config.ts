import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Commit the site was built from: Vercel injects VERCEL_GIT_COMMIT_SHA at build time;
// local builds fall back to git (empty string when git is unavailable, e.g. a tarball)
function commitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

export default defineConfig({
  // GitHub Pages serves the fork under /<repo>/: the Pages workflow sets BASE_PATH; Vercel/local stay at /
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  define: {
    __COMMIT_SHA__: JSON.stringify(commitSha()),
    __APP_VERSION__: JSON.stringify((JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }).version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
})
