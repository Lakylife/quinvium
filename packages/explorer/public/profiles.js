// Profile icons: the fixed set the Profiles contract refers to by number (1 to 24) and colour (0 to 7).
// The contract stores only the two numbers; the pictures are drawn here, so no outside images are ever loaded.
// The same file is meant for the wallets, so an icon looks the same everywhere.
(() => {
  const ICONS = [
    'M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5Z',
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z',
    'M5 5h14v14H5Z',
    'M12 3.5 21 20H3Z',
    'M12 2.5 21 12l-9 9.5L3 12Z',
    'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.3L12 17.1l-5.7 3.1 1.2-6.3-4.7-4.4 6.4-.8Z',
    'M13 2 4 14h7l-1 8 9-12h-7Z',
    'M12 20s-7.5-4.6-9-9.1C1.9 7.5 4.3 4.5 7.4 4.5c2 0 3.6 1.2 4.6 2.8 1-1.6 2.6-2.8 4.6-2.8 3.1 0 5.5 3 4.4 6.4C19.5 15.4 12 20 12 20Z',
    'M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z',
    'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    'M12 22c4 0 7-2.7 7-6.6 0-3.9-3-6.4-4.6-9.9-.6 2.4-1.8 3.9-3.4 4.6.3-2.9-.8-5.7-3.3-8.1C7.6 6 5 9.3 5 15.4 5 19.3 8 22 12 22Z',
    'M5 19C5 10 10 5 20 4c0 10-5 15-14 15ZM5 19l8-8',
    'M2 7c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2.5 5-1M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2.5 5-1M2 17c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2.5 5-1',
    'M2 20 9 8l4 6 3-4 6 10Z',
    'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12v9m0-9L4 7.5',
    'M12 2.5 20 5.5v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10v-6Z',
    'M15 3a6 6 0 1 1-4.6 9.9L4 19.3V21h3v-2h2v-2h2l1.1-1.1A6 6 0 0 1 15 3ZM16.5 7.5h.01',
    'M3 18h18L19.5 7l-4.5 4L12 4 9 11 4.5 7Z',
    'M12 7a2 2 0 1 0 0-4 2 2 0 1 0 0 4ZM12 7v14M8 11h8M4 13c0 4.4 3.6 8 8 8s8-3.6 8-8',
    'M12 6a6 6 0 1 0 0 12 6 6 0 1 0 0-12ZM6.5 14.5C3 16.5 2.5 18.5 5 19c3 .6 9.5-1.6 13.5-5S21 7.5 18 8',
    'M5 15c-1.5 1.5-2 4-2 6 2 0 4.5-.5 6-2M9 15l-2.5-2.5C8.5 8 12.5 3.5 21 3c-.5 8.5-5 12.5-9.5 14.5ZM15 9h.01',
    'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6Z',
    'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6ZM12 9V3.5M12 15v5.5M9 12H3.5M15 12h5.5M9.9 9.9 6 6M14.1 14.1 18 18M9.9 14.1 6 18M14.1 9.9 18 6',
    'M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5ZM12.5 13l6 6',
  ];
  const COLORS = ['#2F6FED', '#1F9D55', '#D64545', '#7C4DDB', '#E07A1F', '#138A8A', '#D2478A', '#5B6676'];

  /** SVG of icon `icon` (1 to 24) on colour `color` (0 to 7), or null for an unknown icon. */
  function svg(icon, color) {
    const path = ICONS[Number(icon) - 1];
    const fill = COLORS[Number(color)];
    if (!path || !fill) return null;
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="${fill}"/><path d="${path}" transform="translate(4.8 4.8) scale(.6)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  window.QuinviumProfiles = { count: ICONS.length, colors: COLORS.length, svg, palette: COLORS };
})();
