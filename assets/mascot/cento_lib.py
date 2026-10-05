"""Cento animation engine: layered pixel sprites (face, arms, legs, accessories, props, fx)
composited onto a small canvas, frame by frame. Pure data in, pixel grids out."""

# ---------------------------------------------------------------- palette
PAL_HEX = {
    'B': '#7C5CFF', 'D': '#5A3FD1', 'H': '#A892FF', 'S': '#5A3FD1',
    'P': '#1B1530', 'T': '#3DF2C8', 'W': '#D9D2FF', 'R': '#FF5C5C',
    'w': '#F2F0FF', 'g': '#8E88A8', 'u': '#2E2850', 'K': '#3A3556', 'k': '#0A0714',
    'L': '#9FB4FF', 'G': '#4ADE80', 'Y': '#FFD166', 'O': '#FF9F43', 'N': '#8B5E3C',
    'p': '#FF8FB3', 'b': '#5AA9FF', 'r': '#FF5C5C', 'c': '#3DF2C8', 'v': '#A892FF',
    'q': '#3B2A8C', 't': '#D9A066', 'h': '#2F9E5B',
    # alternate body colours (body, shadow, highlight)
    '1': '#22C55E', '2': '#15803D', '3': '#86EFAC',   # green
    '4': '#FF2D2D', '5': '#B80F0F', '6': '#FF8080',   # bright red
    '7': '#FFD500', '8': '#C99A00', '9': '#FFEA70',   # yellow
    '@': '#8B5A2B', '%': '#5C3A1A', '&': '#B5895A',   # brown
}
PALMAP = {
    'violet': dict(B='B', D='D', H='H', S='S'),
    'red':    dict(B='4', D='5', H='6', S='5'),
    'yellow': dict(B='7', D='8', H='9', S='8'),
    'green':  dict(B='1', D='2', H='3', S='2'),
    'brown':  dict(B='@', D='%', H='&', S='%'),
}
COLORS = ['violet', 'red', 'yellow', 'green', 'brown']

# ---------------------------------------------------------------- tiny 3x5 font
_FONT_SRC = """
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
< ..X|.X.|X..|.X.|..X
@ XXX|X.X|XXX|X..|XXX
( .X.|X..|X..|X..|.X.
) .X.|..X|..X|..X|.X.
  ...|...|...|...|...
"""
FONT = {}
for _l in _FONT_SRC.strip().splitlines():
    FONT[_l[0]] = _l[2:].split('|')


def text_rows(s, color='w'):
    rows = ['' for _ in range(5)]
    for i, ch in enumerate(s.upper()):
        g = FONT.get(ch, FONT['?'])
        for r in range(5):
            rows[r] += ('.' if i else '') + g[r].replace('X', color)
    return rows


# ---------------------------------------------------------------- body sprite
HEAD = [
    "............",
    "............",
    "..BBBBBBBB..",
    ".HBBBBBBBBB.",
    ".BBBBBBBBBB.",
    "BBBBBBBBBBBB",
    "BBBBBBBBBBBB",
    "BBBBBBBBBBBB",
    "BBBBBBBBBBBB",
    "DBBBBBBBBBBD",
]
LEGS = {
    'a':    ["BB.BB..BB.BB", "B.BB....BB.B"],
    'b':    ["BB.BB..BB.BB", ".B.BB..BB.B."],
    'tuck': ["BB.BBBBBB.BB", ".B........B."],
    'wide': ["B.BB.BB.BB.B", "B..B....B..B"],
}


def eye_pixels(state, side):
    b = 2 if side == 'l' else 7
    L = side == 'l'
    P = 'P'
    s = state
    if s == 'open':    return [(6, b+1, P), (7, b+1, P)]
    if s == 'closed':  return [(7, b, P), (7, b+1, P), (7, b+2, P)]
    if s == 'happy':   return [(6, b+1, P), (7, b, P), (7, b+2, P)]
    if s == 'ring':    return [(5, b, P), (5, b+1, P), (5, b+2, P), (6, b, P), (6, b+2, P), (7, b, P), (7, b+1, P), (7, b+2, P)]
    if s == 'left':    return [(6, b, P), (7, b, P)]
    if s == 'right':   return [(6, b+2, P), (7, b+2, P)]
    if s == 'up':      return [(5, b+1, P), (6, b+1, P)]
    if s == 'down':    return [(7, b+1, P), (8, b+1, P)]
    if s == 'x':       return [(5, b, P), (5, b+2, P), (6, b+1, P), (7, b, P), (7, b+2, P)]
    if s == 'squint':  return [(7, b, P), (7, b+1, P)] if L else [(7, b+1, P), (7, b+2, P)]
    if s == 'dot':     return [(7, b+1, P)]
    if s == 'heart':   return [(5, b, 'p'), (5, b+2, 'p'), (6, b, 'p'), (6, b+1, 'p'), (6, b+2, 'p'), (7, b+1, 'p')]
    if s == 'star':    return [(5, b+1, 'Y'), (6, b, 'Y'), (6, b+1, 'Y'), (6, b+2, 'Y'), (7, b+1, 'Y')]
    if s == 'dz1':     return [(5, b, P), (5, b+1, P), (6, b+2, P), (7, b+1, P), (7, b, P)]
    if s == 'dz2':     return [(5, b+1, P), (5, b+2, P), (6, b, P), (7, b+1, P), (7, b+2, P)]
    if s == 'shine':   return [(6, b+1, 'w'), (7, b+1, P)]
    if s == 'tear':    return [(6, b+1, P), (7, b+1, P), (8, b+1, 'b'), (9, b+1, 'b')]
    if s == 'angry':
        return [(6, b+1, P), (7, b+1, P)] + ([(5, b+1, P), (5, b+2, P), (4, b, P)] if L else [(5, b, P), (5, b+1, P), (4, b+2, P)])
    if s == 'sad':
        return [(6, b+1, P), (7, b+1, P)] + ([(5, b, P), (5, b+1, P), (4, b+2, P)] if L else [(5, b+1, P), (5, b+2, P), (4, b, P)])
    if s == 'none':    return []
    raise ValueError('eye state ' + s)


MOUTHS = {
    'flat':   [(8, 5), (8, 6)],
    'smile':  [(8, 4), (8, 7), (9, 5), (9, 6)],
    'grin':   [(8, 4), (8, 5), (8, 6), (8, 7), (9, 5), (9, 6)],
    'open':   [(8, 5), (8, 6), (9, 5), (9, 6)],
    'gasp':   [(8, 4), (8, 5), (8, 6), (8, 7), (9, 4), (9, 5), (9, 6), (9, 7)],
    'frown':  [(8, 5), (8, 6), (9, 4), (9, 7)],
    'zig':    [(8, 4), (9, 5), (8, 6), (9, 7)],
    'small':  [(8, 5)],
    'none':   [],
    'tongue': [(8, 4), (8, 5), (8, 6), (8, 7)],
}
TONGUE = [(9, 5, 'p'), (9, 6, 'p')]

# left-arm templates (r, c) in sprite coords; right arm is mirrored c -> 11-c
ARMS = {
    'down': [],
    'side': [(8, -1), (9, -1), (10, -1)],
    'out':  [(8, -1), (8, -2)],
    'far':  [(8, -1), (8, -2), (8, -3)],
    'up':   [(8, -1), (7, -1), (6, -1), (5, -1)],
    'upw':  [(8, -1), (7, -1), (6, -1), (5, -2)],
    'high': [(8, -1), (7, -1), (6, -1), (5, -1), (4, -1), (3, -1)],
    'flex': [(8, -1), (7, -1), (7, -2), (6, -2)],
    'cheer': [(8, -1), (7, -2), (6, -3), (5, -3)],
    'dn':   [(8, -1), (9, -2), (10, -3)],
    'reach': [(8, -1), (7, -1), (6, -1), (5, -1), (4, -1), (3, -1), (2, -1), (2, -2), (2, -3), (2, -4), (2, -5), (2, -6)],
    'hand': [(9, 3), (9, 4)],
    'hand2': [(8, 3), (8, 4)],
    'cover': [(6, 2), (6, 3), (6, 4), (7, 2), (7, 3), (7, 4)],
}
_HAND_ONLY = {'hand', 'hand2', 'cover'}

ACC = {
    'headphones': [(3, 0, 'u'), (2, 1, 'u'), (1, 2, 'u'), (1, 3, 'u'), (1, 4, 'u'), (1, 7, 'u'), (1, 8, 'u'), (1, 9, 'u'), (2, 10, 'u'), (3, 11, 'u'),
                   (4, -1, 'K'), (5, -1, 'K'), (6, -1, 'K'), (4, 0, 'K'), (5, 0, 'K'), (6, 0, 'K'),
                   (4, 12, 'K'), (5, 12, 'K'), (6, 12, 'K'), (4, 11, 'K'), (5, 11, 'K'), (6, 11, 'K')],
    'sunglasses': [(6, c, 'k') for c in (1, 2, 3, 4, 7, 8, 9, 10)] + [(7, c, 'k') for c in (2, 3, 4, 7, 8, 9)] + [(6, 5, 'k'), (6, 6, 'k'), (6, 2, 'w')],
    'glasses': [(5, 2, 'w'), (5, 3, 'w'), (5, 4, 'w'), (6, 2, 'w'), (6, 4, 'w'), (7, 2, 'w'), (7, 3, 'w'), (7, 4, 'w'),
                (5, 7, 'w'), (5, 8, 'w'), (5, 9, 'w'), (6, 7, 'w'), (6, 9, 'w'), (7, 7, 'w'), (7, 8, 'w'), (7, 9, 'w'), (6, 5, 'w'), (6, 6, 'w')],
    'party': [(-1, 5, 'p'), (-1, 6, 'p'), (0, 5, 'Y'), (0, 6, 'Y'), (1, 4, 'O'), (1, 5, 'Y'), (1, 6, 'O'), (1, 7, 'Y'),
              (2, 3, 'Y'), (2, 4, 'O'), (2, 5, 'Y'), (2, 6, 'O'), (2, 7, 'Y'), (2, 8, 'O')],
    'cap': [(2, c, 'b') for c in range(2, 10)] + [(3, c, 'b') for c in range(1, 11)] + [(3, 11, 'b'), (3, 12, 'b'), (3, 13, 'b')],
    'crown': [(0, 3, 'Y'), (0, 5, 'Y'), (0, 6, 'Y'), (0, 8, 'Y')] + [(1, c, 'Y') for c in range(3, 9)] + [(1, 5, 'r'), (2, 3, 'Y'), (2, 4, 'Y'), (2, 7, 'Y'), (2, 8, 'Y')],
    'wizard': [(-3, 6, 'q'), (-2, 5, 'q'), (-2, 6, 'q'), (-1, 4, 'q'), (-1, 5, 'Y'), (-1, 6, 'q'), (-1, 7, 'q'),
               (0, 3, 'q'), (0, 4, 'q'), (0, 5, 'q'), (0, 6, 'q'), (0, 7, 'q'), (0, 8, 'q'), (1, 1, 'q'), (1, 2, 'q'), (1, 3, 'q'),
               (1, 4, 'q'), (1, 5, 'q'), (1, 6, 'q'), (1, 7, 'q'), (1, 8, 'q'), (1, 9, 'q'), (1, 10, 'q')],
    'headband': [(5, c, 'r') for c in range(0, 12)] + [(5, 12, 'r'), (6, 13, 'r'), (4, 13, 'r')],
    'mask': [(6, c, 'k') for c in range(0, 12)] + [(7, c, 'k') for c in (1, 2, 3, 4, 7, 8, 9, 10)] + [(5, c, 'k') for c in (1, 2, 3, 4, 7, 8, 9, 10)],
    'cape': [(r, c, 'r') for r in range(4, 12) for c in (-1, 12)] + [(r, c, 'r') for r in range(7, 12) for c in (-2, 13)],
    'blush': [(8, 2, 'p'), (8, 9, 'p')],
    'sweat': [(3, 11, 'b'), (4, 12, 'b'), (5, 12, 'b')],
    'bandage': [(3, 7, 'w'), (3, 8, 'w'), (4, 7, 'w'), (4, 8, 'w'), (3, 6, 'g'), (4, 9, 'g')],
    'green': [(8, 2, 'G'), (8, 3, 'G'), (8, 8, 'G'), (8, 9, 'G')],
}


def cento_pixels(e='open', m='flat', al='down', ar='down', lg=None, acc=(), tip='T', pal='violet', rot=0):
    """Return {(r, c): char} for one Cento in sprite coordinates (before placement)."""
    g = {}
    legs = LEGS[lg or 'a']
    rows = HEAD + legs
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != '.':
                g[(r, c)] = ch
    g[(0, 5)] = g[(0, 6)] = tip
    g[(1, 5)] = g[(1, 6)] = 'S'
    el, er = (e, e) if isinstance(e, str) else e
    for r, c, ch in eye_pixels(el, 'l') + eye_pixels(er, 'r'):
        g[(r, c)] = ch
    for r, c in MOUTHS[m if m != 'tongue' else 'tongue']:
        g[(r, c)] = 'P'
    if m == 'tongue':
        for r, c, ch in TONGUE:
            g[(r, c)] = ch
    for side, a in (('l', al), ('r', ar)):
        pts = ARMS[a]
        for i, (r, c) in enumerate(pts):
            cc = c if side == 'l' else 11 - c
            tipc = a in _HAND_ONLY or i == len(pts) - 1
            g[(r, cc)] = 'D' if tipc else 'B'
    for a in acc:
        for r, c, ch in ACC[a]:
            g[(r, c)] = ch
    pm = PALMAP[pal]
    out = {}
    for (r, c), ch in g.items():
        out[(r, c)] = pm.get(ch, ch) if ch in 'BDHS' else ch
    for _ in range(rot % 4):
        out = {(c, 11 - r): ch for (r, c), ch in out.items()}
    return out


# ---------------------------------------------------------------- props
STATIC = {
    'heart':   [".p.p.", "ppppp", ".ppp.", "..p.."],
    'heartr':  [".r.r.", "rrrrr", ".rrr.", "..r.."],
    'heart_s': ["p.p", "ppp", ".p."],
    'spark':   ["..Y..", "..Y..", "YYwYY", "..Y..", "..Y.."],
    'spark_s': [".Y.", "YwY", ".Y."],
    'twinkle': [".w.", "www", ".w."],
    'dot_y':   ["Y"], 'dot_w': ["w"], 'dot_p': ["p"], 'dot_c': ["c"],
    'note':    ["..bb", "..b.", "..b.", "bbb.", "bb.."],
    'note_p':  ["..pp", "..p.", "..p.", "ppp.", "pp.."],
    'bulb':    [".YYY.", "YwYYY", "YYYYY", ".YYY.", "..g..", "..g.."],
    'drop':    ["b", "b"],
    'tear':    ["b", "b"],
    'sweat':   [".b", "bb", "bb"],
    'check':   ["....G", "...G.", "G.G..", ".G..."],
    'xmark':   ["r...r", ".r.r.", "..r..", ".r.r.", "r...r"],
    'xmark_s': ["r.r", ".r.", "r.r"],
    'cup':     ["wwwww.", "wNNNww", "wNNNw.", ".www.."],
    'steam1':  [".g.", "g..", ".g."],
    'steam2':  ["g..", ".g.", "g.."],
    'pizza':   ["tttttt", ".OYYO.", ".OrYO.", "..OY..", "..O..."],
    'boba':    ["...N.", "wwwww", "wtttw", "wtttw", "wttNw", ".www."],
    'book':    ["uuuuuuuu", "wwwuwwww", "wLwuwLww", "wwwuwwww", "wLwuwLww"],
    'phone':   ["kkk", "kLk", "kLk", "kLk", "kkk"],
    'magnifier': [".ggg..", "gLLLg.", "gLLLg.", ".ggg..", "....N.", ".....N"],
    'mail':    ["wwwwww", "wkwwkw", "wwkkww", "wwwwww"],
    'lock':    [".ggg.", "g...g", "g...g", "YYYYY", "YYkYY", "YYYYY"],
    'gear':    [".Y.Y.", "YYYYY", "YYkYY", "YYYYY", ".Y.Y."],
    'bug':     ["r.rr.r", "rkrrkr", ".rrrr.", "r.rr.r"],
    'duck':    ["..YY..", ".YkYO.", ".YYY..", "YYYYY.", ".YYYY.", "..YY.."],
    'trophy':  ["YYYYYYY", "Y.YYY.Y", "Y.YwY.Y", ".YYYYY.", "..YYY..", "...Y...", "..NNN..", ".NNNNN."],
    'balloon': [".ppp.", "pwppp", "ppppp", ".ppp.", "..p..", "..g..", "..g.."],
    'gift':    ["..rr..", ".r..r.", "bbrrbb", "bbrrbb", "bbrrbb", "bbbbbb"],
    'flag':    ["NGGG.", "NGGGG", "NGGG.", "N....", "N....", "N....", "N...."],
    'wand':    ["....wY", "...N..", "..N...", ".N....", "N....."],
    'cloud':   ["..www..", ".wwwww.", "wwwwwww", ".wwwww."],
    'cloud_d': ["..ggg..", ".ggggg.", "ggggggg", ".ggggg."],
    'sun':     ["Y.Y.Y", ".YYY.", "YYYYY", ".YYY.", "Y.Y.Y"],
    'moon':    [".YYY.", "YY...", "Y....", "YY...", ".YYY."],
    'pillow':  [".www.", "wwwww", "wwwww"],
    'rocket':  ["..w..", ".wLw.", ".wLw.", ".www.", "rwwwr", "r.w.r"],
    'arrow_up': ["..c..", ".ccc.", "c.c.c", "..c..", "..c.."],
    'arrow_dn': ["..c..", "..c..", "c.c.c", ".ccc.", "..c.."],
    'hammer':  ["ggg", "ggg", ".N.", ".N.", ".N.", ".N."],
    'hammer_h': ["...gg", "NNNgg"],
    'wifi':    [".ccccc.", "c.....c", "..ccc..", ".c...c.", "...c...", "...c..."],
    'umbrella': ["...rrr...", ".rrrrrrr.", "rrrrrrrrr", "....N....", "....N....", "....N....", "...NN...."],
    'dumbbell': ["gg.....gg", "gggggggggg"[:9], "gg.....gg"],
    'controller': [".uuuuuuu.", "uurruuuuu"[:9], "uuuuuuuuu", ".uu...uu."],
    'mic':     ["ggg", "gkg", "ggg", ".N.", ".N."],
    'box':     ["NNNNNNNNNNNN"] + ["NtttttttttN."[:12]] * 4 + ["NNNNNNNNNNNN"],
    'envelope': ["wwwwww", "wkwwkw", "wwkkww", "wwwwww"],
    'alarm':   ["r.Y.Y.r", ".rrrrr.", "rrwwwrr", "rrwkwrr", "rrwwwrr", ".rrrrr."],
    'list':    ["wwwwwww", "wLLL.Lw", "wwwwwww", "wLLLLLw", "wwwwwww", "wLL.LLw", "wwwwwww"],
    'shuriken': [".g.", "ggg", ".g."],
    'thought': [".wwwww.", "wwwwwww", "wwwwwww", ".wwwww.", "w", "..", ],
    'sheep':   [".www.", "wwwww", "wwwkw", ".w.w."],
    'plant':   ["..G.G..", ".GGGGG.", "..GGG..", "...N...", "..NNN..", ".NNNNN."],
    'stopsign': ["..rrrr..", ".rrrrrr.", "rrwwwwrr", "rrrrrrrr", ".rrrrrr.", "..rrrr.."],
    'hourglass_a': ["wwwww", ".YYY.", "..Y..", "..w..", ".www.", "wwwww"],
    'hourglass_b': ["wwwww", ".www.", "..w..", "..Y..", ".YYY.", "wwwww"],
    'skull':   [".www.", "wkwkw", "wwwww", ".wkw.", ".w.w."],
    'disco':   ["..g..", ".gwg.", "gwgwg", ".gwg.", "..g.."],
    'bomb':    ["...Y.", "..N..", ".uuu.", "uuuuu", "uuuuu", ".uuu."],
    'puff':    ["g.g", ".g.", "g.g"],
    'pencil':  ["....Y", "...Y.", "..Y..", ".O...", "p...."],
    'ball':    [".OOO.", "OOOOO", "OOOOO", ".OOO."],
    'sheet':   ["wwwww", "wLLLw", "wwwww"],
}
STATIC['dumbbell'] = ["gg.....gg", "gggggggggg"[:9], "gg.....gg"]
STATIC['controller'] = [".uuuuuuu.", "uubuurruu"[:9], "uuuuuuuuu", ".uu...uu."]
STATIC['box'] = ["NNNNNNNNNNNN"] + ["NtttttttttN"[:11].ljust(12, 'N')] * 3 + ["NNNNNNNNNNNN"]
STATIC['thought'] = [".wwwww.", "wwwwwww", "wwwwwww", ".wwwww.", "w.", "..."]


def p_text(s, color='w'):
    return text_rows(s, color)


def p_bubble(s, tail='l', color='w', ink='u'):
    tw = len(s) * 4 - 1
    w = tw + 4
    rows = []
    for r in range(7):
        rows.append(''.join('.' if ((r in (0, 6)) and (c in (0, w - 1))) else color for c in range(w)))
    tr = text_rows(s, ink)
    for i in range(5):
        row = list(rows[i + 1])
        for j, ch in enumerate(tr[i]):
            if ch != '.':
                row[2 + j] = ch
        rows[i + 1] = ''.join(row)
    if tail == 'l':
        rows += ['..' + color + '.' * (w - 3), '.' + color + '.' * (w - 2)]
    elif tail == 'r':
        rows += ['.' * (w - 4) + color + '.' * 3, '.' * (w - 3) + color + '..'[:2]][:2]
        rows[-2] = '.' * (w - 4) + color + '...'
        rows[-1] = '.' * (w - 3) + color + '..'
    return rows


def p_laptop(mode='code', t=0):
    lines = ["GGG.bbbb.", "..YYYY.w.", "..wwww...", "GG.bbb.YY", ".bbbbbb..", "...GGGG..", "bb.GGG.Y."]
    rows = ["uuuuuuuuuuu"]
    for i in range(3):
        if mode == 'code':
            s = lines[(t + i) % len(lines)]
        elif mode == 'ok':
            ch = 'G' if t % 2 == 0 else 'c'
            s = ["......%s.." % ch, "...%s.%s..." % (ch, ch), "....%s...." % ch][i]
        elif mode == 'err':
            ch = 'r' if t % 2 == 0 else 'Y'
            s = ["...%s.%s..." % (ch, ch), "....%s...." % ch, "...%s.%s..." % (ch, ch)][i]
        elif mode == 'load':
            dots = ['.....', 'w....', 'ww...', 'www..', 'wwww.', 'wwwww'][t % 6]
            s = ['.........', '..' + dots + '..', '.........'][i]
        elif mode == 'term':
            cur = 'w' if t % 2 == 0 else '.'
            s = ["G.wwww...", "G.wwwwww.", "G." + cur + "......."][i]
        elif mode == 'bug':
            x = (t * 2) % 8
            s = ['.........', '.' * x + 'r' + '.' * (8 - x), '.........'][i]
        else:
            s = '.........'
        rows.append('u' + s.replace('.', 'k') + 'u')
    rows.append("uuuuuuuuuuu")
    rows.append(".KKKKKKKKK.")
    return rows


def p_progress(w=14, pct=0.5, fill='G'):
    n = max(0, min(w - 2, int(round((w - 2) * pct))))
    top = 'g' * w
    mid = 'g' + fill * n + 'u' * (w - 2 - n) + 'g'
    return [top, mid, top]


def p_spinner(t=0):
    ring = [(0, 1), (0, 2), (0, 3), (1, 4), (2, 4), (3, 4), (4, 3), (4, 2), (4, 1), (3, 0), (2, 0), (1, 0)]
    rows = [['.'] * 5 for _ in range(5)]
    for i, (r, c) in enumerate(ring):
        rows[r][c] = 'g'
    for k, ch in enumerate(['w', 'v', 'g']):
        r, c = ring[(t - k) % 12]
        rows[r][c] = ch if k < 2 else 'g'
    return [''.join(r) for r in rows]


def p_dots(n=3):
    rows = [".wwwwwwwww.", "wwwwwwwwwww", "wwwwwwwwwww", "wwwwwwwwwww", ".wwwwwwwww."]
    mid = list(rows[2])
    for i in range(3):
        if i < n:
            mid[3 + i * 2] = 'u'
    rows[2] = ''.join(mid)
    return rows + ["ww........."[:11], "w.........."]


def p_cursor(color='c'):
    X = color
    return [X + "...", X * 2 + "..", X * 3 + ".", X * 4, X * 2 + "..", X + "..."]


def p_branch(t=0):
    W, H = 11, 10
    g = [['.'] * W for _ in range(H)]
    for r in range(H):
        g[r][2] = 'c'
    if t >= 1:
        g[2][3] = 'p'; g[3][4] = 'p'; g[4][5] = 'p'; g[4][6] = 'p'
        for r in range(5, 7):
            g[r][7] = 'p'
    if t >= 2:
        g[5][7] = 'Y'; g[6][7] = 'Y'
    if t >= 3:
        g[7][6] = 'p'; g[8][5] = 'p'; g[8][4] = 'p'; g[8][3] = 'p'
        g[8][2] = 'Y'
    return [''.join(r) for r in g]


def p_confetti(t=0, seed=0, w=24, h=16, n=18):
    cols = ['Y', 'p', 'c', 'b', 'r', 'G']
    g = [['.'] * w for _ in range(h)]
    for i in range(n):
        x = (i * 37 + seed * 11) % w
        y = (i * 5 + t * 2) % h
        g[y][x] = cols[(i + seed) % len(cols)]
    return [''.join(r) for r in g]


def p_rain(t=0, w=20, h=10, n=12):
    g = [['.'] * w for _ in range(h)]
    for i in range(n):
        x = (i * 7 + 3) % w
        y = (i * 3 + t * 2) % h
        g[y][x] = 'b'
        if y + 1 < h:
            g[y + 1][x] = 'b'
    return [''.join(r) for r in g]


def p_burst(t=0, color='Y', R=6):
    n = 2 * R + 1
    g = [['.'] * n for _ in range(n)]
    r = 1 + t
    if r <= R:
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            y, x = R + dy * r, R + dx * r
            if 0 <= y < n and 0 <= x < n:
                g[y][x] = color
        if r >= 3:
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                y, x = R + dy * (r - 2), R + dx * (r - 2)
                g[y][x] = 'w'
    return [''.join(r) for r in g]


def p_flame(t=0):
    a = ["..O..", ".OOO.", "OOYOO", "OYYYO", ".OYO."]
    b = [".O...", ".OOO.", "OOYOO", "OYYYO", ".OYO."]
    return a if t % 2 == 0 else b


def p_stars(t=0, w=20, h=8):
    pts = [(1, 2), (5, 5), (9, 1), (13, 6), (17, 3), (3, 7), (11, 4), (7, 0)]
    g = [['.'] * w for _ in range(h)]
    for i, (x, y) in enumerate(pts):
        if x < w and y < h:
            g[y][x] = 'Y' if (i + t) % 2 == 0 else 'w'
    return [''.join(r) for r in g]


def p_hline(w, ch='u'):
    return [ch * w]


def p_hourglass(t=0):
    return STATIC['hourglass_a' if t % 2 == 0 else 'hourglass_b']


DYN = {
    'text': p_text, 'bubble': p_bubble, 'laptop': p_laptop, 'progress': p_progress,
    'spinner': p_spinner, 'dots': p_dots, 'cursor': p_cursor, 'branch': p_branch,
    'confetti': p_confetti, 'rain': p_rain, 'burst': p_burst, 'flame': p_flame,
    'stars': p_stars, 'hline': p_hline, 'hourglass': p_hourglass,
}


def prop_rows(item):
    kind = item[0]
    if kind in STATIC:
        return STATIC[kind]
    return DYN[kind](*item[3:])


# ---------------------------------------------------------------- compositing
CW, CH = 64, 30
ME = (14, 14)


def new_canvas():
    return [['.'] * CW for _ in range(CH)]


def blit_rows(cv, rows, x, y):
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != '.' and 0 <= y + r < CH and 0 <= x + c < CW:
                cv[y + r][x + c] = ch


def blit_pixels(cv, px, x, y):
    for (r, c), ch in px.items():
        if 0 <= y + r < CH and 0 <= x + c < CW:
            cv[y + r][x + c] = ch


def render_frame(fr, gap=16, fpal='green', mepal='violet'):
    cv = new_canvas()
    for item in fr['bg']:
        blit_rows(cv, prop_rows(item), ME[0] + item[1], ME[1] + item[2])
    chars = [(fr['me'], mepal, 0)]
    if fr['fr'] is not None:
        chars.append((fr['fr'], fpal, gap))
    for spec, pal, off in chars:
        spec = dict(spec)
        dx, dy = spec.pop('x', 0), spec.pop('y', 0)
        spec.setdefault('pal', pal)
        px = cento_pixels(**spec)
        blit_pixels(cv, px, ME[0] + off + dx, ME[1] + dy)
    for item in fr['p']:
        blit_rows(cv, prop_rows(item), ME[0] + item[1], ME[1] + item[2])
    for r, s in fr.get('gl') or []:
        row = cv[r + ME[1]]
        s = s % CW
        cv[r + ME[1]] = row[-s:] + row[:-s] if s else row
    return cv


def bbox(grids):
    x0, y0, x1, y1 = CW, CH, -1, -1
    for g in grids:
        for y, row in enumerate(g):
            for x, ch in enumerate(row):
                if ch != '.':
                    x0, x1 = min(x0, x), max(x1, x)
                    y0, y1 = min(y0, y), max(y1, y)
    return x0, y0, x1, y1


def f(d=200, p=None, bg=None, fr=None, gl=None, **me):
    if 'lg' not in me:
        me['_autolg'] = True
    return dict(d=d, p=p or [], bg=bg or [], fr=fr, gl=gl, me=me)
