// Alternative approach: Use MediaSoup's built-in recording capabilities
// ffmpeg-recorder-v2.ts
import { spawn, ChildProcess } from 'child_process';
import * as mediasoup from 'mediasoup';
import * as fs from 'fs';
import * as path from 'path';

export class HLSRecorderV2 {
  private ffmpegProcess: ChildProcess | null = null;
  private isRecording = false;
  private outputPath: string;
  private streamKey: string;
  private transport: mediasoup.types.PlainTransport | null = null;
  private consumer: mediasoup.types.Consumer | null = null;

  constructor(streamKey: string) {
    this.streamKey = streamKey;
    this.outputPath = path.join(process.cwd(), 'public', 'hls', streamKey);
    
    // Create HLS directory if it doesn't exist
    if (!fs.existsSync(this.outputPath)) {
      fs.mkdirSync(this.outputPath, { recursive: true });
    }
  }

  async startRecording(router: mediasoup.types.Router, producers: Map<string, any>) {
    if (this.isRecording) {
      console.log('Already recording');
      return;
    }

    try {
      const videoProducers = Array.from(producers.values()).filter(
        p => p.producer.kind === 'video'
      );

      if (videoProducers.length === 0) {
        throw new Error('No video producers found');
      }

      const videoProducer = videoProducers[0].producer;
      console.log('Starting recording for producer:', videoProducer.id);

      // Create PlainTransport with better configuration
      this.transport = await router.createPlainTransport({
        listenIp: { ip: '0.0.0.0', announcedIp: '127.0.0.1' },
        rtcpMux: false,
        comedia: true, // Let the receiver (FFmpeg) initiate the connection
        enableSctp: false,
        enableSrtp: false,
      });

      // Get RTP capabilities from the router
      const rtpCapabilities = router.rtpCapabilities;

      // Create consumer
      this.consumer = await this.transport.consume({
        producerId: videoProducer.id,
        rtpCapabilities,
        paused: true,
      });

      console.log('Consumer created:', this.consumer.id);
      console.log('Consumer RTP parameters:', this.consumer.rtpParameters);

      // Get the transport tuple info
      const { localPort, localIp } = this.transport.tuple;
      console.log(`Transport listening on ${localIp}:${localPort}`);

      // Start FFmpeg with a more robust configuration
      const ffmpegArgs = [
        // Input configuration
        '-protocol_whitelist', 'pipe,udp,rtp,file',
        '-fflags', '+genpts+igndts',
        '-thread_queue_size', '1024',
        '-f', 'rtp',
        '-buffer_size', '65536',
        '-i', `rtp://127.0.0.1:${localPort}`,
        
        // Video encoding
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-profile:v', 'baseline',
        '-level', '3.0',
        '-pix_fmt', 'yuv420p',
        '-g', '60',
        '-keyint_min', '60',
        '-sc_threshold', '0',
        '-b:v', '1000k',
        '-maxrate', '1200k',
        '-bufsize', '2000k',
        
        // HLS output
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '5',
        '-hls_flags', 'delete_segments+independent_segments',
        '-hls_start_number_source', 'epoch',
        '-hls_segment_filename', path.join(this.outputPath, 'segment_%03d.ts'),
        path.join(this.outputPath, 'playlist.m3u8')
      ];

      console.log('Starting FFmpeg...');
      
      this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

      // Set up event handlers
      this.setupFFmpegHandlers();

      // Wait for FFmpeg to be ready, then connect transport
      setTimeout(async () => {
        try {
          console.log('Connecting transport...');
          await this.transport!.connect({
            ip: '127.0.0.1',
            port: localPort,
          });
          
          console.log('Resuming consumer...');
          await this.consumer!.resume();
          
          console.log('✅ HLS recording pipeline established');
          this.isRecording = true;
          
        } catch (error) {
          console.error('Error in delayed setup:', error);
          this.stopRecording();
        }
      }, 3000);

    } catch (error) {
      console.error('Error starting HLS recording:', error);
      this.cleanup();
      throw error;
    }
  }

  private setupFFmpegHandlers() {
    if (!this.ffmpegProcess) return;

    this.ffmpegProcess.stdout?.on('data', (data) => {
      console.log('FFmpeg stdout:', data.toString().trim());
    });

    this.ffmpegProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      
      // Log important events
      if (output.includes('Stream #') || 
          output.includes('Video:') ||
          output.includes('Opening') ||
          output.includes('fps=')) {
        console.log('FFmpeg:', output.trim());
      }
      
      // Check for success indicators
      if (output.includes('fps=') && output.includes('frame=')) {
        if (!this.isRecording) {
          console.log('✅ FFmpeg started processing frames');
          this.isRecording = true;
        }
      }
      
      // Log errors
      if (output.includes('Error') || output.includes('Failed')) {
        console.error('FFmpeg error:', output.trim());
      }
    });

    this.ffmpegProcess.on('error', (error) => {
      console.error('FFmpeg process error:', error);
      this.cleanup();
    });

    this.ffmpegProcess.on('close', (code) => {
      console.log(`FFmpeg process closed with code ${code}`);
      this.cleanup();
    });
  }

  stopRecording() {
    console.log('Stopping HLS recording...');
    this.cleanup();
  }

  private cleanup() {
    this.isRecording = false;
    
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGTERM');
      this.ffmpegProcess = null;
    }
    
    if (this.consumer) {
      this.consumer.close();
      this.consumer = null;
    }
    
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
    
    console.log(`HLS recording cleanup completed for ${this.streamKey}`);
  }

  getPlaylistUrl() {
    return `/api/hls/${this.streamKey}/playlist.m3u8`;
  }

  isActive() {
    return this.isRecording;
  }

  checkFiles() {
    const playlistPath = path.join(this.outputPath, 'playlist.m3u8');
    const segmentPath = path.join(this.outputPath, 'segment_000.ts');
    
    return {
      playlistExists: fs.existsSync(playlistPath),
      hasSegments: fs.existsSync(segmentPath),
      outputPath: this.outputPath,
      playlistPath
    };
  }
}