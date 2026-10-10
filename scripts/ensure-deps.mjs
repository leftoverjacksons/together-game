// Installs dependencies if they are missing, so `npm run build` works even when
// the host's build command does not run `npm install` first (e.g. a Render
// service whose build command predates this setup).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const missing = ['esbuild', 'pixi.js', 'planck', 'ws'].filter(name => {
  try { require.resolve(name); return false; } catch { return true; }
});
if (missing.length) {
  console.log(`Installing dependencies (missing: ${missing.join(', ')})`);
  execSync('npm ci --include=dev', { stdio: 'inherit' });
}
