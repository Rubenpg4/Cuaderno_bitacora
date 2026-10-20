export type Theme = 'light' | 'dark';

const storageKey = 'bitacora-theme';

export function readTheme(): Theme {
  // El lanzador local abre con `#theme=dark`: su puerto cambia en cada arranque y no hay preferencia guardada.
  const launch = new URLSearchParams(location.hash.slice(1)).get('theme');
  if (launch === 'dark' || launch === 'light') return launch;
  try {
    return window.localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // El cambio sigue activo durante esta sesión si el almacenamiento está bloqueado.
  }
}
