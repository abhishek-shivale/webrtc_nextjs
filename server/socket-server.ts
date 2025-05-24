import { Server, Socket } from "socket.io";
import mediasoup from "mediasoup";
import { Server as HttpServer } from "http";
import { createRouter, createTransport, createWorker } from "./mediasoup";
import {  HLSRecorderV2 as HLSRecorder  } from "./ffmpeg-recorder";

declare module "socket.io" {
  interface Socket {
    rtpCapabilities?: mediasoup.types.RtpCapabilities;
  }
}

let io: Server;
let worker: mediasoup.types.Worker;
let router: mediasoup.types.Router;

const hlsRecorders = new Map<string, HLSRecorder>();
const activeStreams = new Map<
  string,
  { streamers: Set<string>; recorder?: HLSRecorder }
>();

const transports = new Map<string, mediasoup.types.Transport>();
const producers = new Map<
  string,
  { producer: mediasoup.types.Producer; producerId: string }
>();
const consumers = new Map<
  string,
  { consumer: mediasoup.types.Consumer; consumer_Id: string }
>();
const corsOptions = {
  origin: "*",
  methods: ["GET", "POST"],
};

export async function initMediasoup() {
  try {
    worker = await createWorker();
    router = await createRouter(worker);
  } catch (error) {
    console.error("Error initializing mediasoup:", error);
  }
}

export function initSocketIO(httpServer: any) {
  io = new Server(httpServer, {
    transports: ["websocket"],
    cors: corsOptions,
  });

  io.on("connection", (socket: Socket) => {
    console.log("A client connected");
    const id = socket.id;

    socket.on("healthCheck", (callback: any) => {
      console.log("Health check received");
    });

    socket.on("rtpCapabilities", async (callback: any) => {
      if (!router) {
        console.error("Router is not initialized");
        return;
      }
      const rtpCapabilitie = router.rtpCapabilities;
      if (!rtpCapabilitie) {
        console.error("RTP capabilities not found");
        return;
      }
      callback({ rtpCapabilities: rtpCapabilitie });
    });

    socket.on("createProducerTransport", async (callback: any) => {
      try {
        if (transports.has(`${id}-producer`)) {
          console.log("Transport already exists for this socket");
          transports.delete(`${id}-producer`);
        }
        const transport = await createTransport(router);
        transports.set(`${id}-producer`, transport);

        const transportOption = {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };
        callback(transportOption);
      } catch (error) {
        console.error("Error creating producer transport:", error);
        callback({ error: "Error creating producer transport" });
      }
    });

    socket.on("createConsumerTransport", async (callback) => {
      try {
        if (transports.has(`${id}-consumer`)) {
          transports.delete(`${id}-consumer`);
          console.log("Transport already exists for this socket");
          // return;
        }

        const transport = await createTransport(router);
        transports.set(`${id}-consumer`, transport);

        const transportOption = {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };
        callback(transportOption);
      } catch (error) {
        console.error("Error creating consumer transport:", error);
        callback({ error: "Error creating consumer transport" });
      }
    });

    socket.on(
      "connectProducerTransport",
      async ({ dtlsParameters }, callback) => {
        try {
          const transport = transports.get(`${id}-producer`);
          if (!transport) {
            throw new Error("Producer transport not found");
          }
          await transport.connect({ dtlsParameters });
          callback({ success: true });
        } catch (error) {
          console.error("Error connecting producer transport:", error);
          callback({ error: "Error connecting producer transport" });
        }
      }
    );

    socket.on(
      "connectConsumerTransport",
      async ({ dtlsParameters }, callback) => {
        try {
          const transport = transports.get(`${socket.id}-consumer`);
          if (!transport) {
            throw new Error("Consumer transport not found");
          }
          await transport.connect({ dtlsParameters });
          callback({ success: true });
        } catch (error) {
          console.error("Error connecting consumer transport:", error);
          callback({ error: "Error connecting consumer transport" });
        }
      }
    );

    socket.on("produce", async ({ kind, rtpParameters }, callback) => {
      try {
        const transport = transports.get(`${id}-producer`);
        if (producers.has(id)) {
          console.log("Producer already exists for this socket");
          producers.delete(id);
        }

        if (!transport) {
          throw new Error("Producer transport not found");
        }

        const producer = await transport.produce({ kind, rtpParameters });
        if (producer.paused) {
          await producer.resume();
          console.log(`Producer ${producer.id} resumed`);
        }
        console.log(`Producer created: ${producer.id} for ${socket.id}`);
        socket.broadcast.emit("newProducer", {
          producerId: producer.id,
          socketId: socket.id,
        });
        producers.set(id, { producer, producerId: producer.id });
        callback({ id: producer.id });
      } catch (error) {
        console.error("Error producing:", error);
        callback({ error: "Error producing" });
      }
    });

    socket.on("consume", async ({ producerId }, callback) => {
      try {
        if (consumers.has(id)) {
          console.log("Consumer already exists for this socket");
          consumers.delete(id);
        }
        const transport = transports.get(`${socket.id}-consumer`);
        const producerData = Array.from(producers.values()).find(
          (producer) => producer.producerId === producerId
        );

        if (!transport) {
          throw new Error("Consumer transport not found");
        }
        if (!producerData) {
          throw new Error("Producer not found");
        }

        if (!socket.rtpCapabilities) {
          throw new Error("RTP capabilities not set");
        }
        const { producer } = producerData;
        const consumerRtpCapabilities = socket.rtpCapabilities;

        const canConsume = router.canConsume({
          producerId: producer.id,
          rtpCapabilities:
            consumerRtpCapabilities as mediasoup.types.RtpCapabilities,
        });
        if (!canConsume) {
          throw new Error("Cannot consume this producer");
        }

        const consumer = await transport.consume({
          producerId: producer.id,
          rtpCapabilities:
            consumerRtpCapabilities as mediasoup.types.RtpCapabilities,
        });
        consumers.set(id, { consumer, consumer_Id: socket.id });
        callback({
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (error) {
        console.error("Error consuming:", error);
        callback({ error: "Error consuming" });
      }
    });

    socket.on("resumeConsumer", async ({ consumerId }, callback) => {
      try {
        const consumerData = Array.from(consumers.values()).find(
          (data) => data.consumer.id === consumerId
        );

        if (!consumerData) {
          throw new Error("Consumer not found");
        }

        await consumerData.consumer.resume();
        console.log(`Consumer ${consumerId} resumed for socket ${socket.id}`);
        callback({ success: true });
      } catch (error) {
        console.error("Error resuming consumer:", error);
        callback({ error: "Error resuming consumer" });
      }
    });

    socket.on("getProducers", (callback) => {
      const currentProducer = producers.get(socket.id);
      const producerList = Array.from(producers.entries())
        .filter(
          ([socketId, data]) => data.producerId !== currentProducer?.producerId
        )
        .map(([socketId, data]) => ({
          producerId: data.producerId,
          socketId: socketId,
        }));
      callback({ producerList });
    });

    socket.on("setRtpCapabilities", (rtpCapabilities) => {
      socket.rtpCapabilities = rtpCapabilities;
    });

    socket.on("startHLSStream", async ({ streamId }, callback) => {
      try {
        if (!streamId) {
          streamId = `stream_${Date.now()}`;
        }

        // Create or get existing stream
        if (!activeStreams.has(streamId)) {
          activeStreams.set(streamId, { streamers: new Set() });
        }

        const stream = activeStreams.get(streamId)!;
        stream.streamers.add(socket.id);

        // Start HLS recording if this is the first producer
        const hasVideoProducers = Array.from(producers.values()).some(
          (p) => p.producer.kind === "video"
        );

        console.log("Starting HLS stream:", {
          streamId,
          hasVideoProducers,
          producerCount: producers.size,
        });

        if (hasVideoProducers && !stream.recorder) {
          const recorder = new HLSRecorder(streamId);

          try {
            await recorder.startRecording(router, producers);
            stream.recorder = recorder;
            hlsRecorders.set(streamId, recorder);

            // Check if files are being created
            setTimeout(() => {
              const fileStatus = recorder.checkFiles();
              console.log("HLS file status:", fileStatus);
            }, 5000);
          } catch (error) {
            console.error("Failed to start HLS recording:", error);
            callback({ error: `Failed to start HLS recording: ${error}` });
            return;
          }
        }

        callback({
          success: true,
          streamId,
          playlistUrl: stream.recorder?.getPlaylistUrl(),
        });

        // Notify viewers that stream is live
        io.emit("streamLive", {
          streamId,
          playlistUrl: stream.recorder?.getPlaylistUrl(),
          streamers: Array.from(stream.streamers),
        });
      } catch (error) {
        console.error("Error starting HLS stream:", error);
        callback({ error: "Failed to start HLS stream" });
      }
    });

    socket.on("stopHLSStream", ({ streamId }, callback) => {
      try {
        const stream = activeStreams.get(streamId);
        if (stream) {
          stream.streamers.delete(socket.id);

          // Stop recording if no more streamers
          if (stream.streamers.size === 0 && stream.recorder) {
            stream.recorder.stopRecording();
            hlsRecorders.delete(streamId);
            activeStreams.delete(streamId);

            // Notify viewers that stream ended
            io.emit("streamEnded", { streamId });
          }
        }

        callback({ success: true });
      } catch (error) {
        console.error("Error stopping HLS stream:", error);
        callback({ error: "Failed to stop HLS stream" });
      }
    });

    socket.on("getActiveStreams", (callback) => {
      const streams = Array.from(activeStreams.entries()).map(
        ([streamId, data]) => ({
          streamId,
          playlistUrl: data.recorder?.getPlaylistUrl(),
          streamers: Array.from(data.streamers),
          isLive: data.recorder?.isActive() || false,
        })
      );

      callback({ streams });
    });

    socket.on("disconnect", () => {
      producers.delete(socket.id);
      transports.delete(`${socket.id}-producer`);
      transports.delete(`${socket.id}-consumer`);
      consumers.delete(socket.id);
      console.log("A client disconnected");

      for (const [streamId, stream] of activeStreams.entries()) {
        if (stream.streamers.has(socket.id)) {
          stream.streamers.delete(socket.id);

          if (stream.streamers.size === 0 && stream.recorder) {
            stream.recorder.stopRecording();
            hlsRecorders.delete(streamId);
            activeStreams.delete(streamId);
            io.emit("streamEnded", { streamId });
          }
        }
      }
    });
  });

  return io;
}
