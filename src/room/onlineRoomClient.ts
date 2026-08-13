import { apiWebSocketUrl } from "../apiUrls";
import type { DrawingOperation } from "../canvas/drawingTypes";
import type { CategoryPrompt, CategorySelection } from "../dashboard/gameData";
import type { RoomState } from "./localRoomState";

type RoomClientHandlers = {
  onState: (state: RoomState) => void;
  onDrawingPreview: (operation: DrawingOperation | null) => void;
  onStatus: (status: "connecting" | "connected" | "offline") => void;
  onError: (message: string) => void;
};

export type OnlineRoomClient = {
  close: () => void;
  sendCategorySelection: (selection: CategorySelection) => void;
  sendStartGame: (choices: CategoryPrompt[]) => void;
  sendChoices: (choices: CategoryPrompt[]) => void;
  sendChosenWord: (answer: CategoryPrompt) => void;
  sendChoiceVote: (choiceIndex: number) => void;
  sendRoomSettings: (settings: { roundsPerPlayer?: number; maxPlayers?: number }) => void;
  sendRoomLeader: (hostId: string) => void;
  sendGuess: (text: string) => void;
  sendDrawingPreview: (operation: DrawingOperation | null) => void;
  sendDrawingOperations: (operations: DrawingOperation[]) => void;
  sendLeaveRoom: () => void;
};

const send = (socket: WebSocket | null, type: string, payload?: unknown) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, payload }));
};

export function connectOnlineRoom(
  code: string,
  clientId: string,
  name: string,
  handlers: RoomClientHandlers,
): OnlineRoomClient | null {
  const url = apiWebSocketUrl(`/api/room/${code}/live`);
  if (!url) return null;
  handlers.onStatus("connecting");
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    handlers.onStatus("connected");
    send(socket, "join", { code, clientId, name });
  });
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.type === "room-state") handlers.onState(message.payload as RoomState);
      if (message.type === "drawing-preview") handlers.onDrawingPreview((message.payload?.operation ?? null) as DrawingOperation | null);
      if (message.type === "error") handlers.onError(String(message.error || "Room request failed."));
    } catch {
      handlers.onError("Room server sent an unreadable message.");
    }
  });
  socket.addEventListener("close", () => handlers.onStatus("offline"));
  socket.addEventListener("error", () => handlers.onStatus("offline"));

  return {
    close: () => socket.close(),
    sendCategorySelection: (selection) => send(socket, "select-categories", { selection }),
    sendStartGame: (choices) => send(socket, "start-game", { choices }),
    sendChoices: (choices) => send(socket, "set-choices", { choices }),
    sendChosenWord: (answer) => send(socket, "choose-word", { answer }),
    sendChoiceVote: (choiceIndex) => send(socket, "choice-vote", { choiceIndex }),
    sendRoomSettings: (settings) => send(socket, "room-settings", settings),
    sendRoomLeader: (hostId) => send(socket, "transfer-leader", { hostId }),
    sendGuess: (text) => send(socket, "guess", { text }),
    sendDrawingPreview: (operation) => send(socket, "drawing-preview", { operation }),
    sendDrawingOperations: (operations) => send(socket, "drawing-sync", { operations }),
    sendLeaveRoom: () => send(socket, "leave-room"),
  };
}
