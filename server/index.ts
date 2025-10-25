import { createServer } from 'https';
import { parse } from 'url';
import next from 'next';
import fs from 'fs';
import { initSocketIO, initMediasoup } from './socket-server';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3002', 10);

const key = fs.readFileSync('/Users/abhishekshivale/Developer/webrtc-watch/certificates/localhost-key.pem');   // ✅ private key
const cert = fs.readFileSync('/Users/abhishekshivale/Developer/webrtc-watch/certificates/localhost.pem'); // ✅ public cert

const options = {
  key,
  cert
};

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(options, (req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  initSocketIO(httpServer);

  httpServer.on('error', (err: Error) => {
    console.error('Server error:', err);
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    initMediasoup()
  });
});