export const THEMES = Object.freeze({ light: "通常", dark: "ダーク" });
export const THEME_STORAGE_KEY = "wwb.theme.v3";

export function normalizeTheme(value) {
  return Object.hasOwn(THEMES, value) ? value : "light";
}

export function readTheme(storage = localStorage) {
  try { return normalizeTheme(storage.getItem(THEME_STORAGE_KEY)); }
  catch { return "light"; }
}

export function applyTheme(theme, {
  storage = localStorage,
  root = document.documentElement,
  themeColor = document.querySelector('meta[name="theme-color"]'),
} = {}) {
  const normalized = normalizeTheme(theme);
  root.dataset.theme = normalized;
  root.style.colorScheme = normalized;
  if (themeColor) themeColor.content = normalized === "dark" ? "#101915" : "#19362f";
  try { storage.setItem(THEME_STORAGE_KEY, normalized); } catch { /* Storage can be unavailable. */ }
  return normalized;
}

export function initializeTheme(options = {}) {
  return applyTheme(readTheme(options.storage), options);
}
