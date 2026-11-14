// Language of node output. The quinvium command line sets it with the QUINTIUM_LANG variable according to the chosen language.
// The app and older launchers do not set it, so they keep Czech as before.
export const L = (cs, en) => (/^en/i.test(process.env.QUINTIUM_LANG ?? '') ? en : cs);
