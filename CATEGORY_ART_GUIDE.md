# Findraw Category Artwork Guide

Use this guide with a new game's source artwork so another AI chat can create a category card consistent with Findraw's existing game cards.

## Core rule

Do not ask the image model to invent an illustration inspired by the game. Use the existing logo, app icon, or key art as the **exact edit target** and request a medium-only style transfer.

The recognizable subjects, poses, layout, symbols, colors, and required text remain fixed. Only the rendering medium changes from polished digital art to graphite and colored pencil.

- Bad: "Draw a pencil illustration representing Valorant."
- Good: "Convert only this Valorant logo's rendering medium into pencil. Preserve the exact emblem, lettering, spacing, and composition."

## Method used for the existing cards

- Tool mode: built-in image-generation tool.
- Intent: image edit, not generation from scratch.
- Use-case slug: `style-transfer`.
- Inputs: one source image and one game per call.
- Master composition: 3:2 landscape, normally 1536 x 1024.
- Website file: 900 x 600 WebP.
- Destination: `public/category-art/`.
- Naming: `<category-slug>-sketch.webp`.

Never combine several games into one input or one call. Separate calls prevent mixed identities and make corrections targeted.

## 1. Pick a recognizable source

Preferred order:

1. Clean official app icon or emblem.
2. Official key art with one or two unmistakable characters.
3. Official title treatment with a recognizable symbol.
4. A promotional scene only when no compact logo or icon exists.

Choose an image with a strong focal point that still reads when cropped to 3:2. Avoid UI screenshots, crowded collages, tiny subjects, and fan art of uncertain origin. Use only artwork the project is permitted to use; a pencil transformation remains derivative artwork and trademarks remain trademarks.

## 2. Attach it as the edit target

The source must be visible to the model immediately before the request.

In another AI chat:

1. Attach the source image.
2. Say: "The attached image is the exact edit target, not loose inspiration."
3. Paste the prompt below.

In Codex, inspect/display the local image first, then make one built-in image-edit call using only that most recent image. Do not include unrelated visual references.

The exact Codex workaround used in this Windows workspace was:

```js
var fsArt = await import("node:fs/promises");
await nodeRepl.emitImage(
  await fsArt.readFile("D:/dev/projects/Findraw/public/category-art/GAME-SOURCE.jpg")
);
```

Then call the built-in image editor with the prompt and `num_last_images_to_include: 1`. This makes the displayed source the sole edit target. On systems where direct local-image attachment works, attach or inspect the file normally instead.

The built-in tool saves its master under `$CODEX_HOME/generated_images/...`. Copy the accepted master into the workspace before converting it; never make the website depend on the generated-images location.

```powershell
Copy-Item -LiteralPath "C:\Users\USER\.codex\generated_images\...\accepted.png" `
  -Destination "public\category-art\GAME-SLUG-sketch.png"
```

## 3. Master prompt template

Replace every bracketed field. Remove the `Text` paragraph when the source has no title.

```text
Use case: style-transfer.
Asset type: Findraw category-card artwork.

Input image: The attached/most recent image is the exact edit target, not loose inspiration.

Primary request: Convert ONLY the rendering medium of the source image into a hand-drawn sketchbook illustration. Preserve the immediately recognizable [GAME NAME] identity and the exact source composition: [LIST 3–6 DEFINING FEATURES].

Style/medium: Confident graphite pencil contours and cross-hatching with restrained [IMPORTANT BRAND COLORS] colored-pencil washes on warm cream sketchbook paper. Use visible hand strokes and subtle paper grain.

Composition/framing: Adapt cleanly to a 3:2 landscape category card. Keep [MAIN SUBJECTS OR LOGO] fully readable and large enough for the narrow panel. The artwork or colored-pencil field should fill almost the entire frame.

Edge treatment: Match the Findraw Fortnite card. Apply only a very narrow, subtle feather at the outermost 2–4% of all four edges, gently revealing warm cream paper. The fade must start at the physical image edge and move inward only slightly. It must NOT begin around the subject or near the middle, create a large cream halo, or shrink the artwork.

Text: Preserve the exact text "[EXACT TITLE]" verbatim when it appears in the source. Keep its spelling, letter order, placement, and recognizable letter shapes.

Constraints: Change only the medium and texture. Keep the source identity, subjects, poses, symbols, relative placement, major colors, and visual hierarchy unchanged. The result must be recognizable before reading the category caption below the card.

Avoid: A redesigned logo, generic fan art, substituted characters, changed poses, extra or missing focal objects, garbled text, altered spelling, cropped title, black bars, glossy 3D, photorealism, watercolor, UI elements, signature, or watermark.
```

### Mandatory card coverage and edge-fade rule

Apply this to every new game image, even when the source is square, portrait, or already has rounded colored panels.

- The artwork and its colored-pencil field must fill the full 3:2 card composition.
- Important content must reach close to the top, bottom, left, and right without being cropped.
- Only the outermost 2-4% of each physical image edge may fade into cream paper.
- The fade starts at the edge and travels inward slightly. It never starts around the subject or near the middle.
- Split compositions must reach both sides: the left field reaches the left edge and the right field reaches the right edge.
- Do not leave wide cream gutters, large blank halos, or a smaller rounded image floating inside the card.
- Do not compensate with `object-fit`, per-game padding, or category-specific CSS. Correct the generated asset itself.
- Inspect the result at approximately 220 x 150 pixels, because a fade visible at full resolution can disappear after the website applies rounded clipping.
- Findraw also applies a universal seven-pixel edge blend in `.category-art::after`; this is a final consistency layer, not a substitute for correct image coverage.

Add this paragraph to every generation or correction prompt:

```text
Card-fit requirement: Fill the complete 3:2 card with the main artwork and colored-pencil field. Extend the composition nearly to all four physical image edges. Keep only a narrow, subtle warm-cream paper fade within the outermost 2-4% of each edge. The fade must begin at the physical edge and move inward only slightly. Do not create wide side gutters, a large blank halo, a central vignette, or a smaller rounded colored panel floating inside cream paper. Verify the result at narrow website-card size, not only at full resolution.
```

For a left/right split such as Clash Royale, append:

```text
The left color field must reach nearly to the physical left edge and the right color field must reach nearly to the physical right edge. Preserve the centered split. Do not let either side stop short or leave cream gutters beside it.
```

## 4. Describe invariants precisely

Do not say only "keep it similar." Name what must not drift.

For a logo, describe:

- Outer silhouette and number/direction of pieces.
- Negative spaces and cutouts.
- Exact wordmark spelling.
- Emblem-to-wordmark placement.
- Dominant foreground and background colors.

For character key art, describe:

- Number of principal characters.
- Left/right placement, pose, and facing direction.
- Distinctive crown, clothing, weapon, mask, or silhouette.
- Major split, background motif, and title location.

For a pixel icon, describe:

- Exact pixel geometry and symmetry.
- Eye/opening positions.
- Stepped edges.
- Background field.
- Explicitly prohibit rounding or smoothing the pixels.

## 5. Prompt set used for the current games

### Valorant

```text
Use case: style-transfer. Asset type: Findraw category-card artwork. The most recent image is the exact edit target. Convert only the rendering style into a hand-drawn sketchbook illustration. Preserve the exact recognizable Valorant composition: the two-part angular V emblem, its negative space, the exact VALORANT wordmark, emblem-to-wordmark spacing, and coral-red field. Render with graphite pencil outlines and cross-hatching plus restrained coral-red colored-pencil shading on warm cream sketchbook paper, visible hand strokes, and subtle paper grain. Preserve the centered emblem above the wordmark and adapt it to a clean 3:2 landscape card with balanced breathing room. Preserve "VALORANT" verbatim with the same recognizable stylized letter shapes. Change only medium and texture; keep geometry, spelling, placement, proportions, and colors immediately recognizable. Avoid a redesigned emblem, ordinary sans-serif lettering, garbled text, extra symbols, cropped wordmark, glossy 3D, photorealism, black bars, or watermark.
```

### Rainbow Six Siege

```text
Use case: style-transfer. Asset type: Findraw category-card artwork. The most recent image is the exact edit target, not loose inspiration. Convert ONLY the rendering medium of this Rainbow Six Siege wordmark into a hand-drawn sketchbook illustration. Preserve the exact stacked composition and text: small condensed “RAINBOW 6” centered above the large heavy “SIEGE” wordmark, including every letter, spacing, proportions, angular cuts, and black silhouette. Render with dense graphite and soft charcoal pencil on warm cream paper, with restrained pale-blue, dusty-blush, and muted-beige colored-pencil marks behind it. Keep the wordmark large and centered in a clean 3:2 card. Extend the colored-pencil field across almost the entire card, then fade only within the outermost 2–4% of each edge. The fade starts at the image edge and must not create a central cream halo. Preserve “RAINBOW 6” and “SIEGE” verbatim. Avoid garbled text, redesigned letters, a small logo, large blank margins, hard boundaries, glossy 3D, signature, or watermark.
```

### Minecraft

```text
Use case: style-transfer. Asset type: Findraw category-card artwork. The most recent image is the exact edit target. Convert only the rendering style into a hand-drawn sketchbook illustration. Preserve the exact Minecraft Creeper face: pixel-square eyes, central nose bridge, stepped black mouth, symmetry, and bright-green field. Render with firm graphite outlines and dense green and black colored-pencil fill on warm cream sketchbook paper. Keep the face large, centered, and geometrically exact; extend the green pencil field into a clean 3:2 landscape card. Change only medium and texture. Avoid rounded pixels, a 3D Creeper body, facial redesign, scenery, text, gradients, black bars, or watermark.
```

### Fortnite

```text
Use case: style-transfer. Asset type: Findraw category-card artwork. The most recent image is the exact edit target. Convert only the rendering style into a hand-drawn sketchbook illustration. Preserve the exact Fortnite F lettermark: its tall angular silhouette, cut-ins, slanted lower edge, white fill, and blue background. Render with graphite outline, white paper/pencil fill, and a restrained bright-blue colored-pencil field on warm cream sketchbook paper. Keep the F centered with generous breathing room in a clean 3:2 landscape card. Change only medium and texture; preserve the exact silhouette and proportions. Avoid a normal typed F, altered angles, extra scenery, cropped letter, glossy 3D, photorealism, black bars, or watermark.
```

### Deadlock

```text
Use case: style-transfer. Asset type: Findraw category-card artwork. The most recent image is the exact edit target. Convert only the rendering style into a hand-drawn sketchbook illustration. Preserve the recognizable Deadlock composition: exact DEADLOCK title, circular wheel emblem, opposing character silhouettes, branching upper silhouette, and muted teal-green atmosphere. Render with dark graphite and charcoal cross-hatching plus restrained teal, green, and cream colored-pencil washes on warm paper. Preserve the centered title, adjacent emblem, and silhouettes in a clean 3:2 landscape card. Preserve "DEADLOCK" verbatim. Change only medium and texture. Avoid misspelled text, redesigned emblem, generic fantasy characters, removed silhouettes, glossy 3D, photorealism, black bars, or watermark.
```

### Clash Royale

```text
Use case: style-transfer. Asset type: Findraw category-card artwork. The most recent image is the exact edit target. Convert ONLY its rendering medium into a hand-drawn sketchbook illustration. Preserve the immediately recognizable Clash Royale composition exactly: the two opposing crowned kings, their faces and mustaches, central jagged lightning split, blue left half, red right half, crown colors, and close symmetrical framing. Render with confident graphite pencil contours and cross-hatching plus restrained blue, red, gold, and skin-tone colored-pencil washes on warm cream sketchbook paper, with visible hand strokes and subtle paper grain. Adapt cleanly to a 3:2 landscape card while keeping both full faces and crowns readable. Extend the blue field nearly to the physical left edge and the red field nearly to the physical right edge; keep only the outermost 2–4% as a subtle cream-paper fade. Do not leave wide side margins or floating rounded color panels. Do not invent or redesign anything. Avoid altered characters, changed poses, extra or missing objects, text, logos, black empty bars, glossy 3D, photorealism, watercolor, or a generic medieval scene.
```

### Clash of Clans

```text
Use case: style-transfer. Asset type: Findraw category-card artwork. The most recent image is the exact edit target, not loose inspiration. Convert ONLY the rendering medium of the Clash of Clans Barbarian portrait into a hand-drawn sketchbook illustration. Preserve the exact close-up character and expression: oversized angular yellow hair and horseshoe mustache, blue eyes looking upward, raised brows, open mouth and uneven square teeth, pink tongue, and saliva droplets. Render with graphite contours and cross-hatching plus restrained golden-yellow, skin-tone, pale-blue, pink, and deep-purple colored-pencil washes on warm cream paper. Adapt naturally to a 3:2 card without stretching the face. Keep the character large and let the purple pencil background fill almost the entire frame. Fade only the outermost 2–4% into cream paper, beginning at the physical edge—not around the character or middle. Avoid a generic Viking, changed expression, helmet, weapons, text, a hard purple rectangle, large blank margin, vignette, border, glossy 3D, signature, or watermark.
```

## 6. Quality gate

The result passes only when:

- A fan can identify the game without the caption.
- Principal subjects match the source instead of generic substitutes.
- Emblems retain their defining silhouette and negative space.
- Required title text is spelled exactly.
- No important face, crown, weapon, emblem, or title is cropped.
- The artwork fills 3:2 without black bars.
- The colored-pencil field reaches nearly to every edge; only the outermost 2–4% fades into cream paper.
- There is no large empty halo or fade beginning near the middle.
- Pencil marks remain visible, including at card size.
- Brand colors look like restrained pencil washes, not digital gradients.
- The background reads as warm cream paper.
- There is no signature, watermark, or invented UI.

Reject a result that merely looks "inspired by" the game.

## 7. Targeted correction prompts

Continue editing the closest result. Correct one issue at a time and repeat all invariants that must remain unchanged.

Logo drift:

```text
Keep the current pencil medium, paper texture, framing, and colors unchanged. Correct only the emblem geometry to match the attached source exactly, including its outer silhouette, cutouts, negative space, angles, and proportions. Do not redesign or simplify it.
```

Misspelled title:

```text
Keep every visual element unchanged. Correct only the title so it reads "[EXACT TITLE]" verbatim. Preserve the source letter order, recognizable letter shapes, placement, scale, and spacing. Add no other text.
```

Generic characters:

```text
Keep the pencil style and layout unchanged. Restore only the principal characters to match the source: [CHARACTERS AND DISTINCTIVE FEATURES]. Preserve their poses, left/right placement, clothing, facial features, and equipment.
```

Too polished:

```text
Preserve all subjects, text, geometry, positions, and colors. Change only the surface treatment: make graphite contours, cross-hatching, colored-pencil strokes, uneven hand pressure, and cream paper grain clearly visible. Remove glossy rendering, smooth gradients, and 3D shine.
```

Bad framing:

```text
Preserve the artwork and pencil style. Reframe only to a 3:2 landscape card, keeping [FOCAL SUBJECTS] fully visible and centered with balanced breathing room. Fill the frame naturally without stretching, black bars, or new scenery.
```

## 8. Prepare the site asset

Keep the full-resolution master until it passes review. Then create the delivery file with the same settings used for the current cards:

```powershell
ffmpeg -hide_banner -loglevel error -y `
  -i "public/category-art/GAME-SLUG-sketch.png" `
  -vf "scale=900:600:flags=lanczos" `
  -c:v libwebp `
  -quality 90 `
  -compression_level 6 `
  "public/category-art/GAME-SLUG-sketch.webp"
```

`900:600` standardizes every card. Lanczos preserves edges and pencil texture. WebP quality 90 retains grain without shipping multi-megabyte PNGs.

## 9. Add the card to Findraw

1. Save it as `public/category-art/<category-slug>-sketch.webp`.
2. Add the slug to `SKETCHED_GAME_CATEGORIES` in `src/dashboard/SupportPanel.tsx`.
3. Do not create category-specific sizing or `object-fit` CSS. Correct the asset itself to 3:2. The universal `.category-art::after` treatment in `src/styles.css` adds the final narrow seven-pixel paper blend after rounded clipping, so never replace it with per-game fades.
4. Confirm `/category-art/<category-slug>-sketch.webp` returns HTTP 200.
5. Inspect it inside the narrow category panel, not only at full resolution.
6. Keep the original source file for provenance and future corrections.

Run:

```powershell
pnpm build
git diff --check
```

## Copy-paste delegation request

```text
Create a new Findraw game-category card by editing the attached source artwork.

Read CATEGORY_ART_GUIDE.md and follow it exactly. This is a source-preserving style-transfer edit, not a new illustration inspired by the game. Preserve the exact recognizable logo/characters/composition and change only the medium to Findraw's graphite-and-colored-pencil style on warm cream paper.

Use one image-edit call for this game. Produce a 3:2 landscape master, inspect recognizability and exact text, then create a 900x600 WebP named public/category-art/[GAME-SLUG]-sketch.webp.

Add [GAME-SLUG] to SKETCHED_GAME_CATEGORIES in src/dashboard/SupportPanel.tsx, run pnpm build and git diff --check, and report the final prompt and saved path.
```