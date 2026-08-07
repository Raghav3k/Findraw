# Findraw Project Brief

## 1. One-Line Idea

Findraw is a stream-first drawing and guessing game where a streamer draws a hidden prompt and the live chat races or collaborates to guess the answer.

The game should feel like a polished creator tool, not a generic party-game clone. The main loop is simple, but the stream mechanics should create tension, crowd participation, and clip-worthy moments.

## 2. Product Position

Findraw sits between:

- Gartic / Skribbl-style drawing and guessing games.
- Gartic Phone-style social chaos.
- Streamer tools that connect Twitch or YouTube chat to on-screen gameplay.

The key difference is that Findraw is designed around a streamer and their chat:

- The streamer is the artist.
- Chat is the guessing crowd.
- The dashboard itself works as a clean, stream-safe OBS browser source.
- The streamer has control over difficulty, hints, categories, and win conditions.

## 3. Target Users

### Primary User

Streamers who want a lightweight interactive game with chat.

They need:

- Fast setup.
- OBS-friendly single-page composition.
- Stream-safe secret word handling.
- Reliable chat detection.
- Fun controls that do not interrupt streaming.

### Secondary Users

Viewers/chatters who want to participate without installing anything.

They need:

- Guess through Twitch/YouTube chat first.
- Optional web room guessing later.
- Clear feedback when chat is close to solving.
- Leaderboards, streaks, and recognition.

### Casual Users

Friends who may play outside streaming.

They need:

- Web rooms.
- Simple drawing and guessing.
- No OBS or chat setup required.

## 4. Surfaces

Findraw should eventually have both a website and a desktop app, but they must share the same product core.

### Web Version

Purpose: instant access and easy trial.

Features:

- Streamer dashboard in browser.
- Dashboard URL that can be added directly as an OBS browser source.
- Drawing canvas.
- Word categories.
- Manual/fake chat mode for testing.
- Twitch chat integration later.
- Public rooms later.

### Desktop App

Purpose: serious streamer setup.

Features:

- Local dashboard/browser-source hosting.
- Local persistent settings.
- Local word packs.
- Chat connector settings.
- Hotkeys.
- Stable OBS camera-cover workflow.
- Possible OBS WebSocket integration.
- Possible Stream Deck support.

### Shared Core

Both surfaces should reuse:

- Game engine.
- Word/category system.
- Guess matching.
- Scoring.
- Drawing data model.
- Browser-source scene layout.
- Chat input interface.

## 5. Core Game Loop

1. Streamer selects category and round settings.
2. Game chooses a secret prompt.
3. Streamer sees the prompt privately.
4. Streamer draws on the canvas.
5. Chat guesses the answer.
6. The game checks guesses automatically.
7. Progress updates on the dashboard browser source.
8. Round ends when win condition is met or timer expires.
9. Answer is revealed.
10. Scores/leaderboard update.
11. Streamer starts next round.

## 6. OBS Browser-Source View Model

The dashboard itself is the OBS browser source. A separate overlay route is not part of the MVP.

The layout is intentionally stream-ready:

- The drawing canvas, timer, word blanks, guess activity, solve progress, and leaderboard remain visible.
- The secret word is shown only inside the camera-frame region.
- In OBS, the streamer places their camera or another scene element over that camera-frame region, hiding the prompt from viewers.
- OAuth tokens and credentials are never rendered in the page.
- Settings and administrative controls should remain compact and unobtrusive during a round.

The camera-frame region must keep stable dimensions and a clearly marked safe area so the streamer can align their OBS camera source once and reuse the scene.

## 7. Win Conditions

### First Guess Wins

The first unique chatter to guess correctly ends the round.

Good for:

- Fast competitive rounds.
- Small chats.
- High tension.

Risk:

- Fast typists dominate.
- Large chats may solve too quickly.

### Crowd Solve Mode

The round ends only when a configurable number of unique chatters guess correctly.

Example:

- 5 correct chatters.
- 10 correct chatters.
- 25 correct chatters.

This should be a signature Findraw mode because it makes the entire chat participate rather than only rewarding the fastest person.

### Percentage Solve Mode

The round ends when a percentage of active guessers solve it.

Example:

- 20% of active participants solve.

This is useful for variable chat sizes but should come after the simpler threshold mode.

### Chill Mode

No winner pressure. The round ends by timer or streamer action.

Good for casual streams and art-focused sessions.

### Streamer Judge Mode

The streamer can manually accept a close/funny answer.

Useful when:

- Chat has spelling variations.
- The answer is subjective.
- The streamer wants to reward a creative guess.

## 8. Hint Mechanics

### Word Blanks

The browser-source view can show the structure of the answer.

Example:

`_ _ _ _ _   _ _ _ _`

Spaces should be visible. Punctuation may be shown or hidden depending on mode.

### Progress Colors

The blanks should visually show how close chat is to solving.

Suggested states:

- White: no one has solved yet.
- Orange: some correct guesses, but target not reached.
- Green: target reached / solved.

The progress can also behave like a bar:

- 0 / 10 solved.
- 4 / 10 solved.
- 10 / 10 solved.

### Timed Letter Reveal

Streamer can set automatic hint timing.

Examples:

- Reveal one letter every 30 seconds.
- Reveal one letter every 60 seconds.
- Reveal disabled.

Letters should reveal in a fair order. Early versions can reveal from left to right; later versions can reveal random unrevealed letters or more useful letters.

### Manual Hint Controls

Streamer controls:

- Reveal one letter.
- Reveal first letter.
- Reveal vowel.
- Reveal category.
- Reveal word length.
- Reveal alias hint.

### Close Guess Feedback

Future feature: show if a guess is close.

Possible rules:

- Similar spelling.
- Alias match.
- Missing plural.
- Missing punctuation.

This should be careful to avoid giving away the answer too quickly.

## 9. Categories

### Safe General Categories

These can be built in from the start:

- Everyday objects.
- Animals.
- Food.
- Places.
- Jobs.
- Actions.
- Emotions.
- Internet terms.
- Abstract concepts.

### Pop Culture Text Categories

These can exist as text prompts, not official media:

- Movies.
- TV shows.
- Books.
- Games.
- Famous people.
- Sports players.
- Cars.
- Brands.
- Songs.

Important rule:

Findraw provides text prompts, not copyrighted posters, clips, music, logos, or official artwork.

### Custom Streamer Packs

Streamers should eventually be able to create/import:

- Their own word lists.
- Inside jokes.
- Community memes.
- Channel-specific prompts.
- Sponsored-safe packs.

### Prompt Metadata

Each prompt should support:

- Answer.
- Category.
- Difficulty.
- Aliases.
- Tags.
- Optional disallowed hints.
- Optional safe/unsafe flag.

Example:

```ts
{
  answer: "Grand Theft Auto V",
  category: "games",
  aliases: ["gta v", "gta 5", "grand theft auto 5"],
  difficulty: "medium"
}
```

## 10. Copyright And Trademark Direction

The product should avoid shipping third-party copyrighted assets.

Lower-risk usage:

- Text-only titles and names.
- User-generated drawings during live play.
- Generic categories.
- Streamer-provided custom prompts.

Higher-risk usage to avoid:

- Official movie posters.
- Character art.
- Game screenshots.
- Music clips.
- Logos as category icons.
- Branding that implies official partnership.

Product rule:

Use words, not copyrighted content.

For trademarks, avoid implying endorsement. The game can have prompts like `Minecraft` or `Interstellar`, but should not present itself as official or sponsored by those brands.

## 11. Guess Matching

The guess matcher should normalize common differences:

- Case.
- Extra spaces.
- Punctuation.
- Hyphens.
- Ampersand vs `and`.
- Basic aliases.

Examples:

- `spider man`, `Spider-Man`, and `spiderman` may be accepted depending on aliases.
- `GTA V`, `gta 5`, and `Grand Theft Auto 5` should all match the same prompt if configured.

Later matcher improvements:

- Typo tolerance.
- Plural matching.
- Accent-insensitive matching.
- Multi-language packs.
- Mod-approved aliases during a round.

Fairness rules:

- Count only one correct guess per user per round.
- Ignore repeated correct guesses from the same user.
- Rate-limit spammy repeated messages.
- Keep the first correct timestamp.

## 12. Scoring

Early scoring can be simple:

- First correct guess gets most points.
- Later correct guesses get fewer points.
- Solving before hints gives bonus points.
- Hard categories multiply points.
- Streaks add bonus points.

Possible scoring model:

- First solver: 100 points.
- Second solver: 80 points.
- Later solvers: 50 points.
- Solved before first hint: +25.
- Hard mode: x1.5.

For Crowd Solve Mode:

- Each correct guesser gets points.
- Chat as a whole can score against the streamer.
- Streamer can get points if chat solves before a target time.

This creates a streamer-vs-chat meta game.

## 13. Drawing Direction

The current prototype used the full Excalidraw editor. That is useful for learning, but not the final direction.

The next version should build a custom drawing surface that borrows selected ideas from Excalidraw's technical approach without copying its UI/branding wholesale.

### Why Not Pull Full Excalidraw UI

- It looks like Excalidraw, not Findraw.
- It includes many tools we do not need.
- It makes the product feel like an embedded editor instead of a game.
- It increases bundle size.
- Customizing deeply may become harder than building the focused drawing layer.

### What We Want From Excalidraw

Study and selectively learn from:

- Smooth freehand stroke behavior.
- Pointer handling.
- Undo/redo approach.
- Scene element model.
- Rough hand-drawn visual feel.
- Canvas rendering patterns.

### What We Should Build Ourselves

- Canvas surface.
- Brush tool.
- Eraser tool.
- Clear canvas.
- Undo/redo.
- Custom toolbar.
- Custom icons.
- Stream-friendly layout.
- Drawing sync model.
- Dashboard/browser-source renderer.

### Drawing Tools For First Real Build

Start small:

- Brush.
- Eraser.
- Undo.
- Redo.
- Clear.
- Brush size.
- Color swatches.

Do not start with:

- Shapes.
- Text.
- Images.
- Arrows.
- Libraries.
- Advanced selection.
- Multi-object transforms.

This keeps the game drawing-focused and avoids becoming a general diagram editor.

## 14. Custom Canvas Technical Plan

### Canvas Engine

Use HTML Canvas for the first custom engine.

Core concepts:

- `Stroke` objects represent brush marks.
- Each stroke stores points, color, size, and tool type.
- The canvas redraws from the stroke list.
- Undo removes the last stroke/action.
- Redo restores removed actions.

Possible stroke type:

```ts
type Point = {
  x: number;
  y: number;
  pressure?: number;
  time: number;
};

type Stroke = {
  id: string;
  tool: "brush" | "eraser";
  color: string;
  size: number;
  points: Point[];
};
```

### Smooth Brush

Options:

1. Use `perfect-freehand` directly.
2. Implement simple quadratic curve smoothing first.
3. Study Excalidraw's freehand handling and adapt the concept.

Recommended:

Start with `perfect-freehand` because Excalidraw also uses it and it gives a polished stroke feel quickly without pulling Excalidraw UI.

### Eraser

Two possible eraser modes:

1. Stroke eraser: remove strokes that intersect the eraser path.
2. Pixel eraser: draw transparent strokes using canvas compositing.

Recommended first:

Use stroke eraser if we want clean undo/sync behavior, or pixel eraser if we want faster drawing feel.

For stream sync, stroke eraser is cleaner.

### Rendering Model

Every frame:

1. Clear canvas.
2. Fill background.
3. Draw all strokes in order.
4. Draw active stroke while pointer is down.
5. Draw cursor preview if needed.

### Input Support

Support:

- Mouse.
- Touch.
- Pen/stylus.
- Pointer events.

Use `PointerEvent` APIs:

- `pointerdown`.
- `pointermove`.
- `pointerup`.
- `pointercancel`.

Track pressure if available.

### Coordinate Handling

Canvas must handle:

- Device pixel ratio.
- Resize without losing drawing.
- Pointer coordinates relative to canvas bounds.

### Sync Model

The drawing should be represented as serializable state:

```ts
type DrawingScene = {
  strokes: Stroke[];
  background: string;
  updatedAt: number;
};
```

This can be sent to:

- OBS browser-source dashboard.
- Web room viewers.
- Desktop local server.
- Replay/export features later.

## 15. Toolbar Direction

The toolbar must be Findraw-branded, not Excalidraw-looking.

### Required Tools

- Brush icon.
- Eraser icon.
- Undo icon.
- Redo icon.
- Clear icon.
- Color swatches.
- Brush size slider.

### Icon Rule

Use custom icons or a neutral icon library. Do not copy Excalidraw's icons.

The visual tone should feel playful and streamer-friendly:

- Clear, big enough for quick use.
- Not cluttered.
- Good for tablet drawing.
- Works on a second monitor.

### Toolbar Layout

Possible layouts:

- Left vertical rail for drawing tools.
- Bottom rail for colors and size.
- Top bar for game controls.

Streamer dashboard should not feel like a document editor. It should feel like a live game control surface.

## 16. OBS Browser-Source Direction

Findraw is designed to be added directly to OBS as a browser source. The streamer then layers their camera source over Findraw's camera-frame/secret-word region.

The dashboard should therefore provide:

- A stable 16:9-friendly composition.
- A fixed camera cover zone that contains the private prompt.
- Canvas, timer, blanks/progress, guesses, solvers, and leaderboard in the same browser source.
- No separate overlay URL or cross-page state synchronization in the MVP.
- A future optional clean-view mode only if streamers request it after testing.

## 17. Dashboard Direction

The dashboard is both the streamer's control room and the browser-source scene.

Sections:

- Drawing canvas.
- Tool rail.
- Camera frame containing the secret word.
- Round controls.
- Guess feed.
- Correct solvers.
- Settings drawer.
- Category selector.

Important dashboard features:

- Big obvious `Start Round` button.
- `Skip` button.
- `Reveal Letter` button.
- `End Round` button.
- `Clear Drawing` confirmation or undo-friendly behavior.
- Stable camera-cover placement for OBS scene setup.

## 18. Chat Integration Plan

Do not couple game logic directly to Twitch.

Use a normalized guess input interface:

```ts
type GuessMessage = {
  userId: string;
  username: string;
  message: string;
  source: "manual" | "twitch" | "youtube" | "kick" | "web";
  at: number;
};
```

Then adapters can feed into the same engine:

- Manual test input.
- Twitch chat.
- YouTube chat.
- Kick chat.
- Web room chat.

### First Chat Step

Manual fake chat input for development.

This is not a throwaway feature. It is the debug adapter for the real guess pipeline.

### Twitch Step

Later use Twitch IRC/EventSub/chat APIs.

Needs:

- OAuth.
- Channel selection.
- Message listener.
- Reconnect handling.
- Rate limit awareness.
- Mod/broadcaster permissions.

## 19. Architecture Direction

Start with one app, but keep boundaries clean.

Suggested folders for the next implementation:

```text
src/
  app/
    App.tsx
    routes.tsx
  canvas/
    CanvasStage.tsx
    canvasTypes.ts
    drawStroke.ts
    geometry.ts
    tools.ts
  game/
    engine.ts
    matcher.ts
    scoring.ts
    types.ts
  words/
    builtInPacks.ts
    wordTypes.ts
  chat/
    guessInput.ts
    manualAdapter.ts
  dashboard/
    Dashboard.tsx
  ui/
    IconButton.tsx
    Toolbar.tsx
    Slider.tsx
    Swatch.tsx
```

Future split:

```text
apps/
  web/
  desktop/
packages/
  game-core/
  canvas-core/
  chat-core/
  shared-ui/
```

Do not split too early. Keep it simple until boundaries become real.

## 20. First Real Build Sequence

### Step 1: Project Document

Create this brief and align on direction.

### Step 2: Minimal App Shell

Build a clean app shell without Excalidraw UI:

- Dashboard layout.
- Empty canvas area.
- Custom toolbar placeholders.
- Secret word panel.
- Stable camera-cover safe area for OBS.

### Step 3: Custom Canvas Brush

Implement:

- Pointer drawing.
- Smooth strokes.
- Brush size.
- Brush color.
- Undo.
- Clear.

### Step 4: Eraser

Implement:

- Stroke eraser.
- Cursor preview.
- Undoable eraser actions.

### Step 5: Game Engine

Implement:

- Start round.
- Prompt selection.
- Guess matcher.
- Solve target.
- Timer.
- Letter reveal.

### Step 6: OBS Browser-Source Polish

Implement:

- Stable camera-cover safe area.
- Browser-source-friendly 16:9 layout.
- Private prompt containment inside the covered camera region.
- Canvas, blanks, timer, solve progress, and recent solvers in one page.

### Step 7: Live Chat Sync

Connect normalized Twitch chat messages to the local round engine and keep the single dashboard view updated in real time.
- WebSocket/local server later.

### Step 8: Twitch Adapter

Add real chat input only after manual adapter proves the engine.

## 21. MVP Scope

The first usable MVP should include:

- Custom canvas brush.
- Custom eraser.
- Custom icons.
- Undo/redo.
- Clear canvas.
- Word categories.
- Secret word dashboard.
- Stream-safe browser-source dashboard.
- Manual guess input.
- First guess mode.
- Crowd solve mode.
- Timed letter reveal.
- Basic leaderboard.

Out of scope for MVP:

- Full Excalidraw editor.
- Shapes/text/images.
- Desktop app packaging.
- OBS WebSocket setup.
- Twitch OAuth.
- Payments/accounts.
- Public rooms.

## 22. Visual Direction

Findraw should not look like Excalidraw.

Desired feel:

- Streamer-native.
- Game-like but not childish.
- Clean enough for OBS.
- Fast to scan while live.
- Strong contrast.
- Custom toolbar identity.

Avoid:

- Generic SaaS dashboard look.
- Excalidraw toolbar clone.
- Overly decorative landing page.
- Huge marketing hero as the main screen.
- Cluttered editor UI.

## 23. Naming And Identity

Working name: Findraw.

Possible positioning:

- "Draw it. Chat finds it."
- "A live drawing game for streamers and chat."
- "Streamer draws, chat solves."

The name and UI should make it clear this is its own product.

## 24. Technical Risks

### Canvas Feel

The brush must feel smooth. Bad drawing feel will kill the game even if the rules work.

Mitigation:

- Use pointer events properly.
- Use smoothing.
- Test mouse/touch/pen.
- Keep latency low.

### OBS Prompt Coverage

The browser source must not expose the secret prompt outside the camera-cover region.

Mitigation:

- Render the answer only inside the fixed camera safe area.
- Keep that region stable across responsive layouts.
- Clearly mark the region during OBS setup and test common 16:9 source sizes.

### Chat Spam

Large chats may spam guesses.

Mitigation:

- Normalize guesses cheaply.
- Deduplicate per user.
- Rate limit repeated wrong guesses.
- Keep matcher efficient.

### IP Safety

Pop culture categories can create trademark/copyright concerns if handled poorly.

Mitigation:

- Text prompts only.
- No official art/logos/media.
- Custom packs are user-managed.
- Avoid official/sponsored wording.

### Scope Creep

Drawing tools can expand endlessly.

Mitigation:

- Brush and eraser first.
- Add shapes/text only if gameplay truly needs them.

## 25. Next Immediate Task

Build the new foundation step by step:

1. Create a minimal app shell.
2. Build custom canvas with brush.
3. Add custom toolbar icons.
4. Add eraser.
5. Add undo/redo.
6. Add game engine.
7. Polish the OBS browser-source layout and camera safe area.

Important constraint:

Do not pull the full Excalidraw component into the pipeline. Study Excalidraw's ideas and local source when useful, but build Findraw's drawing surface as our own focused game canvas.
