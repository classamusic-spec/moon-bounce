import './ui/styles.css';
import { Game } from './main_game';
import { assets } from './systems/assets';

// Entry point: preload optional art, then build the game into #game and start it.
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

function setLoadProgress(loaded: number, total: number): void {
  const fill = document.getElementById('loadFill');
  if (fill) fill.style.width = (total > 0 ? Math.round((loaded / total) * 100) : 100) + '%';
}

function hideLoading(): void {
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('hide');
  setTimeout(() => el.remove(), 500);
}

async function start(): Promise<void> {
  if (!webglSupported()) {
    showFallback('This game needs 3D graphics (WebGL), which this browser has turned off. Try a different browser, or enable hardware acceleration.');
    hideLoading();
    return;
  }
  try {
    await assets.preload(setLoadProgress);
    const game = new Game(container!);
    game.init();
    // Expose a small debug hook (handy for headless tests / driving state).
    (window as unknown as { __game: Game }).__game = game;
    hideLoading();
  } catch (e) {
    showFallback('Something went wrong starting the game. Please refresh to try again.');
    hideLoading();
    throw e;
  }
}

void start();
