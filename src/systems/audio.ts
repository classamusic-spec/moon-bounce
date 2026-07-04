// Audio: gentle Web Audio sfx, soft ambient music, and speech synthesis for
// reading facts aloud. Ported faithfully from the prototype.
//
// `calm` and `pIndex` mirror game state; the Game keeps them in sync so the
// sound functions can tint by planet and fall silent in Calm Mode.

type OscType = OscillatorType;

export class AudioSystem {
  calm = false;
  pIndex = 0;
  musicOn = false;
  speakOn = true;
  voiceRate = 0.78;
  private _volume = 1;

  private actx: AudioContext | null = null;
  private master: GainNode | null = null;   // master volume
  private musicBus: GainNode | null = null; // music (duckable under speech)
  private sfxBus: GainNode | null = null;   // sound effects
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  // per-planet pentatonic roots — each planet gets its own gentle mood
  private readonly ROOTS = [261.6, 246.9, 220.0, 196.0, 174.6, 329.6, 311.1, 293.7];
  private readonly PENTA = [1, 1.122, 1.26, 1.498, 1.682];

  get volume(): number { return this._volume; }
  set volume(v: number) { this._volume = v; if (this.master && this.actx) this.master.gain.setTargetAtTime(v, this.actx.currentTime, 0.02); }

  // ---- speech ----
  readonly ttsSupported = ('speechSynthesis' in window);
  private chosenVoice: SpeechSynthesisVoice | null = null;
  private lastSpoken = '';
  private replayBtn: HTMLElement | null = null;

  constructor() {
    if (this.ttsSupported) {
      this.pickVoice();
      speechSynthesis.onvoiceschanged = () => this.pickVoice();
    }
  }

  /** Lets the UI hand us the replay button so we can reflect speaking state. */
  bindReplayButton(el: HTMLElement | null): void { this.replayBtn = el; }

  initAudio(): void {
    if (!this.actx) {
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.actx = new Ctor();
        // master -> destination; music + sfx route through master so volume and
        // ducking (lowering music under spoken facts) work cleanly.
        this.master = this.actx.createGain(); this.master.gain.value = this._volume; this.master.connect(this.actx.destination);
        this.musicBus = this.actx.createGain(); this.musicBus.connect(this.master);
        this.sfxBus = this.actx.createGain(); this.sfxBus.connect(this.master);
      } catch (e) { /* no audio available */ }
    }
  }

  /** Resume the context after a user gesture (browsers start it suspended). */
  resume(): void {
    this.initAudio();
    if (this.actx && this.actx.state === 'suspended') this.actx.resume();
    if (this.musicOn) this.startMusic(); // start music saved as on
  }

  tone(f: number, d: number, t?: OscType, v?: number): void {
    if (this.calm || !this.actx || !this.sfxBus || this._volume <= 0) return;
    const o = this.actx.createOscillator(), g = this.actx.createGain();
    o.type = t || 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, this.actx.currentTime);
    g.gain.linearRampToValueAtTime(v || 0.1, this.actx.currentTime + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, this.actx.currentTime + d);
    o.connect(g); g.connect(this.sfxBus); o.start(); o.stop(this.actx.currentTime + d);
  }

  sJump(): void { this.tone(240 + this.pIndex * 8, 0.26, 'sine', 0.09); }
  sStar(): void { this.tone(660, 0.45, 'sine', 0.08); setTimeout(() => this.tone(880, 0.4, 'sine', 0.05), 55); }
  sBox(): void { this.tone(523, 0.3, 'sine', 0.09); setTimeout(() => this.tone(784, 0.4, 'sine', 0.07), 80); }
  sBop(): void { this.tone(380, 0.2, 'sine', 0.09); setTimeout(() => this.tone(560, 0.3, 'sine', 0.06), 60); }
  sBump(): void { this.tone(180, 0.18, 'sine', 0.07); }
  sSun(): void { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.8, 'sine', 0.08), i * 150)); }
  sWind(): void { this.tone(140, 0.6, 'sine', 0.04); }
  sBoing(): void { this.tone(300, 0.3, 'sine', 0.1); setTimeout(() => this.tone(600, 0.35, 'sine', 0.07), 70); }
  sRock(): void { this.tone(160, 0.25, 'triangle', 0.07); }
  sPuff(): void { this.tone(440, 0.22, 'sine', 0.06); setTimeout(() => this.tone(320, 0.2, 'sine', 0.04), 45); }
  sIce(): void { this.tone(1200, 0.18, 'sine', 0.05); setTimeout(() => this.tone(1600, 0.22, 'sine', 0.04), 50); }
  sSpark(): void { this.tone(700, 0.12, 'triangle', 0.05); setTimeout(() => this.tone(1100, 0.16, 'triangle', 0.04), 30); }
  sFlame(): void { this.tone(260, 0.2, 'sine', 0.06); setTimeout(() => this.tone(180, 0.26, 'sine', 0.045), 50); }
  sBubble(): void { this.tone(320, 0.16, 'sine', 0.06); setTimeout(() => this.tone(560, 0.18, 'sine', 0.05), 55); }

  /** Element-flavoured cast sound for the puff power. */
  sCast(power: 'flame' | 'ice' | 'bubble' | 'spark'): void {
    if (power === 'ice') this.sIce(); else if (power === 'spark') this.sSpark(); else if (power === 'bubble') this.sBubble(); else this.sFlame();
  }

  sLaser(): void {
    if (this.calm || !this.actx || !this.sfxBus || this._volume <= 0) return;
    const o = this.actx.createOscillator(), g = this.actx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(900, this.actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(300, this.actx.currentTime + 0.12);
    g.gain.setValueAtTime(0, this.actx.currentTime);
    g.gain.linearRampToValueAtTime(0.05, this.actx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, this.actx.currentTime + 0.14);
    o.connect(g); g.connect(this.sfxBus); o.start(); o.stop(this.actx.currentTime + 0.15);
  }

  // ---- gentle ambient music (per-planet pentatonic arpeggio over a warm pad) ----
  private musicVoice(f: number, attack: number, dur: number, level: number, type: OscType): void {
    if (!this.actx || !this.musicBus) return;
    const o = this.actx.createOscillator(), g = this.actx.createGain();
    o.type = type; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 6; // subtle warmth
    g.gain.setValueAtTime(0, this.actx.currentTime);
    g.gain.linearRampToValueAtTime(level, this.actx.currentTime + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, this.actx.currentTime + dur);
    o.connect(g); g.connect(this.musicBus); o.start(); o.stop(this.actx.currentTime + dur + 0.1);
  }

  private musicNote(): void {
    if (!this.musicOn || this.calm || !this.actx || !this.musicBus) return;
    const root = this.ROOTS[this.pIndex % this.ROOTS.length]!;
    const scale = this.PENTA.map(r => root * r);
    const step = this.musicStep;
    // soft arpeggio note (drops an octave on the back half of each bar)
    this.musicVoice(scale[step % scale.length]! * (step % 8 < 4 ? 1 : 0.5), 0.3, 1.9, 0.03, 'sine');
    // warm sustained pad (root + a fourth, an octave down) at the top of each bar
    if (step % 8 === 0) {
      this.musicVoice(root * 0.5, 1.0, 5.0, 0.022, 'sine');
      this.musicVoice(root * 0.667, 1.2, 5.0, 0.015, 'sine');
    }
    this.musicStep++;
  }

  /** Lower music while a fact is being read aloud, then restore. */
  private duckMusic(on: boolean): void {
    if (!this.actx || !this.musicBus) return;
    this.musicBus.gain.setTargetAtTime(on ? 0.25 : 1, this.actx.currentTime, 0.12);
  }

  startMusic(): void { if (this.musicTimer) return; this.musicTimer = setInterval(() => this.musicNote(), 900); }
  stopMusic(): void { if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; } }

  toggleMusic(): void {
    this.musicOn = !this.musicOn;
    if (this.musicOn) { this.resume(); this.startMusic(); } else this.stopMusic();
  }

  // ---- speech ----
  private pickVoice(): void {
    if (!this.ttsSupported) return;
    const vs = speechSynthesis.getVoices(); if (!vs.length) return;
    const prefer = ['Samantha', 'Google US English', 'Karen', 'Moira', 'Tessa', 'Google UK English Female'];
    this.chosenVoice = vs.find(v => prefer.includes(v.name)) || vs.find(v => /en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || vs[0]!;
  }

  private setReplayState(on: boolean): void { if (this.replayBtn) this.replayBtn.classList.toggle('speaking', on); }

  private current: SpeechSynthesisUtterance | null = null;

  speak(text: string): void {
    this.lastSpoken = text;
    if (!this.speakOn || !this.ttsSupported || this.calm) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (this.chosenVoice) u.voice = this.chosenVoice;
      u.rate = this.voiceRate; u.pitch = 1.18; u.volume = 0.95; // slower, gentle, clear for young listeners
      // a cancelled utterance's late onend/onerror must not un-duck the NEW one
      this.current = u;
      u.onstart = () => { if (u !== this.current) return; this.setReplayState(true); this.duckMusic(true); };
      u.onend = () => { if (u !== this.current) return; this.setReplayState(false); this.duckMusic(false); };
      u.onerror = () => { if (u !== this.current) return; this.setReplayState(false); this.duckMusic(false); };
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  replayFact(): void {
    if (!this.lastSpoken || !this.ttsSupported || this.calm) return;
    const prev = this.speakOn; this.speakOn = true; this.speak(this.lastSpoken); this.speakOn = prev;
  }

  /** Read a specific piece of text aloud on demand (e.g. a journal fact). */
  speakText(text: string): void {
    if (!this.ttsSupported || this.calm) return;
    const prev = this.speakOn; this.speakOn = true; this.speak(text); this.speakOn = prev;
  }

  stopSpeak(): void {
    // Chrome often skips onend/onerror after cancel() — restore the duck here too
    this.current = null; this.setReplayState(false); this.duckMusic(false);
    if (this.ttsSupported) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  }

  toggleSpeak(): void { this.speakOn = !this.speakOn; if (!this.speakOn) this.stopSpeak(); }
}
