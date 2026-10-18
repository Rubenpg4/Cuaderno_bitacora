import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, readTheme } from './theme';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  const dark = theme === 'dark';

  function toggleTheme() {
    const next = dark ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? 'Activar modo claro' : 'Activar modo oscuro'}
      title={dark ? 'Activar modo claro' : 'Activar modo oscuro'}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {dark ? <Moon size={17} strokeWidth={1.8} /> : <Sun size={17} strokeWidth={1.8} />}
      </span>
      <span className="theme-toggle-label">{dark ? 'Oscuro' : 'Claro'}</span>
    </button>
  );
}
