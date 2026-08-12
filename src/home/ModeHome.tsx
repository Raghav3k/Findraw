import { AutoDrawCanvas } from "../autoDraw/AutoDrawCanvas";
import { AUTO_DRAW_ASSETS } from "../autoDraw/autoDrawAssets";

type ModeHomeProps = { onNavigate: (path: string) => void };

export function ModeHome({ onNavigate }: ModeHomeProps) {
  return <main className="mode-home"><div className="mode-home-paper">
    <header className="mode-home-header">
      <div className="mode-home-brand"><h1>Findraw</h1></div>
    </header>
    <section className="mode-grid" aria-label="Game modes">
      <button className="mode-card room-mode-card" onClick={() => onNavigate("/room")} type="button">
        <span className="mode-card-tape"/><div className="mode-card-preview room-preview" aria-hidden="true"><span className="room-preview-avatar one">A</span><span className="room-preview-avatar two">B</span><span className="room-preview-avatar three">C</span><span className="room-preview-board"><i/><i/><i/></span><span className="material-symbols-outlined room-preview-icon">groups</span></div>
        <span className="mode-card-number">01</span><div className="mode-card-copy"><span className="mode-card-label">Local prototype</span><h2>Room Mode</h2><p>Friends join a room, take turns drawing, guess fast, and climb the leaderboard.</p><span className="mode-card-action">Open room table <span className="material-symbols-outlined">arrow_forward</span></span></div>
      </button>
      <button className="mode-card artist-mode-card" onClick={() => onNavigate("/draw")} type="button">
        <span className="mode-card-tape"/><div className="mode-card-preview artist-preview" aria-hidden="true"><span className="material-symbols-outlined artist-preview-hand">stylus_note</span><span className="artist-preview-line line-one"/><span className="artist-preview-line line-two"/><span className="artist-preview-line line-three"/><span className="artist-preview-star">★</span></div>
        <span className="mode-card-number">02</span><div className="mode-card-copy"><span className="mode-card-label">Classic game</span><h2>Artist Mode</h2><p>You draw the secret word while Twitch chat races to solve it.</p><span className="mode-card-action">Open artist desk <span className="material-symbols-outlined">arrow_forward</span></span></div>
      </button>
      <button className="mode-card auto-mode-card" onClick={() => onNavigate("/auto-draw")} type="button">
        <span className="mode-card-tape"/><div className="mode-card-preview auto-preview" aria-hidden="true"><AutoDrawCanvas active asset={AUTO_DRAW_ASSETS[0]} stageIndex={2} stageProgress={0.72}/><span className="auto-preview-badge">3/6</span></div>
        <span className="mode-card-number">03</span><div className="mode-card-copy"><span className="mode-card-label">New game</span><h2>Auto Draw</h2><p>Findraw draws in timed stages. The streamer and chat guess together.</p><span className="mode-card-action">Try the practical proof <span className="material-symbols-outlined">arrow_forward</span></span></div>
      </button>
    </section>
    <footer className="mode-home-footer"><span>Notebook build · Twitch ready</span><span>Pick a page and start a round</span></footer>
  </div></main>;
}

