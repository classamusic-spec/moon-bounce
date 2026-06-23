import './ui/styles.css';
import { Game } from './main_game';

// Entry point: build the game into #game and start it.
const container = document.getElementById('game');
if (!container) throw new Error('Missing #game container');

const game = new Game(container);
game.init();

// Expose a small debug hook (handy for headless tests / driving state).
(window as unknown as { __game: Game }).__game = game;
