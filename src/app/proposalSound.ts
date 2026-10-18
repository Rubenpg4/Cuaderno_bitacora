const storageKey = 'bitacora-proposal-sound';
let browserContext: AudioContext | undefined;
let browserPlayRequest = 0;

export function readProposalSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(storageKey) !== 'off';
  } catch {
    return true;
  }
}

export function saveProposalSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(storageKey, enabled ? 'on' : 'off');
  } catch {
    // La preferencia sigue activa durante esta sesión si falla el almacenamiento.
  }
}

function playBrowserSound(): void {
  try {
    if (!browserContext || browserContext.state === 'closed') browserContext = new AudioContext();
    const context = browserContext;
    const request = ++browserPlayRequest;
    void context
      .resume()
      .then(() => {
        if (request !== browserPlayRequest) return;
        const start = context.currentTime;
        for (const [offset, frequency] of [
          [0, 660],
          [0.22, 880],
        ]) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0.0001, start + offset);
          gain.gain.exponentialRampToValueAtTime(0.22, start + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(start + offset);
          oscillator.stop(start + offset + 0.21);
        }
      })
      .catch(() => {});
  } catch {
    // El aviso visual permanece disponible si el navegador bloquea el audio.
  }
}

export function playProposalSound(): void {
  if ('__TAURI_INTERNALS__' in window) {
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('play_proposal_sound'))
      .catch(playBrowserSound);
    return;
  }
  playBrowserSound();
}
