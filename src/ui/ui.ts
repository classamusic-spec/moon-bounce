import { PLANETS } from '../data/planets';
import { MOONS, moonForPlanet } from '../data/moons';
import type { Moon } from '../data/moons';
import { FLIGHT_SECONDS } from '../core/constants';
import { planetStickerId, masterStickerId, secretStickerId, SOLAR_STICKER } from '../systems/storage';
import type { CosmeticSlot } from '../systems/storage';
import { COLORS, HATS, colorById, hatById } from '../data/cosmetics';
import type { ColorCosmetic, HatCosmetic } from '../data/cosmetics';
import type { Game } from '../main_game';

// All DOM / HUD / menu wiring. View methods plus a single bind(game) that
// hooks every button and key to game state. Ported from the prototype's HUD
// helpers + bindControls().
export class UI {
  private settingsReturn = 'menu';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

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

  setPuffVisible(on: boolean): void { const b = document.getElementById('puffBtn'); if (b) b.style.display = on ? 'flex' : 'none'; }

  /** A soft dark cross-fade for level/planet/moon transitions. */
  fadeTransition(): void { const el = this.byId('fade'); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

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

  updatePlanetDots(pIndex: number, highestUnlocked: number): void {
    document.querySelectorAll('.pdot').forEach((d, i) => {
      d.classList.toggle('locked', i > highestUnlocked);
      d.classList.toggle('current', i === pIndex);
      const lock = d.querySelector('.lock') as HTMLElement | null;
      if (lock) lock.style.display = i > highestUnlocked ? 'block' : 'none';
    });
  }

  updateMenuProgress(highestUnlocked: number): void {
    const el = document.getElementById('menuProgress'); if (!el) return;
    el.textContent = highestUnlocked > 0 ? ('🚀 Reached ' + PLANETS[highestUnlocked]!.name) : 'A gentle space adventure';
  }

  // The galaxy map: a calm vertical journey from the Sun outward. Reached
  // planets are tappable; locked ones show gently (no lock-shame), not tappable.
  // A planet with a moon gets a small moon bonus node beneath it.
  buildGalaxyMap(game: Game, onSelect: (i: number) => void, onMoonSelect: (m: Moon) => void): void {
    const map = document.getElementById('galaxyMap'); if (!map) return;
    const highestUnlocked = game.storage.highestUnlocked;
    const current = game.pIndex;
    map.innerHTML = '';

    const sun = document.createElement('div'); sun.className = 'galaxy-sun';
    const orb = document.createElement('span'); orb.className = 'gs-orb'; orb.textContent = '☀️';
    const sunLabel = document.createElement('span'); sunLabel.textContent = 'The Sun';
    sun.appendChild(orb); sun.appendChild(sunLabel); map.appendChild(sun);

    PLANETS.forEach((P, i) => {
      const unlocked = i <= highestUnlocked;
      const isCurrent = i === current && !game.onMoon;
      const node = document.createElement('button'); node.className = 'galaxy-node';
      if (isCurrent) node.classList.add('current');
      if (unlocked) node.classList.add('reached'); else node.classList.add('locked');

      const dot = document.createElement('span'); dot.className = 'gn-dot';
      dot.style.background = '#' + P.sky[1].toString(16).padStart(6, '0');

      const info = document.createElement('div');
      const nm = document.createElement('div'); nm.className = 'gn-name'; nm.textContent = P.emoji + ' ' + P.name;
      const st = document.createElement('div'); st.className = 'gn-state';
      st.textContent = isCurrent ? 'You are here' : unlocked ? ((P.terrain && P.terrain.type === 'vertical') ? 'Climb up ↑' : 'Side adventure →') : 'Not yet';
      info.appendChild(nm); info.appendChild(st);

      node.appendChild(dot); node.appendChild(info);

      if (!unlocked) {
        const lock = document.createElement('span'); lock.className = 'gn-lock'; lock.textContent = '🔒';
        node.appendChild(lock);
        node.setAttribute('aria-disabled', 'true');
      } else {
        node.addEventListener('click', () => { onSelect(i); });
      }
      map.appendChild(node);

      // moon bonus node
      const moon = moonForPlanet(i);
      if (moon) {
        const done = game.storage.hasSticker(moon.sticker);
        const mnode = document.createElement('button'); mnode.className = 'galaxy-moon';
        if (unlocked) mnode.classList.add('reached'); else mnode.classList.add('locked');
        if (done) mnode.classList.add('done');
        const mdot = document.createElement('span'); mdot.className = 'gm-dot'; mdot.textContent = moon.emoji;
        const minfo = document.createElement('div');
        const mnm = document.createElement('div'); mnm.className = 'gm-name'; mnm.textContent = moon.name;
        const mst = document.createElement('div'); mst.className = 'gm-state';
        mst.textContent = !unlocked ? 'Bonus — unlock the planet' : done ? 'Bonus ✓ explored' : 'Bonus level →';
        minfo.appendChild(mnm); minfo.appendChild(mst);
        mnode.appendChild(mdot); mnode.appendChild(minfo);
        if (done) { const c = document.createElement('span'); c.className = 'gm-check'; c.textContent = '🏅'; mnode.appendChild(c); }
        if (unlocked) mnode.addEventListener('click', () => onMoonSelect(moon));
        else mnode.setAttribute('aria-disabled', 'true');
        map.appendChild(mnode);
      }
    });
  }

  // The Space Journal: a sticker shelf + per-planet fact lists. Found facts are
  // shown and replayable; unfound facts stay a gentle mystery (no spoilers).
  buildJournal(game: Game): void {
    const storage = game.storage;

    const shelf = document.getElementById('stickerShelf');
    if (shelf) {
      shelf.innerHTML = '';
      PLANETS.forEach((P, i) => {
        const s = document.createElement('div');
        const earned = storage.hasSticker(planetStickerId(i));
        s.className = 'sticker ' + (earned ? 'earned' : 'locked');
        s.textContent = earned ? P.emoji : '·';
        s.title = earned ? P.name + ' — all facts found!' : P.name + ' — find all 5 facts';
        shelf.appendChild(s);
      });
      MOONS.forEach(m => {
        const s = document.createElement('div');
        const earned = storage.hasSticker(m.sticker);
        s.className = 'sticker ' + (earned ? 'earned' : 'locked');
        s.textContent = earned ? m.emoji : '·';
        s.title = earned ? m.name + ' — bonus explored!' : m.name + ' — explore the moon bonus';
        shelf.appendChild(s);
      });
      const powerEmoji: Record<string, string> = { flame: '🔥', ice: '❄️', bubble: '🫧', spark: '⚡' };
      PLANETS.forEach((P, i) => {
        if (!P.power) return;
        const s = document.createElement('div');
        const earned = storage.hasSticker(masterStickerId(i));
        s.className = 'sticker ' + (earned ? 'earned' : 'locked');
        s.textContent = earned ? (powerEmoji[P.power] || '⭐') : '·';
        s.title = earned ? P.name + ' — Power Master!' : P.name + ' — find the secret power cache';
        shelf.appendChild(s);
      });
      PLANETS.forEach((P, i) => {
        if (!P.secret) return;
        const s = document.createElement('div');
        const earned = storage.hasSticker(secretStickerId(i));
        s.className = 'sticker ' + (earned ? 'earned' : 'locked');
        s.textContent = earned ? '🔭' : '·';
        s.title = earned ? P.name + ' — Star Finder!' : P.name + ' — find the hidden star cluster';
        shelf.appendChild(s);
      });
      const fin = document.createElement('div');
      const finEarned = storage.hasSticker(SOLAR_STICKER);
      fin.className = 'sticker sticker-final ' + (finEarned ? 'earned' : 'locked');
      fin.textContent = finEarned ? '🌟' : '·';
      fin.title = finEarned ? 'Solar System Explorer — every fact found!' : 'Find every fact on every planet';
      shelf.appendChild(fin);
    }

    const list = document.getElementById('journalList');
    if (!list) return;
    list.innerHTML = '';
    PLANETS.forEach((P, i) => {
      const found = storage.factsFor(i);
      const count = found.filter(Boolean).length;
      const card = document.createElement('div'); card.className = 'journal-planet';

      const head = document.createElement('div'); head.className = 'jp-head';
      const dot = document.createElement('span'); dot.className = 'jp-dot'; dot.style.background = '#' + P.sky[1].toString(16).padStart(6, '0');
      const name = document.createElement('span'); name.className = 'jp-name'; name.textContent = P.emoji + ' ' + P.name;
      const badge = document.createElement('span'); badge.className = 'jp-count' + (count >= 5 ? ' done' : ''); badge.textContent = count >= 5 ? '★ ' + count + '/5' : count + '/5';
      head.appendChild(dot); head.appendChild(name); head.appendChild(badge);
      card.appendChild(head);

      P.facts.forEach((factText, f) => {
        const row = document.createElement('div');
        const isFound = found[f] === true;
        row.className = 'fact-row' + (isFound ? '' : ' unfound');
        const txt = document.createElement('span'); txt.className = 'fact-text';
        txt.textContent = isFound ? factText : '❓ Keep exploring to find this fact!';
        row.appendChild(txt);
        if (isFound && game.audio.ttsSupported) {
          const btn = document.createElement('button'); btn.className = 'fact-speak'; btn.textContent = '🔊'; btn.setAttribute('aria-label', 'Hear it again');
          btn.addEventListener('click', () => game.audio.speakText(factText));
          row.appendChild(btn);
        }
        card.appendChild(row);
      });
      list.appendChild(card);
    });
  }

  // The Dress Up screen: spend collected stars on blob colors and hats. Purely
  // cosmetic. Tapping an owned item equips it; an unowned affordable item is
  // bought then equipped; an unaffordable item gives a gentle shake.
  buildCustomize(game: Game): void {
    const storage = game.storage;

    // live CSS preview of the blob
    const body = document.getElementById('bpBody');
    if (body) body.style.background = '#' + colorById(storage.equippedColor).hex.toString(16).padStart(6, '0');
    const hat = document.getElementById('bpHat');
    if (hat) { const h = hatById(storage.equippedHat); hat.textContent = h.kind === 'none' ? '' : h.emoji; }

    const bank = document.getElementById('custBank');
    if (bank) bank.textContent = '⭐ ' + storage.stars;

    const makeItem = (slot: CosmeticSlot, id: string, cost: number, equippedId: string, inner: HTMLElement, label: string): HTMLButtonElement => {
      const owned = storage.owns(id);
      const equipped = equippedId === id;
      const item = document.createElement('button');
      item.className = 'cust-item' + (owned ? ' owned' : ' locked') + (equipped ? ' equipped' : '') + (!owned && !storage.canAfford(cost) ? ' cant' : '');
      item.appendChild(inner);
      const lab = document.createElement('span'); lab.className = 'cust-label'; lab.textContent = label; item.appendChild(lab);
      if (!owned) { const c = document.createElement('span'); c.className = 'cust-cost'; c.textContent = '⭐' + cost; item.appendChild(c); }
      item.addEventListener('click', () => {
        if (storage.owns(id)) { storage.equip(slot, id); game.refreshBlob(); this.buildCustomize(game); return; }
        if (storage.buy(id, cost)) { storage.equip(slot, id); game.refreshBlob(); this.buildCustomize(game); }
        else { item.classList.remove('shake'); void item.offsetWidth; item.classList.add('shake'); }
      });
      return item;
    };

    const colorGrid = document.getElementById('colorGrid');
    if (colorGrid) {
      colorGrid.innerHTML = '';
      COLORS.forEach((c: ColorCosmetic) => {
        const sw = document.createElement('span'); sw.className = 'cust-swatch'; sw.style.background = '#' + c.hex.toString(16).padStart(6, '0');
        colorGrid.appendChild(makeItem('color', c.id, c.cost, storage.equippedColor, sw, c.label));
      });
    }
    const hatGrid = document.getElementById('hatGrid');
    if (hatGrid) {
      hatGrid.innerHTML = '';
      HATS.forEach((h: HatCosmetic) => {
        const em = document.createElement('span'); em.className = 'cust-hat-emoji'; em.textContent = h.emoji;
        hatGrid.appendChild(makeItem('hat', h.id, h.cost, storage.equippedHat, em, h.label));
      });
    }
  }

  // ---- fact card ----
  prepBoxFact(planetName: string, fact: string, replayHidden: boolean): void {
    const c = this.byId('factCard'); c.classList.add('factbox');
    this.byId('factEmoji').textContent = '🌸';
    this.byId('factKicker').textContent = 'A whisper…';
    this.byId('factTitle').textContent = planetName;
    this.byId('factBody').textContent = fact;
    this.byId('factBtn').textContent = 'Yay! 🌟';
    this.byId('replayBtn').classList.toggle('hidden', replayHidden);
  }

  prepSunFact(emoji: string, title: string, body: string, replayHidden: boolean): void {
    const c = this.byId('factCard'); c.classList.remove('factbox');
    this.byId('factEmoji').textContent = emoji;
    this.byId('factKicker').textContent = 'You woke the Glowseed!';
    this.byId('factTitle').textContent = title;
    this.byId('factBody').textContent = body;
    this.byId('factBtn').textContent = 'Onward 🎈';
    this.byId('replayBtn').classList.toggle('hidden', replayHidden);
  }

  prepMoonFact(moon: Moon, replayHidden: boolean): void {
    const c = this.byId('factCard'); c.classList.remove('factbox');
    this.byId('factEmoji').textContent = moon.emoji;
    this.byId('factKicker').textContent = 'Bonus complete! ⭐';
    this.byId('factTitle').textContent = 'You explored ' + moon.name + '!';
    this.byId('factBody').textContent = moon.fact;
    this.byId('factBtn').textContent = 'Back to map 🗺️';
    this.byId('replayBtn').classList.toggle('hidden', replayHidden);
  }

  /** A calm, NON-BLOCKING title beat at level start: where you are and what to
   *  do here. The game keeps running underneath — nothing is gated on it. */
  showLevelIntro(emoji: string, name: string, goal: string): void {
    const el = this.byId('levelIntro');
    this.byId('liEmoji').textContent = emoji;
    this.byId('liName').textContent = name;
    this.byId('liGoal').textContent = goal;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  /** The end-of-world payoff card: what you actually did here, before travelling on. */
  showResults(o: { emoji: string; title: string; light: number; buds: number; budsTotal: number; keepsakes: number }): void {
    this.byId('resEmoji').textContent = o.emoji;
    this.byId('resTitle').textContent = o.title;
    this.byId('resLight').textContent = String(o.light);
    this.byId('resBuds').textContent = o.buds + '/' + o.budsTotal;
    this.byId('resKeep').textContent = String(o.keepsakes);
    this.byId('resKeepRow').style.display = o.keepsakes > 0 ? 'flex' : 'none';
    this.byId('results').classList.add('show');
  }
  hideResults(): void { this.byId('results').classList.remove('show'); }

  showFact(): void { this.byId('fact').classList.add('show'); }
  hideFact(): void { this.byId('fact').classList.remove('show'); }
  isFactShown(): boolean { return this.byId('fact').classList.contains('show'); }
  showWin(): void { this.byId('win').classList.add('show'); }

  triggerBonusToast(): void { this.showToast('🎉', 'All facts found!'); }

  /** A brief centered celebration toast. */
  showToast(emoji: string, text: string): void {
    const el = this.byId('bonus');
    const e = el.querySelector('.b-emoji'); if (e) e.textContent = emoji;
    const t = el.querySelector('.b-text'); if (t) t.textContent = text;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer); // don't let an old toast's timer cut a new one short
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
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
    this.byId('puffBtn').addEventListener('pointerdown', e => { e.preventDefault(); audio.resume(); game.castPuff(); });

    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (game.mode === 'flight') { if (e.key === 'ArrowUp') game.move.up = true; if (e.key === 'ArrowDown') game.move.down = true; if (e.key === ' ') { game.flightShoot(); e.preventDefault(); } return; }
      if (e.key === 'ArrowLeft') game.move.left = true; if (e.key === 'ArrowRight') game.move.right = true; if (e.key === ' ' || e.key === 'ArrowUp') { game.doJump(); e.preventDefault(); }
      if (e.key === 'f' || e.key === 'F') { game.castPuff(); }
    });
    addEventListener('keyup', e => { if (e.key === 'ArrowLeft') game.move.left = false; if (e.key === 'ArrowRight') game.move.right = false; if (e.key === 'ArrowUp') game.move.up = false; if (e.key === 'ArrowDown') game.move.down = false; });
    // losing focus swallows keyup events — release everything so the blob
    // doesn't walk forever when the window/app is switched away mid-press
    const releaseAll = () => { game.move.left = game.move.right = game.move.up = game.move.down = game.move.shoot = false; };
    addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

    // settings toggles (in the Settings sheet)
    this.byId('setCalm').addEventListener('click', () => { game.toggleCalm(); this.setSettingToggle('setCalmT', game.calm); });
    this.byId('setMusic').addEventListener('click', () => { audio.toggleMusic(); this.setSettingToggle('setMusicT', audio.musicOn); game.storage.setSetting('musicOn', audio.musicOn); });
    this.byId('setRead').addEventListener('click', () => { audio.toggleSpeak(); this.setSettingToggle('setReadT', audio.speakOn); game.storage.setSetting('speakOn', audio.speakOn); });
    this.byId('setMotion').addEventListener('click', () => { game.reduceMotion = !game.reduceMotion; this.setSettingToggle('setMotionT', game.reduceMotion); game.storage.setSetting('reduceMotion', game.reduceMotion); });
    this.byId('setAssist').addEventListener('click', () => { game.assist = !game.assist; this.setSettingToggle('setAssistT', game.assist); game.storage.setSetting('assist', game.assist); });
    // sliders: apply live on 'input', persist once on 'change' (dragging fired
    // dozens of synchronous localStorage writes per second otherwise)
    this.byId('setVoice').addEventListener('input', e => { audio.voiceRate = (+(e.target as HTMLInputElement).value) / 100; });
    this.byId('setVoice').addEventListener('change', () => game.storage.setSetting('voiceRate', audio.voiceRate));
    this.byId('setVol').addEventListener('input', e => { audio.volume = (+(e.target as HTMLInputElement).value) / 100; });
    this.byId('setVol').addEventListener('change', () => game.storage.setSetting('volume', audio.volume));
    this.byId('replayBtn').addEventListener('click', () => audio.replayFact());
    if (!audio.ttsSupported) { this.byId('replayBtn').classList.add('hidden'); this.byId('setRead').style.display = 'none'; }
    this.byId('factBtn').addEventListener('click', () => game.onFactBtn());
    this.byId('resBtn').addEventListener('click', () => game.onResultsBtn());
    this.byId('skipBtn').addEventListener('click', () => {
      const f = game.flight;
      if (game.mode !== 'flight' || !f || f.arriving) return;
      f.t = FLIGHT_SECONDS;
      if (f.phase === 'intro') f.introT = 99; // skip works during the intro too (jump straight to arrival)
    });
    this.byId('winBtn').addEventListener('click', () => location.reload());

    // ----- splash / menu / pause navigation -----
    // one listener on the whole splash (it contains #splashTap; two would double-fire)
    this.byId('splash').addEventListener('click', () => { audio.resume(); this.byId('splash').classList.add('hide'); show('menu'); });

    this.byId('playBtn').addEventListener('click', () => { audio.resume(); hide('menu'); game.started = true; });
    this.byId('howBtn').addEventListener('click', () => { hide('menu'); show('howto'); });
    this.byId('howBackBtn').addEventListener('click', () => { hide('howto'); show('menu'); });
    this.byId('settingsBtn').addEventListener('click', () => { hide('menu'); show('settings'); this.settingsReturn = 'menu'; });
    this.byId('setBackBtn').addEventListener('click', () => { hide('settings'); show(this.settingsReturn); });
    this.byId('selectBtn').addEventListener('click', () => { this.buildGalaxyMap(game, i => game.goToPlanet(i), m => game.goToMoon(m)); hide('menu'); show('select'); });
    this.byId('selBackBtn').addEventListener('click', () => { hide('select'); show('menu'); });
    this.byId('journalBtn').addEventListener('click', () => { this.buildJournal(game); hide('menu'); show('journal'); });
    this.byId('journalBackBtn').addEventListener('click', () => { game.audio.stopSpeak(); hide('journal'); show('menu'); });
    this.byId('customizeBtn').addEventListener('click', () => { this.buildCustomize(game); hide('menu'); show('customize'); });
    this.byId('custBackBtn').addEventListener('click', () => { hide('customize'); show('menu'); });

    // pause
    this.byId('menuBtn').addEventListener('click', () => { if (game.started && game.mode === 'platformer' && !game.paused && !this.isFactShown()) { game.paused = true; show('pause'); } });
    this.byId('resumeBtn').addEventListener('click', () => { hide('pause'); game.paused = false; });
    this.byId('pauseSettingsBtn').addEventListener('click', () => { hide('pause'); show('settings'); this.settingsReturn = 'pause'; });
    this.byId('quitBtn').addEventListener('click', () => { location.reload(); });

    // reflect initial setting states
    this.setSettingToggle('setReadT', audio.speakOn); this.setSettingToggle('setMusicT', audio.musicOn); this.setSettingToggle('setCalmT', game.calm);
    this.setSettingToggle('setMotionT', game.reduceMotion); this.setSettingToggle('setAssistT', game.assist);
    (this.byId('setVoice') as HTMLInputElement).value = String(Math.round(audio.voiceRate * 100));
    (this.byId('setVol') as HTMLInputElement).value = String(Math.round(audio.volume * 100));
    if (!audio.ttsSupported) this.byId('voiceRow').style.display = 'none';
    this.updateMenuProgress(game.storage.highestUnlocked);
  }
}
