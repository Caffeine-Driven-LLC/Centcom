// Ignores SIGINT, stops on SIGTERM.
process.on('SIGINT', () => undefined); process.on('SIGTERM', () => process.exit(143));
console.log('ready'); setInterval(() => undefined, 1000);
