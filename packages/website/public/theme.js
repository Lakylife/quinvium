// Runs before the page is painted: light unless the visitor picked dark (remembered), without a flash, and the "js" class for animations.
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  let theme = null;
  try { theme = localStorage.getItem('theme'); } catch { /* private window */ }
  if (theme !== 'dark') theme = 'light';
  root.dataset.theme = theme;
})();
