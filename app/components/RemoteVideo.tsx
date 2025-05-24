import { RemoteStream } from "@/utils/socket";
import { useEffect, useRef, useState } from "react";

export default function RemoteVideo({
  remoteStream,
}: {
  remoteStream: RemoteStream;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;

    // Reset states
    setIsPlaying(false);
    setError(null);

    if (!video) {
      console.log("No video element found");
      return;
    }

    if (!remoteStream?.consumer) {
      console.log("No consumer found");
      setError("No consumer available");
      return;
    }

    const { track } = remoteStream.consumer;

    if (!track) {
      console.error("No track found in consumer");
      setError("No track available");
      return;
    }

    if (track.readyState === "ended") {
      console.error("Track has ended");
      setError("Track has ended");
      return;
    }

    console.log(`📹 Setting up remote stream for ${remoteStream.id}`);
    console.log("Track state:", track.readyState);
    console.log("Track kind:", track.kind);
    console.log("Track enabled:", track.enabled);
    console.log("Track muted:", track.muted);
    console.log("Consumer paused:", remoteStream.consumer.paused);
    console.log("Consumer kind:", remoteStream.consumer.kind);

    // Create new MediaStream with the track
    const mediaStream = new MediaStream([track]);
    console.log("MediaStream created:", mediaStream);
    console.log("MediaStream active:", mediaStream.active);
    console.log("MediaStream tracks:", mediaStream.getTracks().length);

    video.srcObject = mediaStream;
    console.log("Video srcObject set:", video.srcObject);

    // Additional debugging for track events
    const handleTrackEnded = () => {
      console.log(`Track ended for ${remoteStream.id}`);
      setError("Track ended");
    };

    const handleTrackMute = () => {
      console.log(`Track muted for ${remoteStream.id}`);
    };

    const handleTrackUnmute = () => {
      console.log(`Track unmuted for ${remoteStream.id}`);
    };

    track.addEventListener('ended', handleTrackEnded);
    track.addEventListener('mute', handleTrackMute);
    track.addEventListener('unmute', handleTrackUnmute);

    // Handle muted track
    if (track.muted) {
      console.warn(`Track is muted for ${remoteStream.id} - waiting for unmute`);
      setError("Track is muted - waiting for video data");
      
      // Set up a timeout to wait for unmute
      const unmuteTimeout = setTimeout(() => {
        if (track.muted) {
          console.error(`Track remained muted for ${remoteStream.id}`);
          setError("Video track is muted");
        }
      }, 10000); // Wait 10 seconds for unmute
      
      const handleTrackUnmuteOnce = () => {
        clearTimeout(unmuteTimeout);
        console.log(`Track unmuted for ${remoteStream.id}`);
        setError(null);
        track.removeEventListener('unmute', handleTrackUnmuteOnce);
      };
      
      track.addEventListener('unmute', handleTrackUnmuteOnce);
    }

    const handleCanPlay = () => {
      console.log(`🎬 Video can play for ${remoteStream.id}`);
      video
        .play()
        .then(() => {
          console.log(`✅ Playback started for ${remoteStream.id}`);
          setIsPlaying(true);
        })
        .catch((err) => {
          console.error(`❌ Failed to play video for ${remoteStream.id}:`, err);
          setError(`Playback failed: ${err.message}`);
        });
    };

    const handleError = (e: Event) => {
      console.error("Video error:", e);
      setError("Video playback error");
    };

    const handleLoadStart = () => {
      console.log(`📡 Loading started for ${remoteStream.id}`);
    };

    const handleLoadedData = () => {
      console.log(`📊 Data loaded for ${remoteStream.id}`);
    };

    const handleLoadedMetadata = () => {
      console.log(`📐 Metadata loaded for ${remoteStream.id}`);
      console.log("Video dimensions:", video.videoWidth, "x", video.videoHeight);
    };

    // Add event listeners
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("error", handleError);
    video.addEventListener("loadstart", handleLoadStart);
    video.addEventListener("loadeddata", handleLoadedData);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);

    // Debug video state periodically
    const debugInterval = setInterval(() => {
      if(!remoteStream.consumer) return
      console.log(`Debug ${remoteStream.id}:`, {
        readyState: video.readyState,
        networkState: video.networkState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        paused: video.paused,
        trackState: track.readyState,
        trackEnabled: track.enabled,
        trackMuted: track.muted,
        consumerPaused: remoteStream.consumer.paused
      });
    }, 3000);

    return () => {
      console.log(`🧹 Cleaning up video for ${remoteStream.id}`);

      clearInterval(debugInterval);

      // Remove track event listeners
      track.removeEventListener('ended', handleTrackEnded);
      track.removeEventListener('mute', handleTrackMute);
      track.removeEventListener('unmute', handleTrackUnmute);

      // Remove video event listeners
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("error", handleError);
      video.removeEventListener("loadstart", handleLoadStart);
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);

      // Clean up video source
      if (video.srcObject) {
        const tracks = (video.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => {
          console.log("Stopping track:", track.id);
          track.stop();
        });
        video.srcObject = null;
      }

      setIsPlaying(false);
      setError(null);
    };
  }, [remoteStream?.consumer, remoteStream?.id]);

  return (
    <div style={{ textAlign: "center" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "300px",
          height: "200px",
          backgroundColor: "#000",
          border: `2px solid ${
            error ? "#ff4444" : isPlaying ? "#00ff00" : "#007bff"
          }`,
        }}
      />
      <p>Stream from: {remoteStream?.id || "Unknown"}</p>
      <p style={{ fontSize: "12px", color: "#666" }}>
        Producer: {remoteStream?.producerId || "Unknown"}
      </p>
      <p
        style={{
          fontSize: "10px",
          color: isPlaying ? "#00aa00" : error ? "#ff4444" : "#666",
        }}
      >
        Status: {error || (isPlaying ? "Playing" : "Loading...")}
      </p>
    </div>
  );
}