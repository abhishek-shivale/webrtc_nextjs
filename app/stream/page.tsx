"use client";
import { useContext, useEffect, useRef, useState } from "react";
import { SocketContext } from "@/context/socket-context";
import { Device } from "mediasoup-client";
import type { Transport, Producer, Consumer } from "mediasoup-client/types";
import { RemoteStream } from "@/utils/socket";
import RemoteVideo from "../components/RemoteVideo";

function Stream() {
  const { socket } = useContext(SocketContext);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [hlsStreamId, setHlsStreamId] = useState<string | null>(null);
  const [isHlsEnabled, setIsHlsEnabled] = useState(false);
  // Core MediaSoup objects
  const [device, setDevice] = useState<Device | null>(null);
  const [producerTransport, setProducerTransport] = useState<Transport | null>(
    null
  );
  const [consumerTransport, setConsumerTransport] = useState<Transport | null>(
    null
  );
  const [producer, setProducer] = useState<Producer | null>(null);

  // Streams and UI state
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startHLSBroadcast = async () => {
    if (!socket || !producer) {
      console.error("Socket or producer not ready");
      return;
    }

    try {
      const streamId = `stream_${socket.id}_${Date.now()}`;
      const response = await socket.emitWithAck("startHLSStream", { streamId });

      if (response.success) {
        setHlsStreamId(streamId);
        setIsHlsEnabled(true);
        console.log("HLS stream started:", streamId);
        console.log("Playlist URL:", response.playlistUrl);
      } else {
        console.error("Failed to start HLS stream:", response.error);
      }
    } catch (error) {
      console.error("Error starting HLS stream:", error);
    }
  };

  const stopHLSBroadcast = async () => {
    if (!socket || !hlsStreamId) return;

    try {
      await socket.emitWithAck("stopHLSStream", { streamId: hlsStreamId });
      setHlsStreamId(null);
      setIsHlsEnabled(false);
      console.log("HLS stream stopped");
    } catch (error) {
      console.error("Error stopping HLS stream:", error);
    }
  };

  // Get user media permissions
  const getLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error("Error getting user media:", error);
      throw new Error(`Camera/microphone access denied: ${error}`);
    }
  };

  // Initialize MediaSoup device
  const initializeDevice = async () => {
    try {
      if (!socket) throw new Error("Socket not connected");

      const newDevice = new Device();
      const response = await socket.emitWithAck("rtpCapabilities");

      if (!response?.rtpCapabilities) {
        throw new Error("Failed to get RTP capabilities from server");
      }

      await newDevice.load({ routerRtpCapabilities: response.rtpCapabilities });
      socket.emit("setRtpCapabilities", newDevice.rtpCapabilities);

      setDevice(newDevice);
      return newDevice;
    } catch (error) {
      console.error("Error initializing device:", error);
      throw error;
    }
  };

  // Create producer transport
  const createProducerTransport = async (device: Device) => {
    try {
      if (!socket) throw new Error("Socket not connected");

      const transportOptions = await socket.emitWithAck(
        "createProducerTransport"
      );

      if (transportOptions.error) {
        throw new Error(transportOptions.error);
      }

      const transport = device.createSendTransport(transportOptions);

      transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
        try {
          const result = await socket.emitWithAck("connectProducerTransport", {
            dtlsParameters,
          });
          if (result.error) {
            throw new Error(result.error);
          }
          callback();
        } catch (error) {
          errback(error instanceof Error ? error : new Error(String(error)));
        }
      });

      transport.on(
        "produce",
        async ({ kind, rtpParameters }, callback, errback) => {
          try {
            const result = await socket.emitWithAck("produce", {
              kind,
              rtpParameters,
            });
            if (result.error) {
              throw new Error(result.error);
            }
            callback({ id: result.id });
          } catch (error) {
            errback(error instanceof Error ? error : new Error(String(error)));
          }
        }
      );

      // Check current state
      console.log("Current transport state:", transport.connectionState);

      setProducerTransport(transport);
      return transport;
    } catch (error) {
      console.error("Error creating producer transport:", error);
      throw error;
    }
  };

  // Create consumer transport
  const createConsumerTransport = async (device: Device) => {
    try {
      if (!socket) throw new Error("Socket not connected");

      const transportOptions = await socket.emitWithAck(
        "createConsumerTransport"
      );

      if (transportOptions.error) {
        throw new Error(transportOptions.error);
      }

      const transport = device.createRecvTransport(transportOptions);

      transport.on("connect", async ({ dtlsParameters }, callback, errback) => {
        try {
          const result = await socket.emitWithAck("connectConsumerTransport", {
            dtlsParameters,
          });
          if (result.error) {
            throw new Error(result.error);
          }
          callback();
        } catch (error) {
          errback(error instanceof Error ? error : new Error(String(error)));
        }
      });

      setConsumerTransport(transport);
      return transport;
    } catch (error) {
      console.error("Error creating consumer transport:", error);
      throw error;
    }
  };

  // Consume a remote stream
  const consumeStream = async (
    producerId: string,
    socketId: string,
    consumerTransport: Transport
  ) => {
    try {
      if (!socket) {
        throw new Error("Socket not ready");
      }

      console.log(
        `Starting to consume stream from ${socketId}, producer: ${producerId}`
      );

      const consumerData = await socket.emitWithAck("consume", { producerId });

      if (consumerData.error) {
        throw new Error(consumerData.error);
      }

      console.log("Consumer data received:", consumerData);

      const consumer = await consumerTransport.consume({
        id: consumerData.id,
        producerId: consumerData.producerId,
        kind: consumerData.kind,
        rtpParameters: consumerData.rtpParameters,
      });

      console.log("Consumer created:", consumer.id);
      console.log("Consumer paused:", consumer.paused);
      console.log("Consumer kind:", consumer.kind);
      console.log("Consumer track:", consumer.track);

      // CRITICAL: Resume the consumer immediately after creation
      await consumer.resume();
      console.log("Consumer resumed successfully");

      // Don't create MediaStream here - let RemoteVideo handle it
      const newRemoteStream: RemoteStream = {
        id: socketId,
        consumer,
        producerId: consumerData.producerId,
      };

      console.log("New remote stream created:", newRemoteStream);

      setRemoteStreams((prev) => {
        const filtered = prev.filter((s) => s.id !== socketId);
        return [...filtered, newRemoteStream];
      });

      console.log(`✅ Successfully started consuming stream from ${socketId}`);
    } catch (error) {
      console.error(`❌ Error consuming stream from ${socketId}:`, error);
    }
  };

  // Get existing producers and start consuming them
  const getExistingProducers = async (consumerTransport: Transport) => {
    try {
      if (!socket) return;

      const response = await socket.emitWithAck("getProducers");

      if (response?.producerList) {
        for (const { producerId, socketId } of response.producerList) {
          console.log("Consuming existing producer:", producerId, socketId);
          await consumeStream(producerId, socketId, consumerTransport);
        }
      }
    } catch (error) {
      console.error("Error getting existing producers:", error);
    }
  };

  // Start producing (streaming)
  // Updated startStreaming function in page.tsx
  const startStreaming = async (
    producerTransport: Transport,
    localStream: MediaStream,
    consumerTransport: Transport
  ) => {
    try {
      const videoTrack = localStream.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error("No video track found");
      }

      // Debug the original track
      console.log("Original video track state:");
      console.log("- enabled:", videoTrack.enabled);
      console.log("- muted:", videoTrack.muted);
      console.log("- readyState:", videoTrack.readyState);
      console.log("- settings:", videoTrack.getSettings());

      // Ensure the track is enabled and not muted
      videoTrack.enabled = true;

      // Check if track is muted and try to handle it
      if (videoTrack.muted) {
        console.warn("Video track is muted - this might cause issues");

        // Wait for track to become unmuted
        const waitForUnmute = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Track remained muted for too long"));
          }, 5000);

          const handleUnmute = () => {
            clearTimeout(timeout);
            videoTrack.removeEventListener("unmute", handleUnmute);
            resolve();
          };

          if (!videoTrack.muted) {
            clearTimeout(timeout);
            resolve();
          } else {
            videoTrack.addEventListener("unmute", handleUnmute);
          }
        });

        try {
          await waitForUnmute;
          console.log("Track is now unmuted");
        } catch (error) {
          console.warn("Track is still muted, proceeding anyway:", error);
        }
      }

      const newProducer = await producerTransport.produce({
        track: videoTrack,
      });

      // Debug the producer
      console.log("Producer created:");
      console.log("- id:", newProducer.id);
      console.log("- kind:", newProducer.kind);
      console.log("- paused:", newProducer.paused);
      console.log("- track enabled:", newProducer.track?.enabled);
      console.log("- track muted:", newProducer.track?.muted);

      // Ensure producer is not paused
      if (newProducer.paused) {
        await newProducer.resume();
        console.log("Producer resumed");
      }

      setProducer(newProducer);
      setIsStreaming(true);

      console.log("Started streaming with producer:", newProducer.id);

      // Get existing producers to consume
      await getExistingProducers(consumerTransport);
    } catch (error) {
      console.error("Error starting stream:", error);
      throw error;
    }
  };

  // Main initialization - runs only once when socket is available
  useEffect(() => {
    if (!socket || isInitialized) return;

    const initialize = async () => {
      try {
        setError(null);
        console.log("Starting initialization...");

        // Step 1: Get local stream
        const stream = await getLocalStream();
        console.log("Got local stream");

        // Step 2: Initialize device
        const device = await initializeDevice();
        console.log("Device initialized");

        // Step 3: Create transports
        const prodTransport = await createProducerTransport(device);
        console.log("Producer transport created");

        const consTransport = await createConsumerTransport(device);
        console.log("Consumer transport created");

        // Step 4: Start streaming
        await startStreaming(prodTransport, stream, consTransport);
        console.log("Streaming started");

        setIsInitialized(true);
      } catch (error) {
        console.error("Initialization error:", error);
        setError(`Initialization failed: ${error}`);
      }
    };

    initialize();
  }, [socket]); // Only depend on socket

  // Listen for new producers - separate effect
  useEffect(() => {
    if (!socket || !consumerTransport) return;

    const handleNewProducer = ({
      producerId,
      socketId,
    }: {
      producerId: string;
      socketId: string;
    }) => {
      console.log("New producer detected:", producerId, socketId);
      consumeStream(producerId, socketId, consumerTransport);
    };

    socket.on("newProducer", handleNewProducer);

    return () => {
      socket.off("newProducer", handleNewProducer);
    };
  }, [socket, consumerTransport]); // Only re-run if socket or consumerTransport changes

  // Add this to your page.tsx after creating transports
  useEffect(() => {
    const checkTransportStates = () => {
      if (producerTransport) {
        console.log("🔍 Producer transport state:", {
          id: producerTransport.id,
          connectionState: producerTransport.connectionState,
          // iceConnectionState: producerTransport.iceConnectionState,
          iceGatheringState: producerTransport.iceGatheringState,
          // dtlsState: producerTransport.dtlsState
        });
      }

      if (consumerTransport) {
        console.log("🔍 Consumer transport state:", {
          id: consumerTransport.id,
          connectionState: consumerTransport.connectionState,
          // iceConnectionState: consumerTransport.iceConnectionState,
          iceGatheringState: consumerTransport.iceGatheringState,
          // dtlsState: consumerTransport.dtlsState
        });
      }
    };

    // Check every 3 seconds
    const interval = setInterval(checkTransportStates, 3000);

    return () => clearInterval(interval);
  }, [producerTransport, consumerTransport]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log("Cleaning up...");

      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (producer) {
        producer.close();
      }
      if (producerTransport) {
        producerTransport.close();
      }
      if (consumerTransport) {
        consumerTransport.close();
      }
      remoteStreams.forEach(({ consumer }) => {
        if (consumer) consumer.close();
      });
    };
  }, []); // Empty dependency array - only run on unmount

  if (error) {
    return (
      <div style={{ padding: "20px" }}>
        <h1>Live Stream</h1>
        <div style={{ color: "red", marginBottom: "20px" }}>Error: {error}</div>
        <button
          onClick={() => {
            setError(null);
            setIsInitialized(false);
            window.location.reload();
          }}
          style={{ padding: "10px 20px" }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div style={{ padding: "20px" }}>
        <h1>Live Stream</h1>
        <div>Initializing stream...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px" }}>
      <h1>Live Stream</h1>

      <div style={{ marginBottom: "20px" }}>
        <div style={{ marginBottom: "10px" }}>
          Status: {isStreaming ? "🔴 Streaming" : "⚪ Not streaming\n"}
          Your ID is: {socket?.id}
        </div>

        <h3>Your Stream</h3>
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "320px",
            height: "240px",
            backgroundColor: "#000",
            border: "2px solid #ccc",
            borderRadius: "8px",
          }}
        />
      </div>

      <div>
        <h3>Remote Streams ({remoteStreams.length})</h3>
        {remoteStreams.length === 0 ? (
          <p>No other users streaming</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "15px",
            }}
          >
            {remoteStreams.map((remoteStream) => (
              <RemoteVideo key={remoteStream.id} remoteStream={remoteStream} />
            ))}
          </div>
        )}
      </div>
      <div style={{ marginBottom: "10px" }}>
        Status: {isStreaming ? "🔴 Streaming" : "⚪ Not streaming"}
        {isHlsEnabled && " | 📺 HLS Live"}
        <br />
        Your ID: {socket?.id}
        {hlsStreamId && (
          <>
            <br />
            Stream ID: {hlsStreamId}
          </>
        )}
      </div>

      {/* Add HLS controls */}
      {isStreaming && (
        <div style={{ marginBottom: "15px" }}>
          {!isHlsEnabled ? (
            <button
              onClick={startHLSBroadcast}
              style={{
                padding: "10px 20px",
                backgroundColor: "#28a745",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                marginRight: "10px",
              }}
            >
              Start HLS Broadcast
            </button>
          ) : (
            <button
              onClick={stopHLSBroadcast}
              style={{
                padding: "10px 20px",
                backgroundColor: "#dc3545",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                marginRight: "10px",
              }}
            >
              Stop HLS Broadcast
            </button>
          )}
          <a
            href="/watch"
            target="_blank"
            style={{
              padding: "10px 20px",
              backgroundColor: "#007bff",
              color: "white",
              textDecoration: "none",
              borderRadius: "4px",
            }}
          >
            Open Watch Page
          </a>
        </div>
      )}
    </div>
  );
}

export default Stream;
