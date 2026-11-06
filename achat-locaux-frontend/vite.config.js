const { defineConfig, loadEnv } = require('vite');
const fs = require('fs');
const path = require('path');

module.exports = defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  const apiBaseUrl = env.VITE_API_BASE_URL || (
    command === 'serve' ? 'http://localhost:8000' : ''
  );

  return {
    root: path.resolve(__dirname, 'public'),
    envDir: __dirname,
    publicDir: false,
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: apiBaseUrl || 'http://localhost:8000',
          changeOrigin: true
        }
      },
      fs: {
        allow: [path.resolve(__dirname)]
      }
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'public/index.html')
      }
    },
    plugins: [
      {
        name: 'serve-existing-public-index',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const requestPath = new URL(request.url, 'http://localhost').pathname;
            if (requestPath.startsWith('/src/')) {
              const relativePath = decodeURIComponent(requestPath.slice('/src/'.length));
              const sourceRoot = path.resolve(__dirname, 'src');
              const sourceFile = path.resolve(sourceRoot, relativePath);

              if (sourceFile.startsWith(`${sourceRoot}${path.sep}`) && fs.existsSync(sourceFile)) {
                const contentTypes = {
                  '.css': 'text/css',
                  '.js': 'application/javascript',
                  '.json': 'application/json'
                };
                response.setHeader('Content-Type', contentTypes[path.extname(sourceFile)] || 'application/octet-stream');
                fs.createReadStream(sourceFile).pipe(response);
                return;
              }
            }

            if (requestPath === '/pageachat.html') {
              const templateFile = path.resolve(__dirname, 'pageachat.html');
              if (fs.existsSync(templateFile)) {
                response.setHeader('Content-Type', 'text/html; charset=utf-8');
                fs.createReadStream(templateFile).pipe(response);
                return;
              }
            }

            if (request.url === '/' || request.url === '/index.html') {
              response.setHeader('Content-Type', 'text/html');
              response.end(fs.readFileSync(path.resolve(__dirname, 'public/index.html')));
              return;
            }
            next();
          });
        }
      },
      {
        name: 'prepare-legacy-static-assets',
        apply: 'build',
        transformIndexHtml(html) {
          return html.replaceAll('../src/', '/src/');
        },
        closeBundle() {
          const sourceDir = path.resolve(__dirname, 'src');
          const outputDir = path.resolve(__dirname, 'dist/src');
          fs.cpSync(sourceDir, outputDir, { recursive: true });
          fs.copyFileSync(
            path.resolve(__dirname, 'pageachat.html'),
            path.resolve(__dirname, 'dist/pageachat.html')
          );
        }
      }
    ],
    define: {
      '__VITE_API_BASE_URL__': JSON.stringify(apiBaseUrl)
    }
  };
});