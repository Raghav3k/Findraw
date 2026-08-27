type ArtistGameMarkProps = { packId: string };

export function ArtistGameMark({ packId }: ArtistGameMarkProps) {
  const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };
  let mark: React.ReactNode;

  switch (packId) {
    case "game-minecraft":
      mark = <><path d="M12 3 20 7.4v9.2L12 21l-8-4.4V7.4L12 3Z" /><path d="m4 7.4 8 4.4 8-4.4M12 11.8V21M8 5.2l8 4.4" /></>;
      break;
    case "game-valorant":
      mark = <><path d="M8 4H5v4M16 4h3v4M8 20H5v-4M16 20h3v-4" /><circle cx="12" cy="12" r="4" /><path d="M12 9v6M9 12h6" /></>;
      break;
    case "game-fortnite":
      mark = <><path d="M4 19h16M5 17h4v-4h4V9h4V5h3" /><path d="M6 17V9h4v4M14 9V5h3" /></>;
      break;
    case "game-league":
      mark = <><path d="M4 19 19 4M5 5l14 14M4 12h16" /><circle cx="5" cy="5" r="1.8" /><circle cx="19" cy="19" r="1.8" /><circle cx="12" cy="12" r="2.2" /></>;
      break;
    case "game-gta":
      mark = <><path d="M3 17h18M5 17l1.6-5h10.8l1.6 5M8 12l1.2-4h5.6l1.2 4" /><circle cx="7" cy="18" r="1.7" /><circle cx="17" cy="18" r="1.7" /><path d="M4 9V5h3v4M18 9V3h2v6" /></>;
      break;
    case "game-deadlock":
      mark = <><path d="M8 11V8a4 4 0 0 1 8 0v3M6 11h12v9H6z" /><circle cx="12" cy="15" r="1.5" /><path d="M12 16.5V18M3 8h2M19 8h2" /></>;
      break;
    case "game-clash-royale":
      mark = <><path d="M4 19V9h5v10M15 19V9h5v10M3 19h18M9 14h6" /><path d="M6 9V6M18 9V6M11 6h2v3h-2z" /></>;
      break;
    case "game-clash-of-clans":
      mark = <><path d="M4 20V9h4v3h4V9h4v3h4v8H4Z" /><path d="m8 8 7-5M13 3l3 3M12 13v7" /></>;
      break;
    case "game-rainbow-six-siege":
      mark = <><path d="M6 21V3h12v18M6 18h12" /><path d="m9 5 3 4-2 3 4 3-2 3M15 7h1M15 17h1" /></>;
      break;
    case "game-dota-2":
      mark = <><path d="M4 18 18 4M4 12 12 4M12 20l8-8" /><circle cx="5" cy="18" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="19" cy="12" r="1.5" /></>;
      break;
    case "game-arc-raiders":
      mark = <><path d="M6 9h12l2 4-2 6H6l-2-6 2-4Z" /><path d="M9 9V6h6v3M12 6V3M10 14h4M7 12h2M15 12h2" /></>;
      break;
    case "game-genshin-impact":
      mark = <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="M5 16c2.2 3.2 6.4 4.5 10 2.8M19 8c-1.6-2.8-4.8-4.4-8-4" /></>;
      break;
    case "game-deep-rock-galactic":
      mark = <><path d="m5 4 7 7M19 4l-7 7M7 3 2 2-5 5-2-2 5-5ZM17 3l-2 2 5 5 2-2-5-5Z" /><path d="m12 12 4 4-4 5-4-5 4-4Z" /></>;
      break;
    case "game-risk-of-rain-2":
      mark = <><circle cx="15" cy="8" r="4" /><path d="M3 18 13 8M7 21l9-9M13 21l5-5M4 7h4M3 11h5" /></>;
      break;
    case "game-hunt-showdown":
      mark = <><circle cx="12" cy="12" r="6" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m9 15 3-6 3 6-3-1.5L9 15Z" /></>;
      break;
    case "game-brawlhalla":
      mark = <><path d="M4 18h16M7 15h10M7 5l10 10M17 5 7 15" /><path d="m5 4 4 1-3 3-1-4ZM19 4l-4 1 3 3 1-4Z" /></>;
      break;
    default:
      mark = <><circle cx="12" cy="12" r="7" /><path d="m9 8 7 4-7 4V8Z" /></>;
  }

  return <svg aria-hidden="true" className="artist-game-mark" viewBox="0 0 24 24" {...common}>{mark}</svg>;
}
