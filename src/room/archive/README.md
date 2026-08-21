# Room Mode Test Bots (Archived)

This folder contains the archived automated test bot system for Room Mode (`roomBotManager.ts.archived`).

### What it does:
- Simulates 5 automated bots (`PixelBot`, `DoodleBob`, `SketchyAI`, `Artie`, `QuirkBot`) in local and online WebSocket test rooms.
- Auto-votes on mystery word slots during the choosing phase with human-like delays.
- Chats wrong guesses in the room chat and solves drawing prompts realistically (1–2 solvers per round) with dynamic speed scoring.

### How to re-enable in the future:
1. Copy or rename `roomBotManager.ts.archived` back to `src/room/roomBotManager.ts`.
2. Re-import `useRoomBots` in `src/room/RoomModePage.tsx` and call `useRoomBots(...)`.
