import { describe, it, expect, beforeEach } from 'vitest';
import { Storage, planetStickerId, masterStickerId, SOLAR_STICKER } from '../src/systems/storage';
import { PLANETS } from '../src/data/planets';

const KEY = 'moonbounce.save.v1';

beforeEach(() => localStorage.clear());

describe('Storage defaults', () => {
  it('starts a fresh save with sensible defaults', () => {
    const s = new Storage();
    expect(s.lastPlanet).toBe(0);
    expect(s.highestUnlocked).toBe(0);
    expect(s.stars).toBe(0);
    expect(s.settings.volume).toBe(1);
    expect(s.settings.speakOn).toBe(true);
    expect(s.owns('color-blue')).toBe(true); // free starter owned
    expect(s.equippedColor).toBe('color-blue');
  });

  it('survives corrupt JSON without throwing', () => {
    localStorage.setItem(KEY, '{not valid json');
    const s = new Storage();
    expect(s.lastPlanet).toBe(0);
  });
});

describe('Progression + stickers', () => {
  it('unlock advances highestUnlocked and lastPlanet', () => {
    const s = new Storage();
    s.unlock(3);
    expect(s.highestUnlocked).toBe(3);
    expect(s.lastPlanet).toBe(3);
    s.unlock(1); // does not lower highestUnlocked
    expect(s.highestUnlocked).toBe(3);
  });

  it('awards a planet sticker after all 5 facts, and the solar sticker after every planet', () => {
    const s = new Storage();
    for (let f = 0; f < 5; f++) s.markFact(0, f);
    expect(s.hasSticker(planetStickerId(0))).toBe(true);
    expect(s.hasSticker(SOLAR_STICKER)).toBe(false);
    for (let p = 0; p < PLANETS.length; p++) for (let f = 0; f < 5; f++) s.markFact(p, f);
    expect(s.hasSticker(SOLAR_STICKER)).toBe(true);
  });

  it('clamps indices and ignores out-of-range facts', () => {
    const s = new Storage();
    expect(s.markFact(0, 9)).toBe(false);
    s.unlock(999);
    expect(s.highestUnlocked).toBe(PLANETS.length - 1);
  });
});

describe('Cosmetics economy', () => {
  it('buys only when affordable, then equips', () => {
    const s = new Storage();
    expect(s.buy('color-gold', 15)).toBe(false); // no stars
    s.addStars(20);
    expect(s.buy('color-gold', 15)).toBe(true);
    expect(s.stars).toBe(5);
    expect(s.owns('color-gold')).toBe(true);
    s.equip('color', 'color-gold');
    expect(s.equippedColor).toBe('color-gold');
  });

  it('does not equip an unowned cosmetic', () => {
    const s = new Storage();
    s.equip('hat', 'hat-crown'); // not owned
    expect(s.equippedHat).toBe('hat-none');
  });
});

describe('Settings persistence', () => {
  it('persists settings across instances', () => {
    const a = new Storage();
    a.setSetting('volume', 0.3);
    a.setSetting('assist', true);
    const b = new Storage(); // re-reads localStorage
    expect(b.settings.volume).toBe(0.3);
    expect(b.settings.assist).toBe(true);
  });
});

describe('Save migrations', () => {
  it('migrates a v1 save (no facts/cosmetics/settings) preserving unlocks', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, lastPlanet: 2, highestUnlocked: 4 }));
    const s = new Storage();
    expect(s.highestUnlocked).toBe(4);
    expect(s.lastPlanet).toBe(2);
    expect(s.settings.volume).toBe(1); // defaulted
    expect(s.owns('color-blue')).toBe(true);
  });

  it('migrates a v3 save preserving stickers + bank, defaulting settings', () => {
    localStorage.setItem(KEY, JSON.stringify({
      v: 3, lastPlanet: 5, highestUnlocked: 6, factsFound: [], stickers: ['planet-0'],
      starsBank: 42, owned: ['color-blue', 'hat-none'], equipped: { color: 'color-blue', hat: 'hat-none' },
    }));
    const s = new Storage();
    expect(s.highestUnlocked).toBe(6);
    expect(s.stars).toBe(42);
    expect(s.hasSticker('planet-0')).toBe(true);
    expect(s.settings.voiceRate).toBeGreaterThan(0);
  });

  it('falls back to a default equip if the saved cosmetic is unowned', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 3, equipped: { color: 'color-gold', hat: 'hat-crown' } }));
    const s = new Storage();
    expect(s.equippedColor).toBe('color-blue'); // gold not owned -> default
  });
});

describe('Power-Master stickers', () => {
  it('awards a master sticker explicitly', () => {
    const s = new Storage();
    s.awardSticker(masterStickerId(2));
    expect(s.hasSticker(masterStickerId(2))).toBe(true);
  });
});
