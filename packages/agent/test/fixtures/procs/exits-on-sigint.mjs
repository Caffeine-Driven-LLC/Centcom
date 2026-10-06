// Like claude: SIGINT ends it. Prints "ready" once its handlers are in place.
process.on('SIGINT', () => process.exit(130));
console.log('ready'); setInterval(() => undefined, 1000);
