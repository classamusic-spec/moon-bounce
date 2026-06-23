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

  private actx: AudioContext | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private readonly SCALES = [
    [261.6, 329.6, 392.0, 523.3],
    [293.7, 349.2, 440.0, 587.3],
    [261.6, 311.1, 392.0, 466.2],
  ];

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
      } catch (e) { /* no audio available */ }
    }
  }

  /** Resume the context after a user gesture (browsers start it suspended). */
  resume(): void {
    this.initAudio();
    if (this.actx && this.actx.state === 'suspended') this.actx.resume();
  }

  tone(f: number, d: number, t?: OscType, v?: number): void {
    if (this.calm || !this.actx) return;
    const o = this.actx.createOscillator(), g = this.actx.createGain();
    o.type = t || 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, this.actx.currentTime);
    g.gain.linearRampToValueAtTime(v || 0.1, this.actx.currentTime + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, this.actx.currentTime + d);
    o.connect(g); g.connect(this.actx.destination); o.start(); o.stop(this.actx.currentTime + d);
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

  sLaser(): void {
    if (this.calm || !this.actx) return;
    const o = this.actx.createOscillator(), g = this.actx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(900, this.actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(300, this.actx.currentTime + 0.12);
    g.gain.setValueAtTime(0, this.actx.currentTime);
    g.gain.linearRampToValueAtTime(0.05, this.actx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, this.actx.currentTime + 0.14);
    o.connect(g); g.connect(this.actx.destination); o.start(); o.stop(this.actx.currentTime + 0.15);
  }

  // ---- gentle ambient music ----
  private musicNote(): void {
    if (!this.musicOn || this.calm || !this.actx) return;
    const scale = this.SCALES[this.pIndex % this.SCALES.length]!;
    const f = scale[this.musicStep % scale.length]! / (this.musicStep % 8 < 4 ? 1 : 2);
    const o = this.actx.createOscillator(), g = this.actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, this.actx.currentTime);
    g.gain.linearRampToValueAtTime(0.035, this.actx.currentTime + 0.3); // very soft
    g.gain.exponentialRampToValueAtTime(0.0001, this.actx.currentTime + 1.8);
    o.connect(g); g.connect(this.actx.destination); o.start(); o.stop(this.actx.currentTime + 1.9);
    this.musicStep++;
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

  speak(text: string): void {
    this.lastSpoken = text;
    if (!this.speakOn || !this.ttsSupported || this.calm) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (this.chosenVoice) u.voice = this.chosenVoice;
      u.rate = 0.78; u.pitch = 1.18; u.volume = 0.95; // slower, gentle, clear for young listeners
      u.onstart = () => this.setReplayState(true);
      u.onend = () => this.setReplayState(false);
      u.onerror = () => this.setReplayState(false);
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

  stopSpeak(): void { this.setReplayState(false); if (this.ttsSupported) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } } }

  toggleSpeak(): void { this.speakOn = !this.speakOn; if (!this.speakOn) this.stopSpeak(); }
}
