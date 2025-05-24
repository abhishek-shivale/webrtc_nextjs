import { useContext, useEffect, useRef, useState, useCallback } from "react";
import { SocketContext } from "@/context/socket-context";
import { Device } from 'mediasoup-client';
import type { Transport, Producer, Consumer } from 'mediasoup-client/types';
import { RemoteStream } from "@/utils/socket";


export const useMediaStream = () => {
  const { socket } = useContext(SocketContext);
  const [device, setDevice] = useState<Device | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [producerTransport, setProducerTransport] = useState<Transport | null>(null);
  const [consumerTransport, setConsumerTransport] = useState<Transport | null>(null);
  const [producer, setProducer] = useState<Producer | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  
  const consumersRef = useRef<Map<string, Consumer>>(new Map());
  const consumedProducersRef = useRef<Set<string>>(new Set());
  const isInitializingRef = useRef(false);

  const getPermissions = useCallback(async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 60 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    setLocalStream(stream);
    return stream;
  }, []);

  const initializeDevice = useCallback(async (): Promise<Device> => {
    if (!socket) throw new Error("Socket not connected");
    const device = new Device();
    const routerRtpCapabilities = await socket.emitWithAck("getRouterRtpCapabilities");
    if (!device.loaded) await device.load({ routerRtpCapabilities });
    socket.emit("setRtpCapabilities", device.rtpCapabilities);
    setDevice(device);
    return device;
  }, [socket]);

  const createTransports = useCallback(async (device: Device) => {
    if (!socket) throw new Error("Socket not connected");
    
    const producerOptions = await socket.emitWithAck("createProducerTransport");
    const consumerOptions = await socket.emitWithAck("createConsumerTransport");
    
    if (producerOptions.error || consumerOptions.error) {
      throw new Error("Transport creation failed");
    }
    
    const prodTransport = device.createSendTransport(producerOptions);
    const consTransport = device.createRecvTransport(consumerOptions);
    
    prodTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        const result = await socket.emitWithAck("connectProducerTransport", { dtlsParameters });
        if (result.error) throw new Error(result.error);
        callback();
      } catch (error) {
        errback(error instanceof Error ? error : new Error(String(error)));
      }
    });

    prodTransport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
      try {
        const result = await socket.emitWithAck("produce", { kind, rtpParameters });
        if (result.error) throw new Error(result.error);
        callback({ id: result.id });
      } catch (error) {
        errback(error instanceof Error ? error : new Error(String(error)));
      }
    });

    consTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        const result = await socket.emitWithAck("connectConsumerTransport", { dtlsParameters });
        if (result.error) throw new Error(result.error);
        callback();
      } catch (error) {
        errback(error instanceof Error ? error : new Error(String(error)));
      }
    });

    setProducerTransport(prodTransport);
    setConsumerTransport(consTransport);
    return { prodTransport, consTransport };
  }, [socket]);

  const startStreaming = useCallback(async (transport: Transport) => {
    const stream = localStream || await getPermissions();
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error("No video track found");
    
    const producer = await transport.produce({ track: videoTrack });
    setProducer(producer);
    setIsStreaming(true);
  }, [localStream, getPermissions]);

  const consumeStream = useCallback(async (producerId: string, socketId: string) => {
    if (consumedProducersRef.current.has(producerId) || !consumerTransport || !socket || !device) return;
    
    consumedProducersRef.current.add(producerId);
    
    try {
      // @ts-ignore
    //   const canConsume = Device.canConsume({ producerId, rtpCapabilities: device.rtpCapabilities });
    //   if (!canConsume) {
    //     consumedProducersRef.current.delete(producerId);
    //     return;
    //   }
      
      const consumerOptions = await socket.emitWithAck("consume", { producerId });
      if (consumerOptions.error) throw new Error(consumerOptions.error);
      
      const consumer = await consumerTransport.consume({
        id: consumerOptions.id,
        producerId: consumerOptions.producerId,
        kind: consumerOptions.kind,
        rtpParameters: consumerOptions.rtpParameters,
      });
      
      consumersRef.current.set(consumer.id, consumer);
      await socket.emitWithAck("resumeConsumer", { consumerId: consumer.id });
      
      const stream = new MediaStream([consumer.track]);
      
      setRemoteStreams(prev => {
        const exists = prev.find(s => s.producerId === producerId);
        if (exists) return prev;
        return [...prev, { id: consumer.id, stream, socketId, producerId }];
      });

      consumer.on("transportclose", () => {
        consumedProducersRef.current.delete(producerId);
        setRemoteStreams(prev => prev.filter(s => s.id !== consumer.id));
        consumersRef.current.delete(consumer.id);
      });
      
      consumer.on("trackended", () => {
        consumedProducersRef.current.delete(producerId);
        setRemoteStreams(prev => prev.filter(s => s.id !== consumer.id));
        consumersRef.current.delete(consumer.id);
      });
      
    } catch (error) {
      consumedProducersRef.current.delete(producerId);
    }
  }, [consumerTransport, socket, device]);

  const handleNewProducer = useCallback(({ producerId, socketId }: { producerId: string, socketId: string }) => {
    if (!consumedProducersRef.current.has(producerId) && isInitialized) {
      consumeStream(producerId, socketId);
    }
  }, [isInitialized, consumeStream]);

  const handleProducerClosed = useCallback(({ producerId }: { producerId: string }) => {
    consumedProducersRef.current.delete(producerId);
    setRemoteStreams(prev => prev.filter(stream => {
      if (stream.producerId === producerId) {
        const consumer = consumersRef.current.get(stream.id);
        if (consumer) {
          consumer.close();
          consumersRef.current.delete(stream.id);
        }
        return false;
      }
      return true;
    }));
  }, []);

  return {
    localStream,
    remoteStreams,
    isStreaming,
    isInitialized,
    initializationError,
    getPermissions,
    initializeDevice,
    createTransports,
    startStreaming,
    consumeStream,
    handleNewProducer,
    handleProducerClosed,
    isInitializingRef
  };
};