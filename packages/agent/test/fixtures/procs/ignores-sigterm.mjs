// Ignores SIGINT and SIGTERM: only SIGKILL stops it.
process.on('SIGINT', () => undefined); process.on('SIGTERM', () => undefined);
console.log('ready'); setInterval(() => undefined, 1000);
