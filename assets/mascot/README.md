# Cento: mascot assets

| Path | What |
|---|---|
| `animations.json` | All 319 animations as pixel rows + palette + colour maps (runtime source of truth) |
| `gallery.html` | Browse, recolour (5 colours) and tile (solo/duo/trio/squad/group) every animation |
| `play.py` | Terminal player: `python3 play.py --tour`, `python3 play.py typing --color red` |
| `svg/<name>.svg` | One animated SVG per animation (violet) |
| `gif/<colour>/<name>.gif` | Solo GIFs: `violet red yellow green brown` |
| `gif/<crowd>/<name>.gif` | Mixed-colour crowds: `duo trio squad group` (social scenes have duo/squad/group only) |
| `showcase/` | `cento.png` and three small display GIFs |
| `cento_lib.py`, `animations*.py` | The engine and the animation definitions |
| `build.py` | Regenerates everything (`animations.json`, `svg/`, `gif/`) |
| `gen.py` | The original five static poses |

Add an animation: define it in `animations.py` (or `animations_ui.py`), run `python3 build.py`, open `gallery.html`. Design rules: `../DESIGN.md` section 3.
