import { PLANETS } from '../data/planets';
import { FLIGHT_SECONDS } from '../core/constants';
import type { Game } from '../main_game';

// All DOM / HUD / menu wiring. View methods plus a single bind(game) that
// hooks every button and key to game state. Ported from the prototype's HUD
// helpers + bindControls().
export class UI {
  private settingsReturn = 'menu';

  byId(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error('Missing element #' + id);
    return el;
  }

  bySel(sel: string): HTMLElement {
    const el = document.querySelector(sel);
    if (!el) throw new Error('Missing element ' + sel);
    return el as HTMLElement;
  }

  setPlanetName(name: string): void { this.byId('planetName').textContent = name; }

  setHUD(stars: number, boxesFound: number): void {
    this.byId('starCount').textContent = String(stars);
    this.byId('boxCount').textContent = boxesFound + '/5';
  }

  setSettingToggle(id: string, on: boolean): void {
    const t = document.getElementById(id);
    if (t) { t.textContent = on ? 'ON' : 'OFF'; t.classList.toggle('off', !on); }
  }

  buildPlanetDots(): void {
    const wrap = this.byId('planets'); wrap.innerHTML = '';
    PLANETS.forEach(p => {
      const d = document.createElement('div'); d.className = 'pdot';
      d.style.background = '#' + (p.sky[1].toString(16).padStart(6, '0'));
      const l = document.createElement('span'); l.className = 'lock'; l.textContent = '🔒'; d.appendChild(l);
      wrap.appendChild(d);
    });
  }

  updatePlanetDots(pIndex: number): void {
    document.querySelectorAll('.pdot').forEach((d, i) => {
      d.classList.toggle('locked', i > pIndex);
      d.classList.toggle('current', i === pIndex);
      const lock = d.querySelector('.lock') as HTMLElement | null;
      if (lock) lock.style.display = i > pIndex ? 'block' : 'none';
    });
  }

  updateMenuProgress(pIndex: number): void {
    const el = document.getElementById('menuProgress'); if (!el) return;
    el.textContent = pIndex > 0 ? ('🚀 Reached ' + PLANETS[pIndex]!.name) : 'A gentle space adventure';
  }

  buildPlanetGrid(onSelect: (i: number) => void): void {
    const grid = document.getElementById('planetGrid'); if (!grid) return;
    grid.innerHTML = '';
    PLANETS.forEach((P, i) => {
      const tile = document.createElement('button'); tile.className = 'planet-tile';
      const dot = document.createElement('span'); dot.className = 'pt-dot'; dot.style.background = '#' + P.sky[1].toString(16).padStart(6, '0');
      const txt = document.createElement('div');
      const nm = document.createElement('div'); nm.className = 'pt-name'; nm.textContent = P.emoji + ' ' + P.name;
      const ty = document.createElement('div'); ty.className = 'pt-type'; ty.textContent = (P.terrain && P.terrain.type === 'vertical') ? 'Climb up ↑' : 'Side adventure →';
      txt.appendChild(nm); txt.appendChild(ty);
      tile.appendChild(dot); tile.appendChild(txt);
      tile.addEventListener('click', () => { onSelect(i); });
      grid.appendChild(tile);
    });
  }

  // ---- fact card ----
  prepBoxFact(planetName: string, fact: string, replayHidden: boolean): void {
    const c = this.byId('factCard'); c.classList.add('factbox');
    this.byId('factEmoji').textContent = '🎁';
    this.byId('factKicker').textContent = 'Fun fact!';
    this.byId('factTitle').textContent = planetName;
    this.byId('factBody').textContent = fact;
    this.byId('factBtn').textContent = 'Yay! 🌟';
    this.byId('replayBtn').classList.toggle('hidden', replayHidden);
  }

  prepSunFact(emoji: string, title: string, body: string, replayHidden: boolean): void {
    const c = this.byId('factCard'); c.classList.remove('factbox');
    this.byId('factEmoji').textContent = emoji;
    this.byId('factKicker').textContent = 'You found a Piece of the Sun!';
    this.byId('factTitle').textContent = title;
    this.byId('factBody').textContent = body;
    this.byId('factBtn').textContent = 'Next planet! 🚀';
    this.byId('replayBtn').classList.toggle('hidden', replayHidden);
  }

  showFact(): void { this.byId('fact').classList.add('show'); }
  hideFact(): void { this.byId('fact').classList.remove('show'); }
  isFactShown(): boolean { return this.byId('fact').classList.contains('show'); }
  showWin(): void { this.byId('win').classList.add('show'); }

  triggerBonusToast(): void {
    const el = this.byId('bonus'); el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  // ---- the big event-wiring routine ----
  bind(game: Game): void {
    const audio = game.audio;
    audio.bindReplayButton(document.getElementById('replayBtn'));

    const show = (id: string) => this.byId(id).classList.add('show');
    const hide = (id: string) => this.byId(id).classList.remove('show');

    const hold = (el: HTMLElement, on: () => void, off: () => void) => {
      const d = (e: Event) => { e.preventDefault(); audio.resume(); on(); el.classList.add('pressed'); };
      const u = (e: Event) => { e.preventDefault(); off(); el.classList.remove('pressed'); };
      el.addEventListener('pointerdown', d); el.addEventListener('pointerup', u); el.addEventListener('pointerleave', u); el.addEventListener('pointercancel', u);
    };
    hold(this.byId('leftBtn'), () => game.move.left = true, () => game.move.left = false);
    hold(this.byId('rightBtn'), () => game.move.right = true, () => game.move.right = false);
    hold(this.byId('upBtn'), () => game.move.up = true, () => game.move.up = false);
    hold(this.byId('downBtn'), () => game.move.down = true, () => game.move.down = false);

    {
      const sb = this.byId('shootBtn');
      const down = (e: Event) => { e.preventDefault(); audio.resume(); game.move.shoot = true; game.flightShoot(); sb.classList.add('pressed'); };
      const up = (e: Event) => { e.preventDefault(); game.move.shoot = false; sb.classList.remove('pressed'); };
      sb.addEventListener('pointerdown', down); sb.addEventListener('pointerup', up); sb.addEventListener('pointerleave', up); sb.addEventListener('pointercancel', up);
    }
    this.byId('jumpBtn').addEventListener('pointerdown', e => { e.preventDefault(); audio.resume(); game.doJump(); });

    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (game.mode === 'flight') { if (e.key === 'ArrowUp') game.move.up = true; if (e.key === 'ArrowDown') game.move.down = true; if (e.key === ' ') { game.flightShoot(); e.preventDefault(); } return; }
      if (e.key === 'ArrowLeft') game.move.left = true; if (e.key === 'ArrowRight') game.move.right = true; if (e.key === ' ' || e.key === 'ArrowUp') { game.doJump(); e.preventDefault(); }
    });
    addEventListener('keyup', e => { if (e.key === 'ArrowLeft') game.move.left = false; if (e.key === 'ArrowRight') game.move.right = false; if (e.key === 'ArrowUp') game.move.up = false; if (e.key === 'ArrowDown') game.move.down = false; });

    // settings toggles (in the Settings sheet)
    this.byId('setCalm').addEventListener('click', () => { game.toggleCalm(); this.setSettingToggle('setCalmT', game.calm); });
    this.byId('setMusic').addEventListener('click', () => { audio.toggleMusic(); this.setSettingToggle('setMusicT', audio.musicOn); });
    this.byId('setRead').addEventListener('click', () => { audio.toggleSpeak(); this.setSettingToggle('setReadT', audio.speakOn); });
    this.byId('replayBtn').addEventListener('click', () => audio.replayFact());
    if (!audio.ttsSupported) { this.byId('replayBtn').classList.add('hidden'); this.byId('setRead').style.display = 'none'; }
    this.byId('factBtn').addEventListener('click', () => game.onFactBtn());
    this.byId('skipBtn').addEventListener('click', () => { if (game.mode === 'flight' && game.flight && !game.flight.arriving) { game.flight.t = FLIGHT_SECONDS; } });
    this.byId('winBtn').addEventListener('click', () => location.reload());

    // ----- splash / menu / pause navigation -----
    this.byId('splashTap').addEventListener('click', () => { audio.resume(); this.byId('splash').classList.add('hide'); show('menu'); });
    this.byId('splash').addEventListener('click', () => { audio.resume(); this.byId('splash').classList.add('hide'); show('menu'); });

    this.byId('playBtn').addEventListener('click', () => { audio.resume(); hide('menu'); game.started = true; });
    this.byId('howBtn').addEventListener('click', () => { hide('menu'); show('howto'); });
    this.byId('howBackBtn').addEventListener('click', () => { hide('howto'); show('menu'); });
    this.byId('settingsBtn').addEventListener('click', () => { hide('menu'); show('settings'); this.settingsReturn = 'menu'; });
    this.byId('setBackBtn').addEventListener('click', () => { hide('settings'); show(this.settingsReturn); });
    this.byId('selectBtn').addEventListener('click', () => { this.buildPlanetGrid(i => game.goToPlanet(i)); hide('menu'); show('select'); });
    this.byId('selBackBtn').addEventListener('click', () => { hide('select'); show('menu'); });

    // pause
    this.byId('menuBtn').addEventListener('click', () => { if (game.started && game.mode === 'platformer' && !game.paused && !this.isFactShown()) { game.paused = true; show('pause'); } });
    this.byId('resumeBtn').addEventListener('click', () => { hide('pause'); game.paused = false; });
    this.byId('pauseSettingsBtn').addEventListener('click', () => { hide('pause'); show('settings'); this.settingsReturn = 'pause'; });
    this.byId('quitBtn').addEventListener('click', () => { location.reload(); });

    // reflect initial setting states
    this.setSettingToggle('setReadT', audio.speakOn); this.setSettingToggle('setMusicT', audio.musicOn); this.setSettingToggle('setCalmT', game.calm);
    this.updateMenuProgress(game.pIndex);
  }
}
