# Twitch setup

1. Open `.env` in the project root.
2. In the Twitch Developer Console, open **Findraw > Manage**.
3. Copy the **Client ID** into `TWITCH_CLIENT_ID`.
4. Create a **Client Secret** and copy it into `TWITCH_CLIENT_SECRET`.
5. Keep this callback registered exactly: `http://localhost:3000/auth/twitch/callback`.
6. Run `pnpm dev`, open `http://127.0.0.1:5173`, then use **Settings > Connect Twitch**.

Do not commit or share `.env`. Twitch tokens are encrypted before being stored in `.findraw-data`, and both paths are ignored by Git.

Findraw points are local and independent of Twitch Channel Points. Correct guesses award 100, 80, 60, then 50 points. The streamer can add a 25-point bonus beside a solved viewer. Scores and a small audit ledger are stored in `.findraw-data/points.json`.
