// Serves a static web export with SPA fallback. Usage: node e2e/serve-dist.js <distDir> [port=8081]
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 8081);
const types = { '.js': 'text/javascript', '.html': 'text/html', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
http
  .createServer((req, res) => {
    let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, 'index.html');
    res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
    fs.createReadStream(p).pipe(res);
  })
  .listen(port, () => console.log(`serving ${root} on :${port}`));
