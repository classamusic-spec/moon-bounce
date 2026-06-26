import './ui/styles.css';
import { Game } from './main_game';

// Entry point: build the game into #game and start it.
const container = document.getElementById('game');
if (!container) throw new Error('Missing #game container');

function webglSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function showFallback(msg: string): void {
  const d = document.createElement('div');
  d.setAttribute('style', 'position:fixed;inset:0;z-index:99;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;text-align:center;color:#fff;background:radial-gradient(ellipse at 50% 40%,#1a1f4a,#06061a 75%);font-family:system-ui,sans-serif;');
  d.innerHTML = '<div style="font-size:64px">🪐</div><div style="font-size:22px;font-weight:800">Moon Bounce</div><div style="font-size:16px;max-width:340px;opacity:.85;line-height:1.5">' + msg + '</div>';
  document.body.appendChild(d);
}

if (!webglSupported()) {
  showFallback('This game needs 3D graphics (WebGL), which this browser has turned off. Try a different browser, or enable hardware acceleration.');
} else {
  try {
    const game = new Game(container);
    game.init();
    // Expose a small debug hook (handy for headless tests / driving state).
    (window as unknown as { __game: Game }).__game = game;
  } catch (e) {
    showFallback('Something went wrong starting the game. Please refresh to try again.');
    throw e;
  }
}
