// prints the isolated folders, so a test can check they are fresh and removed afterwards
process.stdout.write(`home=${process.env.HOME}\r\nconfig=${process.env.CENTCOM_CONFIG_DIR}\r\nstate=${process.env.CENTCOM_STATE_DIR}\r\nsecret=${process.env.TEST_SECRET_VALUE}\r\n`);
setInterval(() => {}, 1000);
