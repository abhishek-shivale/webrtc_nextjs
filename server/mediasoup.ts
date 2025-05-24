// Updated mediasoup.ts with proper network configuration
import * as mediasoup from "mediasoup";

export const createWorker = async () => {
  const worker = await mediasoup.createWorker({
    logLevel: 'debug', // Change to debug to see more info
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
  });
  
  worker.on('died', () => {
    console.error('mediasoup worker has died');
    process.exit(1);
  });
  
  return worker;
}

export const createRouter = async (worker: mediasoup.types.Worker) => {
  const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
    {
      kind: "audio" as mediasoup.types.MediaKind,
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: "video" as mediasoup.types.MediaKind,
      mimeType: "video/H264", // Try VP8 instead of H264
      clockRate: 90000,
    },
    {
      kind: "video" as mediasoup.types.MediaKind,
      mimeType: "video/H264",
      clockRate: 90000,
      parameters: {
        "packetization-mode": 1,
        "profile-level-id": "42e01f",
        "level-asymmetry-allowed": 1,
      },
    },
  ];

  const router = await worker.createRouter({ mediaCodecs });
  return router;
};

export const createTransport = async (router: mediasoup.types.Router) => {
  // Get your local IP address
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  
  // Find the first non-internal IPv4 address
  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIp = net.address;
        break;
      }
    }
  }

  console.log('Using local IP:', localIp);

  const transport: mediasoup.types.WebRtcTransport = await router.createWebRtcTransport({
    listenIps: [
      { ip: "0.0.0.0", announcedIp: localIp }, // Use your actual local IP
      { ip: "127.0.0.1" } // Fallback for localhost
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,

  });

  // Monitor transport events
  transport.on('icestatechange', (iceState) => {
    console.log('Transport ICE state changed:', iceState);
  });

  transport.on('iceselectedtuplechange', (iceSelectedTuple) => {
    console.log('ICE selected tuple changed:', iceSelectedTuple);
  });

  transport.on('dtlsstatechange', (dtlsState) => {
    console.log('Transport DTLS state changed:', dtlsState);
  });

  return transport;
};