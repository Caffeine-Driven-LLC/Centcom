/** Tiny 3x5 pixel font (upper case, digits, a few symbols). Same glyphs as the animation library. */
const SRC = `
A .X.|X.X|XXX|X.X|X.X
B XX.|X.X|XX.|X.X|XX.
C .XX|X..|X..|X..|.XX
D XX.|X.X|X.X|X.X|XX.
E XXX|X..|XX.|X..|XXX
F XXX|X..|XX.|X..|X..
G .XX|X..|X.X|X.X|.XX
H X.X|X.X|XXX|X.X|X.X
I XXX|.X.|.X.|.X.|XXX
J ..X|..X|..X|X.X|.X.
K X.X|X.X|XX.|X.X|X.X
L X..|X..|X..|X..|XXX
M X.X|XXX|XXX|X.X|X.X
N XX.|X.X|X.X|X.X|X.X
O .X.|X.X|X.X|X.X|.X.
P XX.|X.X|XX.|X..|X..
R XX.|X.X|XX.|X.X|X.X
S .XX|X..|.X.|..X|XX.
T XXX|.X.|.X.|.X.|.X.
U X.X|X.X|X.X|X.X|XXX
V X.X|X.X|X.X|X.X|.X.
W X.X|X.X|XXX|XXX|X.X
X X.X|X.X|.X.|X.X|X.X
Y X.X|X.X|.X.|.X.|.X.
Z XXX|..X|.X.|X..|XXX
0 XXX|X.X|X.X|X.X|XXX
1 .X.|XX.|.X.|.X.|XXX
2 XX.|..X|.X.|X..|XXX
3 XX.|..X|.X.|..X|XX.
4 X.X|X.X|XXX|..X|..X
5 XXX|X..|XX.|..X|XX.
6 .XX|X..|XXX|X.X|XXX
7 XXX|..X|.X.|.X.|.X.
8 XXX|X.X|XXX|X.X|XXX
9 XXX|X.X|XXX|..X|XX.
? XX.|..X|.X.|...|.X.
! .X.|.X.|.X.|...|.X.
. ...|...|...|...|.X.
+ ...|.X.|XXX|.X.|...
- ...|...|XXX|...|...
> X..|.X.|..X|.X.|X..
_ ...|...|...|...|XXX
/ ..X|..X|.X.|X..|X..
: ...|.X.|...|.X.|...
  ...|...|...|...|...
`.replace(/^\n/, '');

const FONT: Record<string, string[]> = {};
for (const line of SRC.split('\n')) {
  if (line.length < 3) continue;
  FONT[line[0]!] = line.slice(2).split('|');
}

/** Rows of a text string in the pixel font, drawn with `color` (a palette char). 1px letter spacing. */
export function textRows(s: string, color = 'w'): string[] {
  const rows = ['', '', '', '', ''];
  [...s.toUpperCase()].forEach((ch, i) => {
    const g = FONT[ch] ?? FONT['?']!;
    for (let r = 0; r < 5; r++) rows[r] += (i ? '.' : '') + g[r]!.replace(/X/g, color);
  });
  return rows;
}
