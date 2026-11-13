// Jazyk výpisů uzlu. Příkazová řádka quinvium ho nastaví proměnnou QUINTIUM_LANG podle zvoleného jazyka.
// Aplikace a starší spouštěče ji nenastavují, mají proto češtinu jako dřív.
export const L = (cs, en) => (/^en/i.test(process.env.QUINTIUM_LANG ?? '') ? en : cs);
