// Entry of the quintium-node.cjs file: without the `cli` argument it is a full node, with it the command line.
if (process.argv[2] === 'cli') import('../../cli/src/main.js').then((m) => m.run(process.argv.slice(3)));
else import('../../node/src/cli.js');
