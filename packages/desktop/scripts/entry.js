// Vstup souboru quintium-node.cjs: bez argumentu `cli` je to plný uzel, s ním příkazová řádka aether.
if (process.argv[2] === 'cli') import('../../cli/src/main.js').then((m) => m.run(process.argv.slice(3)));
else import('../../node/src/cli.js');
