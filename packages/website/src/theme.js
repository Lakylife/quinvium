// Runs before the page is painted: the chosen theme (or the system one) without a flash, and the "js" class for animations.
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  let theme = null;
  try { theme = localStorage.getItem('theme'); } catch { /* private window */ }
  if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.dataset.theme = theme;
})();
