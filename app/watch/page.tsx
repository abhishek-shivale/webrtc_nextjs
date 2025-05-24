"use client";
import { useContext, useEffect, useRef, useState } from "react";
import { SocketContext } from "@/context/socket-context";

interface StreamInfo {
  streamId: string;
  playlistUrl: string;
  streamers: string[];
  isLive: boolean;
}

export default function WatchPage() {
  const { socket } = useContext(SocketContext);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeStreams, setActiveStreams] = useState<StreamInfo[]>([]);
  const [selectedStream, setSelectedStream] = useState<StreamInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get available streams
  useEffect(() => {
    if (!socket) return;

    const getStreams = async () => {
      try {
        const response = await socket.emitWithAck("getActiveStreams");
        if (response.streams) {
          setActiveStreams(response.streams);
        }
      } catch (error) {
        console.error("Error getting streams:", error);
      }
    };

    getStreams();

    // Listen for stream updates
    const handleStreamLive = (data: { streamId: string; playlistUrl: string; streamers: string[] }) => {
      setActiveStreams(prev => {
        const filtered = prev.filter(s => s.streamId !== data.streamId);
        return [...filtered, { ...data, isLive: true }];
      });
    };

    const handleStreamEnded = (data: { streamId: string }) => {
      setActiveStreams(prev => prev.filter(s => s.streamId !== data.streamId));
      if (selectedStream?.streamId === data.streamId) {
        setSelectedStream(null);
        setError("Stream ended");
      }
    };

    socket.on("streamLive", handleStreamLive);
    socket.on("streamEnded", handleStreamEnded);

    // Refresh streams every 10 seconds
    const interval = setInterval(getStreams, 10000);

    return () => {
      socket.off("streamLive", handleStreamLive);
      socket.off("streamEnded", handleStreamEnded);
      clearInterval(interval);
    };
  }, [socket, selectedStream]);

  const watchStream = async (stream: StreamInfo) => {
    if (!videoRef.current) return;

    setIsLoading(true);
    setError(null);
    setSelectedStream(stream);

    try {
      const video = videoRef.current;
      
      console.log('Attempting to play stream:', stream.playlistUrl);
      
      // Test if the playlist URL is accessible
      try {
        const response = await fetch(stream.playlistUrl);
        console.log('Playlist response:', response.status, response.statusText);
        
        if (!response.ok) {
          throw new Error(`Playlist not accessible: ${response.status} ${response.statusText}`);
        }
        
        const content = await response.text();
        console.log('Playlist content preview:', content.substring(0, 200));
      } catch (fetchError) {
        console.error('Error fetching playlist:', fetchError);
        setError(`Cannot access playlist: ${fetchError}`);
        setIsLoading(false);
        return;
      }
      
      // Check if HLS is supported
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        console.log('Using native HLS support');
        video.src = stream.playlistUrl;
      } else {
        // Use HLS.js for other browsers
        console.log('Using HLS.js');
        const { default: Hls } = await import('hls.js');
        
        if (Hls.isSupported()) {
          const hls = new Hls({
            debug: true, // Enable debug logging
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90,
            maxBufferLength: 30,
            maxMaxBufferLength: 600,
            maxBufferSize: 60 * 1000 * 1000,
            maxBufferHole: 0.5,
          });
          
          hls.on(Hls.Events.MEDIA_ATTACHING, () => {
            console.log('HLS: Media attaching');
          });
          
          hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            console.log('HLS: Media attached');
          });
          
          hls.on(Hls.Events.MANIFEST_LOADING, () => {
            console.log('HLS: Manifest loading');
          });
          
          hls.loadSource(stream.playlistUrl);
          hls.attachMedia(video);
          
          hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
            console.log('HLS manifest parsed:', data);
            video.play().catch(err => {
              console.error('Play failed:', err);
              setError(`Playback failed: ${err.message}`);
            });
          });
          
          hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS error:', event, data);
            
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  setError(`Network error: ${data.details}`);
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  setError(`Media error: ${data.details}`);
                  break;
                default:
                  setError(`Fatal error: ${data.details}`);
                  break;
              }
            } else {
              console.warn('Non-fatal HLS error:', data);
            }
          });
          
          // Store hls instance for cleanup
          (video as any).hls = hls;
        } else {
          setError("HLS not supported in this browser");
        }
      }

      video.addEventListener('loadstart', () => {
        console.log("Video loading started");
      });

      video.addEventListener('canplay', () => {
        setIsLoading(false);
        console.log("Video can play");
      });

      video.addEventListener('error', (e) => {
        setError("Video playback error");
        setIsLoading(false);
        console.error("Video error:", e);
      });

    } catch (error) {
      setError(`Failed to load stream: ${error}`);
      setIsLoading(false);
      console.error('Watch stream error:', error);
    }
  };

  const stopWatching = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      
      // Cleanup HLS.js if used
      if ((video as any).hls) {
        (video as any).hls.destroy();
        (video as any).hls = null;
      }
      
      video.src = '';
      video.load();
    }
    
    setSelectedStream(null);
    setError(null);
    setIsLoading(false);
  };

  return (
    <div style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
      <h1>Live Streams</h1>
      
      {/* Stream Selection */}
      <div style={{ marginBottom: "20px" }}>
        <h3>Available Streams ({activeStreams.length})</h3>
        {activeStreams.length === 0 ? (
          <p style={{ color: "#666" }}>No live streams available</p>
        ) : (
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", 
            gap: "15px" 
          }}>
            {activeStreams.map((stream) => (
              <div
                key={stream.streamId}
                style={{
                  border: "2px solid #007bff",
                  borderRadius: "8px",
                  padding: "15px",
                  cursor: "pointer",
                  backgroundColor: selectedStream?.streamId === stream.streamId ? "#e3f2fd" : "#f9f9f9"
                }}
                onClick={() => watchStream(stream)}
              >
                <h4 style={{ margin: "0 0 10px 0" }}>Stream: {stream.streamId}</h4>
                <p style={{ margin: "5px 0", fontSize: "14px", color: "#666" }}>
                  Streamers: {stream.streamers.join(", ")}
                </p>
                <div style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "space-between" 
                }}>
                  <span style={{ 
                    color: stream.isLive ? "#00aa00" : "#ff4444",
                    fontSize: "12px",
                    fontWeight: "bold"
                  }}>
                    {stream.isLive ? "🔴 LIVE" : "⚪ OFFLINE"}
                  </span>
                  <button
                    style={{
                      padding: "5px 15px",
                      backgroundColor: "#007bff",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer"
                    }}
                  >
                    Watch
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Video Player */}
      <div style={{ marginTop: "30px" }}>
        {selectedStream && (
          <div style={{ marginBottom: "15px" }}>
            <h3>Now Watching: {selectedStream.streamId}</h3>
            <button
              onClick={stopWatching}
              style={{
                padding: "8px 16px",
                backgroundColor: "#dc3545",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer"
              }}
            >
              Stop Watching
            </button>
          </div>
        )}
        
        <video
          ref={videoRef}
          controls
          autoPlay
          muted
          style={{
            width: "100%",
            maxWidth: "800px",
            height: "450px",
            backgroundColor: "#000",
            border: "2px solid #ccc",
            borderRadius: "8px",
            display: selectedStream ? "block" : "none"
          }}
        />
        
        {isLoading && (
          <div style={{ 
            textAlign: "center", 
            padding: "50px", 
            fontSize: "18px", 
            color: "#666" 
          }}>
            Loading stream...
          </div>
        )}
        
        {error && (
          <div style={{ 
            textAlign: "center", 
            padding: "50px", 
            fontSize: "16px", 
            color: "#ff4444" 
          }}>
            Error: {error}
          </div>
        )}
        
        {!selectedStream && !isLoading && !error && (
          <div style={{ 
            textAlign: "center", 
            padding: "50px", 
            fontSize: "18px", 
            color: "#666",
            border: "2px dashed #ccc",
            borderRadius: "8px"
          }}>
            Select a stream to start watching
          </div>
        )}
      </div>
    </div>
  );
}