// Sound, synthesized only: no audio files, no network. A WebAudio engine hum that follows
// the car's speed, a two-tone siren while wanted, gunshots, pickup beeps and crash thuds,
// plus a quiet bassline on the title screen. Everything starts on the first user gesture
// (browsers block audio before one) and M toggles mute.

export function createAudio() {
  let context = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let musicTimer = null;
  let muted = false;
  let started = false;

  function ensure() {
    if (started) return;
    try {
      const AudioContext = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContext) return;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(context.destination);
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 50;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      sirenOsc = context.createOscillator();
      sirenOsc.type = 'square';
      sirenOsc.frequency.value = 700;
      sirenGain = context.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      started = true;
    } catch {
      // No audio in this browser: the game plays silent.
    }
  }

  function resume() {
    if (context && context.state === 'suspended') context.resume().catch(() => {});
  }

  function noiseBurst(duration, volume, filterFreq) {
    if (!context) return;
    const length = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
  }

  function beep(freq, duration, volume, type) {
    if (!context) return;
    const osc = context.createOscillator();
    osc.type = type ?? 'sine';
    osc.frequency.value = freq;
    const gain = context.createGain();
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(context.currentTime + duration);
  }

  // A slow bassline: A1, F1, C2, G1, one note every 0.45 s, only while `on` is true.
  const BASS = [55, 43.65, 65.41, 49];
  let bassIndex = 0;
  function startMusic() {
    if (!context || musicTimer !== null) return;
    musicTimer = window.setInterval(() => {
      if (muted) return;
      beep(BASS[bassIndex % BASS.length], 0.4, 0.12, 'triangle');
      bassIndex += 1;
    }, 450);
  }
  function stopMusic() {
    if (musicTimer !== null) {
      window.clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  return {
    /** Call on the first gesture (click / key) so audio is allowed. */
    unlock() {
      ensure();
      resume();
    },
    /** Per-frame: engine pitch from speed, siren while wanted. */
    update(speed, throttle, stars) {
      if (!context) return;
      const now = context.currentTime;
      engineGain.gain.setTargetAtTime(throttle > 0 ? 0.05 + speed * 0.0012 : 0.02, now, 0.1);
      engineOsc.frequency.setTargetAtTime(50 + speed * 2.2 + throttle * 20, now, 0.1);
      if (stars > 0) {
        sirenGain.gain.setTargetAtTime(0.035, now, 0.2);
        sirenOsc.frequency.setTargetAtTime(Math.floor(now * 1.4) % 2 === 0 ? 700 : 950, now, 0.05);
      } else {
        sirenGain.gain.setTargetAtTime(0, now, 0.2);
      }
    },
    gunshot() { noiseBurst(0.14, 0.5, 1800); },
    punch() { noiseBurst(0.08, 0.3, 900); },
    crash() { noiseBurst(0.25, 0.6, 500); },
    pickup() { beep(880, 0.12, 0.25); beep(1320, 0.18, 0.2); },
    mission() { beep(523, 0.15, 0.3); window.setTimeout(() => beep(659, 0.15, 0.3), 140); window.setTimeout(() => beep(784, 0.3, 0.3), 280); },
    startMusic,
    stopMusic,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
  };
}
