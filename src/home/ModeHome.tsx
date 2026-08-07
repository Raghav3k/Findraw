import { AutoDrawCanvas } from "../autoDraw/AutoDrawCanvas";
import { AUTO_DRAW_ASSETS } from "../autoDraw/autoDrawAssets";

type ModeHomeProps = { onNavigate: (path: string) => void };

export function ModeHome({ onNavigate }: ModeHomeProps) {
  return <main className="mode-home"><div className="mode-home-paper">
    <header className="mode-home-header">
      <div className="mode-home-brand"><span className="mode-home-kicker">Live drawing sketchbook</span><h1>Findraw</h1><p>Choose who holds the pencil.</p></div>
      <div className="mode-home-note"><span className="material-symbols-outlined">draw</span><strong>Two ways to play</strong><small>Both modes can share categories, Twitch chat, and Findraw points.</small></div>
    </header>
    <section className="mode-grid" aria-label="Game modes">
      <button className="mode-card artist-mode-card" onClick={() => onNavigate("/draw")} type="button">
        <span className="mode-card-tape"/><div className="mode-card-preview artist-preview" aria-hidden="true"><span className="material-symbols-outlined artist-preview-hand">stylus_note</span><span className="artist-preview-line line-one"/><span className="artist-preview-line line-two"/><span className="artist-preview-line line-three"/><span className="artist-preview-star">★</span></div>
        <span className="mode-card-number">01</span><div className="mode-card-copy"><span className="mode-card-label">Classic game</span><h2>Artist Mode</h2><p>You draw the secret word while Twitch chat races to solve it.</p><span className="mode-card-action">Open artist desk <span className="material-symbols-outlined">arrow_forward</span></span></div>
      </button>
      <button className="mode-card auto-mode-card" onClick={() => onNavigate("/auto-draw")} type="button">
        <span className="mode-card-tape"/><div className="mode-card-preview auto-preview" aria-hidden="true"><AutoDrawCanvas active asset={AUTO_DRAW_ASSETS[0]} stageIndex={2} stageProgress={0.72}/><span className="auto-preview-badge">3/6</span></div>
        <span className="mode-card-number">02</span><div className="mode-card-copy"><span className="mode-card-label">New game</span><h2>Auto Draw</h2><p>Findraw draws in timed stages. The streamer and chat guess together.</p><span className="mode-card-action">Try the practical proof <span className="material-symbols-outlined">arrow_forward</span></span></div>
      </button>
    </section>
    <footer className="mode-home-footer"><span>Notebook build · Twitch ready</span><span>Pick a page and start a round</span></footer>
  </div></main>;
}

