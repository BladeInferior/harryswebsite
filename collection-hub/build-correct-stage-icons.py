# Builds icons/correctstageicons/<name>.png (the Correct Stage dot in the shiny
# modal): one small menu icon per entry in fullPokemonList.json, downloaded from
# pokemondb.net/sprites (Scarlet/Violet icon set, normal colours — it has no
# shiny icons). The raw icons are 120x112 with the Pokémon often only ~35px of
# that, so each is trimmed to its visible pixels, scaled so its longest side is
# FIT px, centred on a SIZE x SIZE transparent square (every Pokémon fills about
# the same space) and palette-quantised to keep the folder small.
# Files named in KEEP (the hand-added rampardos.png / regigigas.png) are never
# touched. Overwrites everything else, so re-running just rebuilds.
#
# Run from collection-hub/:  python build-correct-stage-icons.py   (needs Pillow)
import io, json, os, re, urllib.request
from PIL import Image

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "icons", "correctstageicons")
INDEX = "https://pokemondb.net/sprites"
ICON_BASE = "https://img.pokemondb.net/sprites/scarlet-violet/icon/"
SIZE, FIT = 192, 174
KEEP = {"rampardos.png", "regigigas.png"}
REGION = {"Alolan": "alolan", "Galarian": "galarian", "Hisuian": "hisuian", "Paldean": "paldean"}
# Forms whose pokemondb file name isn't "<name>-<region>".
OVERRIDES = {
    "Galarian Darmanitan": "darmanitan-galarian-standard",
    "Hisuian Basculin": "basculin-white-striped",
    "Bloodmoon Ursaluna": "ursaluna-bloodmoon",
}

def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        return urllib.request.urlopen(req, timeout=30).read()
    except Exception:
        return None

def slug(name):
    if name in OVERRIDES:
        return OVERRIDES[name]
    m = re.match(r"^(Alolan|Galarian|Hisuian|Paldean) (.+)$", name)
    base = (m.group(2) if m else name).lower()
    base = re.sub(r"[.':]", "", base).replace(" ", "-")
    return f"{base}-{REGION[m.group(1)]}" if m else base

os.makedirs(OUT, exist_ok=True)
html = get(INDEX).decode("utf-8", "ignore")
from_index = {norm(alt): src for src, alt in re.findall(r'<img[^>]*src="([^"]*/icon/[^"]+\.png)"[^>]*alt="([^"]*)"', html)}

done, missing = 0, []
for p in json.load(open(os.path.join(HERE, "fullPokemonList.json"), encoding="utf-8")):
    name = p["name"]
    file = norm(name) + ".png"
    if file in KEEP:
        continue
    data = None
    for url in [from_index.get(norm(name)), ICON_BASE + slug(name) + ".png"]:
        if url and (data := get(url)):
            break
    if not data:
        missing.append(name)
        continue
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    box = im.getbbox()
    if not box:
        missing.append(name)
        continue
    im = im.crop(box)
    scale = FIT / max(im.size)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2), im)
    out.quantize(colors=256, method=Image.FASTOCTREE).save(os.path.join(OUT, file), optimize=True)
    done += 1
print(f"Built {done} icons")
if missing:
    print("Not found:", ", ".join(missing))
