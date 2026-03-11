'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

type Props = {
  sharerId: string;
  sharerUsername: string;
  socket: {
    emit: (event: string, data?: Record<string, unknown>) => void;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    off: (event: string, handler: (...args: unknown[]) => void) => void;
  };
  userId: string;
  onEnd: () => void;
  isSharer: boolean;
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
};

const ScreenSharePlayer: React.FC<Props> = ({ sharerId, sharerUsername, socket, userId, onEnd, isSharer }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreamRef = useRef<MediaStream | null>(null);

  // Sharer: handle new viewer joining
  const handleViewerJoined = useCallback(
    async (data: unknown) => {
      const { viewerId } = data as { viewerId: string; viewerUsername: string };
      if (!isSharer || !localStreamRef.current) return;

      const pc = new RTCPeerConnection(ICE_SERVERS);

      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc_ice_candidate', {
            targetUserId: viewerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          peerConnectionsRef.current.delete(viewerId);
        }
      };

      peerConnectionsRef.current.set(viewerId, pc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('webrtc_offer', {
        targetUserId: viewerId,
        offer: pc.localDescription?.toJSON(),
      });
    },
    [isSharer, socket],
  );

  // Viewer: handle incoming offer
  const handleOffer = useCallback(
    async (data: unknown) => {
      const { fromUserId, offer } = data as { fromUserId: string; offer: RTCSessionDescriptionInit };
      if (isSharer) return;

      const pc = new RTCPeerConnection(ICE_SERVERS);

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          remoteStreamRef.current = event.streams[0];
        } else {
          if (!remoteStreamRef.current) {
            remoteStreamRef.current = new MediaStream();
          }
          remoteStreamRef.current.addTrack(event.track);
        }
        if (videoRef.current && remoteStreamRef.current) {
          videoRef.current.srcObject = remoteStreamRef.current;
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc_ice_candidate', {
            targetUserId: fromUserId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          peerConnectionsRef.current.delete(fromUserId);
        }
      };

      peerConnectionsRef.current.set(fromUserId, pc);

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('webrtc_answer', {
        targetUserId: fromUserId,
        answer: pc.localDescription?.toJSON(),
      });
    },
    [isSharer, socket],
  );

  // Sharer: handle incoming answer
  const handleAnswer = useCallback(async (data: unknown) => {
    const { fromUserId, answer } = data as { fromUserId: string; answer: RTCSessionDescriptionInit };
    const pc = peerConnectionsRef.current.get(fromUserId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }, []);

  // Both: handle ICE candidate
  const handleIceCandidate = useCallback(async (data: unknown) => {
    const { fromUserId, candidate } = data as { fromUserId: string; candidate: RTCIceCandidateInit };
    const pc = peerConnectionsRef.current.get(fromUserId);
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }, []);

  // Initialize
  useEffect(() => {
    // Register signaling listeners
    socket.on('screen_share_viewer_joined', handleViewerJoined);
    socket.on('webrtc_offer', handleOffer);
    socket.on('webrtc_answer', handleAnswer);
    socket.on('webrtc_ice_candidate', handleIceCandidate);

    if (isSharer) {
      // Start screen capture
      navigator.mediaDevices
        .getDisplayMedia({
          video: { cursor: 'always' } as MediaTrackConstraints,
          audio: false,
        })
        .then((stream) => {
          localStreamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }

          // Listen for browser stop-sharing
          stream.getVideoTracks()[0].onended = () => {
            socket.emit('screen_share_stop');
            onEnd();
          };

          // Notify server
          socket.emit('screen_share_start');
        })
        .catch(() => {
          // User cancelled the screen picker
          onEnd();
        });
    } else {
      // Viewer: request to join the sharer's stream
      socket.emit('join_screen_share', { sharerId });
    }

    const peerConnections = peerConnectionsRef.current;

    return () => {
      socket.off('screen_share_viewer_joined', handleViewerJoined);
      socket.off('webrtc_offer', handleOffer);
      socket.off('webrtc_answer', handleAnswer);
      socket.off('webrtc_ice_candidate', handleIceCandidate);

      // Cleanup streams and connections
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (remoteStreamRef.current) {
        remoteStreamRef.current.getTracks().forEach((t) => t.stop());
        remoteStreamRef.current = null;
      }
      peerConnections.forEach((pc) => pc.close());
      peerConnections.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStop = () => {
    if (isSharer) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      socket.emit('screen_share_stop');
    }
    onEnd();
  };

  const handlePopout = () => {
    const stream = isSharer ? localStreamRef.current : remoteStreamRef.current;
    if (!stream) return;

    const w = 800;
    const h = 600;
    const left = (screen.width - w) / 2;
    const top = (screen.height - h) / 2;
    const popup = window.open('', 'Screen Share', `width=${w},height=${h},left=${left},top=${top},resizable=yes`);
    if (!popup) return;

    popup.document.write(`<!DOCTYPE html>
<html><head><title>Screen Share - ${sharerUsername}</title>
<style>body{margin:0;background:#000;overflow:hidden;display:flex;justify-content:center;align-items:center;height:100vh}
video{max-width:100%;max-height:100%}</style></head>
<body><video id="v" autoplay playsinline muted></video></body></html>`);
    popup.document.close();

    const popupVideo = popup.document.getElementById('v') as HTMLVideoElement;
    if (popupVideo) {
      popupVideo.srcObject = stream;
      popupVideo.play().catch(() => {});
    }
  };

  return (
    <Box sx={{ position: 'relative', borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.5 }}>
        <Typography variant="detailText">
          Screen Share — {sharerUsername}
          {isSharer ? ' (You)' : ''}
        </Typography>
        <Box>
          <IconButton size="small" onClick={handlePopout} title="Pop out" sx={{ color: '#858585' }}>
            <OpenInNewIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton size="small" onClick={handleStop} title="Stop Screen Share" sx={{ color: '#858585' }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>
      <Box sx={{ width: '100%', aspectRatio: '16/9', maxHeight: '40vh', bgcolor: '#000' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </Box>
    </Box>
  );
};

export default ScreenSharePlayer;
