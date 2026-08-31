import { apiWebSocketUrl } from "../apiUrls";
import { ensureHuman } from "../security/browserSecurity";
import type { DrawingOperation } from "../canvas/drawingTypes";
import type { ArtistWordMix, WordPackSnapshot } from "../dashboard/artistWordPacks";
import type { RoomState } from "./localRoomState";
import { applyDrawingDelta, drawingDelta } from "../../shared/drawingDelta.mjs";

type RoomClientHandlers = {
  onState: (state: RoomState) => void;
  onDrawingPreview: (operation: DrawingOperation | null) => void;
  onStatus: (status: "connecting" | "connected" | "offline") => void;
  onError: (message: string) => void;
};

export type OnlineRoomClient = {
  close: () => void;
  sendWordMix: (mix: ArtistWordMix, packs: WordPackSnapshot[]) => void;
  sendStartGame: () => void;
  sendChoiceVote: (choiceIndex: number) => void;
  sendRoomSettings: (settings: { roundsPerPlayer?: number; maxPlayers?: number; roundSeconds?: number }) => void;
  sendRoomLeader: (hostId: string) => void;
  sendGuess: (text: string) => void;
  sendDrawingPreview: (operation: DrawingOperation | null) => void;
  sendDrawingOperations: (operations: DrawingOperation[]) => void;
  sendLeaveRoom: () => void;
  sendTwitchTakeover: () => void;
};

const send = (socket: WebSocket | null, type: string, payload?: unknown) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, payload }));
};

export function connectOnlineRoom(
  code: string,
  clientId: string,
  reconnectToken: string,
  name: string,
  handlers: RoomClientHandlers,
  options: { create?: boolean } = {},
): OnlineRoomClient | null {
  const url = apiWebSocketUrl(`/api/room/${code}/live`);
  if (!url) return null;
  let socket: WebSocket | null = null;
  let stopped = false;
  let retryTimer: number | null = null;
  let retryCount = 0;
  let createRequested = Boolean(options.create);
  let currentState: RoomState | null = null;
  let supportsDeltas = false;
  let joined = false;
  let drawingReady = false;
  let desiredDrawing: DrawingOperation[] | null = null;
  let desiredVersion = 0;
  let inFlight: { id: string; version: number } | null = null;
  let drawingTimer: number | null = null;
  let ackTimer: number | null = null;
  let nextSendAt = 0;
  let localPreviewId: string | null = null;
  let localPreviewActive = false;
  let desiredPreviewId: string | null = null;
  let remotePreviewId: string | null = null;
  let previewTimer: number | null = null;

  const clearPreview = () => {
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    previewTimer = null;
    remotePreviewId = null;
    handlers.onDrawingPreview(null);
  };

  const clearAck = () => { if (ackTimer !== null) window.clearTimeout(ackTimer); ackTimer = null; inFlight = null; };
  const resetDrawingQueue = () => {
    desiredDrawing = null;
    clearAck();
    if (drawingTimer !== null) window.clearTimeout(drawingTimer);
    drawingTimer = null;
  };
  const scheduleDrawing = (delay = 100) => {
    if (drawingTimer !== null || stopped || !joined || !drawingReady || inFlight || !desiredDrawing) return;
    drawingTimer = window.setTimeout(() => {
      drawingTimer = null;
      if (!joined || !drawingReady || inFlight || !desiredDrawing || currentState?.phase !== "drawing" || currentState.drawerId !== clientId || socket?.readyState !== WebSocket.OPEN) return;
      if (!supportsDeltas) {
        send(socket, "drawing-sync", { operations: desiredDrawing });
        desiredDrawing = null;
      } else {
        const delta = drawingDelta(currentState.drawingOperations || [], desiredDrawing);
        if (!delta.deleteCount && !delta.operations.length) { desiredDrawing = null; return; }
        const id = crypto.randomUUID();
        inFlight = { id, version: desiredVersion };
        send(socket, "drawing-delta", { mutationId: id, epoch: currentState.drawingEpoch, baseRevision: currentState.drawingRevision || 0, delta, previewId: desiredPreviewId });
        // A lost acknowledgement reconnects and obtains a fresh authoritative snapshot.
        ackTimer = window.setTimeout(() => socket?.close(), 5000);
      }
      nextSendAt = Date.now() + 300;
    }, Math.max(delay, nextSendAt - Date.now()));
  };
  const publishDrawing = (previewId?: string | null) => { if (!remotePreviewId || remotePreviewId === previewId) clearPreview(); if (currentState) handlers.onState(currentState); };

  const openSocket = async () => {
    try { await ensureHuman(); } catch (error) { handlers.onStatus("offline"); handlers.onError((error as Error).message); return; }
    if (stopped) return;
    handlers.onStatus("connecting");
    joined = false;
    drawingReady = false;
    supportsDeltas = false;
    socket = new WebSocket(url);
    const activeSocket = socket;
    activeSocket.addEventListener("open", () => {
      handlers.onStatus("connected");
      send(activeSocket, "join", { code, clientId, reconnectToken, name, create: createRequested, protocolVersion: 3 });
    });
    activeSocket.addEventListener("message", (event) => {
      if (socket !== activeSocket || stopped) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "hello") supportsDeltas = message.payload?.drawingProtocol >= 3;
        if (message.type === "room-state") {
          createRequested = false;
          if (message.payload.drawingEpoch !== currentState?.drawingEpoch || message.payload.phase !== "drawing") { resetDrawingQueue(); clearPreview(); }
          if (supportsDeltas && message.payload.drawingOperations === undefined && message.payload.drawingRevision !== currentState?.drawingRevision) {
            drawingReady = false;
            send(activeSocket, "drawing-resync");
          }
          if (message.payload.drawingOperations !== undefined) drawingReady = true;
          currentState = { ...message.payload, drawingOperations: message.payload.drawingOperations ?? currentState?.drawingOperations ?? [] } as RoomState;
          joined = true;
          retryCount = 0;
          handlers.onState(currentState);
          scheduleDrawing();
        }
        if (message.type === "drawing-delta" && currentState && message.payload.epoch === currentState.drawingEpoch) {
          const update = message.payload;
          if (update.revision === currentState.drawingRevision) return;
          if (!drawingReady || update.baseRevision !== currentState.drawingRevision) { drawingReady = false; send(activeSocket, "drawing-resync"); return; }
          currentState = { ...currentState, drawingOperations: applyDrawingDelta(currentState.drawingOperations || [], update.delta), drawingRevision: update.revision };
          publishDrawing(update.previewId);
        }
        if (message.type === "drawing-ack" && inFlight && message.payload.mutationId === inFlight.id) {
          if (inFlight?.version === desiredVersion) desiredDrawing = null;
          clearAck();
          scheduleDrawing();
        }
        if (message.type === "drawing-snapshot" && currentState) {
          if (message.payload.epoch !== currentState.drawingEpoch) resetDrawingQueue();
          else clearAck();
          currentState = { ...currentState, drawingEpoch: message.payload.epoch, drawingRevision: message.payload.revision, drawingOperations: message.payload.operations };
          drawingReady = true;
          publishDrawing();
          nextSendAt = Date.now() + (message.payload.retryAfterMs || 0);
          scheduleDrawing();
        }
        if (message.type === "drawing-committed" && currentState?.phase === "drawing" && currentState.turnIndex === message.payload.turnIndex) {
          currentState = { ...currentState, drawingOperations: message.payload.operations };
          handlers.onDrawingPreview(null);
          handlers.onState(currentState);
        }
        if (message.type === "drawing-preview") {
          if (previewTimer !== null) window.clearTimeout(previewTimer);
          if (message.payload?.operation) {
            remotePreviewId = message.payload.previewId || null;
            handlers.onDrawingPreview(message.payload.operation as DrawingOperation);
          } else {
            // Keep the released stroke visible until its durable batch arrives.
            previewTimer = window.setTimeout(clearPreview, 1000);
          }
        }
        if (message.type === "error") { resetDrawingQueue(); handlers.onError(String(message.error || "Room request failed.")); }
      } catch {
        handlers.onError("Room server sent an unreadable message.");
      }
    });
    activeSocket.addEventListener("close", (event) => {
      if (socket !== activeSocket) return;
      joined = false;
      clearAck();
      if (socket === activeSocket) socket = null;
      if (stopped) return;
      if (event.code === 1008) { handlers.onStatus("offline"); handlers.onError(event.reason || "Connection closed by the server. Please wait before rejoining."); return; }
      handlers.onStatus("offline");
      const delay = Math.min(30000, 1000 * (2 ** retryCount)) + Math.random() * 1000;
      retryCount = Math.min(retryCount + 1, 5);
      retryTimer = window.setTimeout(openSocket, delay);
    });
    activeSocket.addEventListener("error", () => handlers.onStatus("offline"));
  };

  void openSocket();

  return {
    close: () => {
      stopped = true;
      resetDrawingQueue();
      clearPreview();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close();
      socket = null;
    },
    sendWordMix: (mix, packs) => send(socket, "word-mix", { mix, packs }),
    sendStartGame: () => send(socket, "start-game"),
    sendChoiceVote: (choiceIndex) => send(socket, "choice-vote", { choiceIndex }),
    sendRoomSettings: (settings) => send(socket, "room-settings", settings),
    sendRoomLeader: (hostId) => send(socket, "transfer-leader", { hostId }),
    sendGuess: (text) => send(socket, "guess", { text }),
    sendDrawingPreview: (operation) => {
      if (operation && !localPreviewActive) localPreviewId = crypto.randomUUID();
      localPreviewActive = Boolean(operation);
      send(socket, "drawing-preview", { operation, previewId: localPreviewId });
    },
    sendDrawingOperations: (operations) => {
      desiredDrawing = structuredClone(operations);
      desiredVersion++;
      desiredPreviewId = localPreviewId;
      scheduleDrawing();
    },
    sendLeaveRoom: () => send(socket, "leave-room"),
    sendTwitchTakeover: () => send(socket, "twitch-takeover"),
  };
}
