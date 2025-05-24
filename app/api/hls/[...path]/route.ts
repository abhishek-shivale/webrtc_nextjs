// pages/api/hls/[...path].ts (or app/api/hls/[...path]/route.ts for App Router)
import { NextApiRequest, NextApiResponse } from 'next';
import { createReadStream, existsSync, statSync } from 'fs';
import path from 'path';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { path: hlsPath } = req.query;
  
  if (!hlsPath || !Array.isArray(hlsPath)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const filePath = path.join(process.cwd(), 'public', 'hls', ...hlsPath);
  
  // Security check - ensure path is within hls directory
  if (!filePath.startsWith(path.join(process.cwd(), 'public', 'hls'))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!existsSync(filePath)) {
    console.log('HLS file not found:', filePath);
    return res.status(404).json({ error: 'File not found' });
  }

  const stat = statSync(filePath);
  const fileExtension = path.extname(filePath);

  // Set appropriate headers
  if (fileExtension === '.m3u8') {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  } else if (fileExtension === '.ts') {
    res.setHeader('Content-Type', 'video/mp2t');
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Length', stat.size);

  // Stream the file
  const stream = createReadStream(filePath);
  stream.pipe(res);
}