// Language of node output. English is the main language of the network and the default.
// Czech is a translation: the quinvium command line sets QUINTIUM_LANG=cs when Czech is chosen,
// the app passes the language of its window, and a node started by hand follows the same variable.
export const L = (cs, en) => (/^cs/i.test(process.env.QUINTIUM_LANG ?? '') ? cs : en);
