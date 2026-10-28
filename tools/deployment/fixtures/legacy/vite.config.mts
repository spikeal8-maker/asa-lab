import { defineConfig } from 'vite';
import { writeFileSync } from 'node:fs';

// Actual Vite, actual published portal assets, actual API. The legacy server
// lacked an authoritative metadata route; a SPA fallback must remain unknown.
writeFileSync('/workspace/review-writable-marker', 'web-review-vite-state\n');

export default defineConfig({
  root: '/workspace/apps/web/src',
  cacheDir: '/tmp/asa-legacy-vite-cache',
  plugins: [
    {
      name: 'legacy-metadata-spa-fallback-fixture',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url === '/build-metadata.json') request.url = '/index.html';
          next();
        });
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true,
    proxy: {
      '/api': 'http://api:4611',
      '/health': 'http://api:4611',
      '/internal/blocks': {
        target: 'http://scratch:8080',
        rewrite: (path) => path.replace(/^\/internal\/blocks/, ''),
      },
    },
  },
});
