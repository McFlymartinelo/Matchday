const STORAGE_KEY = 'matchday_theme';

export function getTheme() {
  return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme) {
  const value = theme === 'dark' ? 'dark' : 'light';
  localStorage.setItem(STORAGE_KEY, value);
  applyTheme(value);
}

export function applyTheme(theme = getTheme()) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0a0c14' : '#0B1524';
}

applyTheme();
