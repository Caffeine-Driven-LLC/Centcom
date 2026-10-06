// prints truecolor, 256-colour and bold text, then the terminal size, then waits
const e = '\u001b';
process.stdout.write(`${e}[38;2;18;52;86mTRUE${e}[0m ${e}[38;5;196mRED256${e}[0m ${e}[1mBOLD${e}[0m ${e}[48;2;0;128;0mGREENBG${e}[0m\r\n`);
process.stdout.write(`size ${process.stdout.columns}x${process.stdout.rows} term=${process.env.TERM} color=${process.env.COLORTERM}\r\n`);
process.on('SIGWINCH', () => process.stdout.write(`resized ${process.stdout.columns}x${process.stdout.rows}\r\n`));
setInterval(() => {}, 1000);
