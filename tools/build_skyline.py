"""Builds site/assets/ccd-skyline-loader.svg and site/loading-state.html.

Usage (from the project root):
  python3 tools/build_skyline.py "Cornell Logo source image/cornell_seal_simple_web_black.svg" site

The Cornell seal is embedded verbatim from the official black web file. The only
element dropped is a zero-length stray path (d="M131.3,85.2") that renders nothing.
The skyline is original line art: strokes only, no fills.
"""
import math, os, re, sys

seal_src, site = sys.argv[1], sys.argv[2]
raw = open(seal_src, encoding="utf-8").read()
inner = raw.split("</style>", 1)[1].rsplit("</svg>", 1)[0]
inner = re.sub(r'\s*<path class="st1" d="M131\.3,85\.2"/>', "", inner).strip("\n")
assert "st1" not in inner

PHI = (1 + 5 ** .5) / 2
G = 226            # local ground line for Qutub, India Gate, Red Fort
GH = 212           # local ground line the Raisina pieces were drawn on

# ---------------------------------------------------------------- helpers
def f(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s

def L(*pts):
    return "M" + "L".join(f"{f(x)},{f(y)}" for x, y in pts)

def R(x0, y0, x1, y1):
    return f"M{f(x0)},{f(y0)}H{f(x1)}V{f(y1)}H{f(x0)}Z"

def hl(x0, x1, y):
    return f"M{f(x0)},{f(y)}H{f(x1)}"

def vl(x, y0, y1):
    return f"M{f(x)},{f(y0)}V{f(y1)}"

def parch(x0, x1, yb, ys, yp):
    """Pointed Mughal arch, open at the base (jambs from yb to springing ys, apex yp)."""
    cx, h, w = (x0 + x1) / 2, ys - yp, x1 - x0
    return (f"M{f(x0)},{f(yb)}V{f(ys)}C{f(x0)},{f(ys - h*.55)} {f(cx - w*.2)},{f(yp + h*.1)} {f(cx)},{f(yp)}"
            f"C{f(cx + w*.2)},{f(yp + h*.1)} {f(x1)},{f(ys - h*.55)} {f(x1)},{f(ys)}V{f(yb)}")

def parch_top(x0, x1, ys, yp):
    """Just the pointed arch curve, springing to springing."""
    cx, h, w = (x0 + x1) / 2, ys - yp, x1 - x0
    return (f"M{f(x0)},{f(ys)}C{f(x0)},{f(ys - h*.55)} {f(cx - w*.2)},{f(yp + h*.1)} {f(cx)},{f(yp)}"
            f"C{f(cx + w*.2)},{f(yp + h*.1)} {f(x1)},{f(ys - h*.55)} {f(x1)},{f(ys)}")

def rarch(x0, x1, yb, ys):
    r = (x1 - x0) / 2
    return f"M{f(x0)},{f(yb)}V{f(ys)}A{f(r)},{f(r)} 0 0 1 {f(x1)},{f(ys)}V{f(yb)}"

def arc(cx, cy, r, a0, a1):
    """Circular arc, angles in degrees (0 = right, 90 = up), drawn from a0 to a1."""
    p = lambda a: (cx + r * math.cos(math.radians(a)), cy - r * math.sin(math.radians(a)))
    (x0, y0), (x1, y1) = p(a0), p(a1)
    large = 1 if abs(a1 - a0) > 180 else 0
    sweep = 0 if a1 > a0 else 1
    return f"M{f(x0)},{f(y0)}A{f(r)},{f(r)} 0 {large} {sweep} {f(x1)},{f(y1)}"

def circ(cx, cy, r):
    """Circle as four cubic Beziers (measures exactly under pathLength, unlike tiny arcs)."""
    k = .5523 * r
    return (f"M{f(cx - r)},{f(cy)}C{f(cx - r)},{f(cy - k)} {f(cx - k)},{f(cy - r)} {f(cx)},{f(cy - r)}"
            f"C{f(cx + k)},{f(cy - r)} {f(cx + r)},{f(cy - k)} {f(cx + r)},{f(cy)}"
            f"C{f(cx + r)},{f(cy + k)} {f(cx + k)},{f(cy + r)} {f(cx)},{f(cy + r)}"
            f"C{f(cx - k)},{f(cy + r)} {f(cx - r)},{f(cy + k)} {f(cx - r)},{f(cy)}Z")

def squiggle(x0, x1, y, amp=.6, step=1.6):
    """Wavy line standing in for carved inscription."""
    d, x, up = f"M{f(x0)},{f(y)}", x0, True
    while x + step <= x1 + .01:
        d += f"Q{f(x + step/2)},{f(y - amp if up else y + amp)} {f(x + step)},{f(y)}"
        x += step; up = not up
    return d

def kanguras(x0, x1, y, w=4, h=5, gap=1.6, slit=True):
    """Rounded Mughal battlements (kanguras) along a wall top at y."""
    d, x = f"M{f(x0)},{f(y)}", x0
    slits = []
    while x + gap + w <= x1 + .01:
        x += gap
        r = w / 2
        d += f"H{f(x)}V{f(y - h + r)}A{f(r)},{f(r)} 0 0 1 {f(x + w)},{f(y - h + r)}V{f(y)}"
        if slit and h >= 4:
            slits.append(vl(x + r, y - .8, y - h + r + .2))
        x += w
    return d + f"H{f(x1)}", slits

def chhatri(cx, yb, hw, post, dome, fin=4.0, arches=True):
    """Open domed kiosk: plinth, posts with cusped arches, sloping chhajja, drum, bulbous dome, kalash finial."""
    o, d = [], []
    ye = yb - post
    o.append(hl(cx - hw - 1.2, cx + hw + 1.2, yb))
    xs = [cx - hw, cx - hw / 3, cx + hw / 3, cx + hw]
    for x in xs:
        o.append(vl(x, yb, ye))
    if arches and post >= 5:
        for a, b in zip(xs, xs[1:]):
            d.append(parch_top(a, b, ye + post * .42, ye + post * .12))
    o.append(L((cx - hw - 2.8, ye + 1.8), (cx - hw - .6, ye), (cx + hw + .6, ye), (cx + hw + 2.8, ye + 1.8)))
    dr = hw * .82
    o.append(vl(cx - dr, ye, ye - 1.2)); o.append(vl(cx + dr, ye, ye - 1.2))
    yb2 = ye - 1.2
    top = yb2 - dome
    o.append(f"M{f(cx - dr)},{f(yb2)}C{f(cx - dr*1.22)},{f(yb2 - dome*.45)} {f(cx - dr*.55)},{f(top + dome*.18)} {f(cx)},{f(top)}"
             f"C{f(cx + dr*.55)},{f(top + dome*.18)} {f(cx + dr*1.22)},{f(yb2 - dome*.45)} {f(cx + dr)},{f(yb2)}")
    d.append(hl(cx - dr, cx + dr, yb2))
    kr = max(.55, hw * .14)
    d.append(vl(cx, top, top - fin * .35)); d.append(circ(cx, top - fin * .35 - kr, kr))
    d.append(vl(cx, top - fin * .35 - 2 * kr, top - fin))
    return o, d

def flag(x, y, w=16, h=10):
    """Waving tricolour on a pole top at (x, y): three bands and the chakra."""
    wave = lambda yy: f"M{f(x)},{f(yy)}C{f(x + w*.3)},{f(yy - 1.6)} {f(x + w*.6)},{f(yy + 1.6)} {f(x + w)},{f(yy)}"
    o = [wave(y) + f"V{f(y + h)}C{f(x + w*.6)},{f(y + h + 1.6)} {f(x + w*.3)},{f(y + h - 1.6)} {f(x)},{f(y + h)}"]
    d = [wave(y + h / 3), wave(y + 2 * h / 3), circ(x + w / 2, y + h / 2, h * .13)]
    return o, d

# stroke "font" for carved lettering (unit glyphs 4 wide x 6 high)
GLYPHS = {
    "I": ["M0,0V6"],
    "N": ["M0,6V0L4,6V0"],
    "D": ["M0,0V6H1.6C4.4,6 4.4,0 1.6,0Z"],
    "A": ["M0,6L2,0L4,6", "M.7,4H3.3"],
    "M": ["M0,6V0L2,3.6L4,0V6"],
    "C": ["M4,.9C3.1,-.3 0,-.4 0,3C0,6.4 3.1,6.3 4,5.1"],
    "X": ["M0,0L4,6", "M4,0L0,6"],
    "V": ["M0,0L2,6L4,0"],
}
GW = {"I": 0}

def transform_path(d, dx, dy, k):
    toks = re.findall(r"[A-Za-z]|-?\d*\.?\d+", d)
    out, cmd, nums = [], None, []
    def flush():
        if cmd is None:
            return
        if cmd in "MLC":
            vals = [f(dx + v * k) if i % 2 == 0 else f(dy + v * k) for i, v in enumerate(nums)]
            out.append(cmd + ",".join(vals))
        elif cmd == "H":
            out.append("H" + f(dx + nums[0] * k))
        elif cmd == "V":
            out.append("V" + f(dy + nums[0] * k))
        elif cmd == "Z":
            out.append("Z")
    for t in toks:
        if t.isalpha():
            flush(); cmd, nums = t, []
        else:
            nums.append(float(t))
    flush()
    return "".join(out)

def text(s, cx, y_top, h):
    k = h / 6
    gap = 1.6 * k
    widths = [GW.get(c, 4) * k for c in s]
    total = sum(widths) + gap * (len(s) - 1)
    x = cx - total / 2
    out = []
    for c, w in zip(s, widths):
        out += [transform_path(g, x, y_top, k) for g in GLYPHS[c]]
        x += w + gap
    return out

class Piece:
    def __init__(self): self.o, self.d = [], []
    def O(self, *ds): self.o.extend(ds)
    def D(self, *ds): self.d.extend(ds)
    def add(self, od): self.o.extend(od[0]); self.d.extend(od[1])

# ---------------------------------------------------------------- 1. Qutub Minar
def qutub(cx=78):
    p = Piece()
    p.O(R(cx - 22, G - 4, cx + 22, G), R(cx - 19, G - 7, cx + 19, G - 4))
    y0, yT = G - 7, 48
    hw = lambda y: 4.4 + (y - yT) / (y0 - yT) * (15.2 - 4.4)
    tops = [151, 114, 87, 68, 48]
    flutes = [11, 9, 7, 0, 0]
    ys = y0
    for i, yt in enumerate(tops):
        ye = yt + 5
        a, b = hw(ys), hw(ye)
        p.O(L((cx - a, ys), (cx - b, ye)), L((cx + a, ys), (cx + b, ye)))
        n = flutes[i]
        for k in range(1, n + 1):
            fr = -1 + 2 * k / (n + 1)
            p.D(L((cx + a * fr, ys), (cx + b * fr, ye)))
        bands = {0: [.2, .47, .74], 1: [.3, .68], 2: [.5], 3: [.3, .7], 4: [.25, .55, .8]}[i]
        for t in bands:
            y = ys + (ye - ys) * t
            w = hw(y)
            p.D(hl(cx - w, cx + w, y), hl(cx - w + .1, cx + w - .1, y - 2.4))
            if i < 3:
                p.D(squiggle(cx - w + .8, cx + w - .8, y - 1.2, .45, 1.3))
        if i == 0:
            p.D(parch(cx - 3, cx + 3, y0, y0 - 9, y0 - 13))
        if i == 3:
            p.D(parch(cx - 1.8, cx + 1.8, ys - .2, ys - 6, ys - 8.6))
        bw = hw(yt) + 3.2
        p.O(L((cx - b, ye), (cx - bw, yt)), L((cx + b, ye), (cx + bw, yt)))
        p.O(R(cx - bw, yt - 2, cx + bw, yt))
        n_cells = max(4, int(2 * bw / 2.4))
        cw = 2 * bw / n_cells
        for k in range(n_cells):
            x = cx - bw + k * cw
            p.D(parch_top(x + .15, x + cw - .15, yt + 1.7, yt + .35))
        inner_w = (bw + b) / 2
        n2 = max(3, int(2 * inner_w / 2.4))
        cw2 = 2 * inner_w / n2
        for k in range(n2):
            x = cx - inner_w + k * cw2
            p.D(parch_top(x + .15, x + cw2 - .15, yt + 3.9, yt + 2.4))
        p.O(hl(cx - bw, cx + bw, yt - 5.6), vl(cx - bw, yt - 2, yt - 5.6), vl(cx + bw, yt - 2, yt - 5.6))
        x = cx - bw + 1.4
        while x < cx + bw - .8:
            p.D(vl(x, yt - 2, yt - 5.6)); x += 1.4
        ys = yt - 2
    w = hw(46) - .6
    p.O(L((cx - w, 46), (cx - w, 42.5)) + f"H{f(cx + w)}V46")
    p.D(vl(cx, 42.5, 35))
    return p

# ---------------------------------------------------------------- 2. India Gate
def india_gate(cx=228):
    p = Piece()
    p.O(R(cx - 52, G - 4, cx + 52, G), R(cx - 47, G - 8, cx + 47, G - 4))
    top_body = 128
    p.O(vl(cx - 42, G - 8, top_body), vl(cx + 42, G - 8, top_body))
    for s in (-1, 1):
        x0, x1 = sorted((cx + s * 42, cx + s * 19))
        p.D(hl(x0, x1, G - 15), hl(x0, x1, G - 13))
    r0 = 19
    ys = (G - 8) - PHI * 2 * r0 + r0          # opening height = phi x width
    p.O(rarch(cx - r0, cx + r0, G - 8, ys))
    p.O(arc(cx, ys, 22, 180, 0), arc(cx, ys, 24.5, 180, 0))
    p.D(L((cx - 2, ys - r0), (cx - 3, ys - 24.9), (cx + 3, ys - 24.9), (cx + 2, ys - r0)))
    for s in (-1, 1):
        x0, x1 = sorted((cx + s * 42, cx + s * 24.5))
        p.O(hl(x0, x1, ys + 1.5)); p.D(hl(x0, x1, ys - 1.2))
        xa, xb = sorted((cx + s * 19, cx + s * 24.5))
        p.D(hl(xa, xb, ys + 1.5))
    p.D(rarch(cx - 15, cx + 15, G - 8, ys))
    for a in (30, 60, 90, 120, 150):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        p.D(L((cx + 15 * ca, ys - 15 * sa), (cx + 19 * ca, ys - 19 * sa)))
    for y in (ys + 11, ys + 22, ys + 33):
        p.D(hl(cx - 19, cx - 15, y), hl(cx + 15, cx + 19, y))
    for s in (-1, 1):
        x0, x1 = sorted((cx + s * 37, cx + s * 27))
        p.D(R(x0, ys + 8, x1, 207), R(x0 + 1.5, ys + 10, x1 - 1.5, 205))
        xm = cx + s * 33
        p.D(circ(xm, ys - 17, 4.2), circ(xm, ys - 17, 2.3))
    p.O(hl(cx - 42, cx + 42, 141))
    p.D(*text("INDIA", cx, 131.5, 6.2))
    p.D(*text("MCMXIV", cx - 28.5, 133, 4))
    p.D(*text("MCMXIX", cx + 28.5, 133, 4))
    p.O(R(cx - 45.5, 122, cx + 45.5, top_body))
    p.D(hl(cx - 45.5, cx + 45.5, 124.5))
    for k in range(-21, 22):
        p.D(vl(cx + k * 2.1, 126, top_body))
    # attic and crown sized so overall height = phi x body width (dome top at 90.1)
    p.O(R(cx - 38, 108.5, cx + 38, 122))
    p.D(hl(cx - 38, cx + 38, 110.5))
    for y in (113.5, 116.3, 119.1):
        p.D(squiggle(cx - 30, cx + 30, y, .4, 1.5))
    p.O(R(cx - 27, 101.5, cx + 27, 108.5), R(cx - 19, 96.5, cx + 19, 101.5))
    p.O(f"M{f(cx - 15)},96.5C{f(cx - 12)},88 {f(cx + 12)},88 {f(cx + 15)},96.5")
    p.D(hl(cx - 16.5, cx + 16.5, 96.5))
    return p

# ---------------------------------------------------------------- 3. Red Fort (Lahori Gate)
def red_fort(cx=500, wall=90):
    p = Piece()
    for x0, x1, outer in ((440 - wall, 440, 440 - wall), (560, 560 + wall, 560 + wall)):
        s = -1 if outer == x0 else 1
        p.O(L((outer, G), (outer - s * 3, 178)))
        k, slits = kanguras(x0 + (3 if s < 0 else 0), x1 - (3 if s > 0 else 0), 178)
        p.O(k); p.D(*slits)
        p.D(hl(x0 + (1 if s < 0 else 0), x1 - (1 if s > 0 else 0), 182.5))
        p.D(hl(x0 + (2 if s < 0 else 0), x1 - (2 if s > 0 else 0), 211), hl(x0 + (2.4 if s < 0 else 0), x1 - (2.4 if s > 0 else 0), 213))
    for t0 in (440, 534):
        t1 = t0 + 26
        f0, f1 = t0 + 6, t1 - 6
        p.O(vl(t0, G, 140), vl(t1, G, 140))
        p.D(vl(f0, G, 140), vl(f1, G, 140))
        for y in (204, 180, 156):
            p.O(hl(t0 - 1, t1 + 1, y)); p.D(hl(t0 - .5, t1 + .5, y + 2.2))
        for yb, ytop in ((G - 2, 206.5), (202, 182.5), (178, 158.5), (154, 141)):
            hh = yb - ytop
            p.D(R(f0 + 2, ytop + 1.5, f1 - 2, yb - 1))
            p.D(parch(f0 + 3.6, f1 - 3.6, yb - 1, ytop + hh * .5, ytop + 3.2))
            p.D(parch(t0 + 1.5, f0 - 1.5, yb - 1, ytop + hh * .5, ytop + 3.5))
            p.D(parch(f1 + 1.5, t1 - 1.5, yb - 1, ytop + hh * .5, ytop + 3.5))
        k, _ = kanguras(t0, t1, 140, 3, 3.6, 1.1, False)
        p.O(hl(t0 - 1, t1 + 1, 140), k)
        p.add(chhatri((t0 + t1) / 2, 136.4, 8.6, 13, 13, 6))
    p.O(vl(466, 149, G), vl(534, 149, G))
    p.O(R(464, 146, 536, 149))
    p.O(hl(466, 534, 162)); p.D(hl(466, 534, 164.5))
    n, x0, x1 = 9, 468.5, 531.5
    cw = (x1 - x0) / n
    for k in range(n):
        a = x0 + k * cw
        p.D(parch(a + .9, a + cw - .9, 161, 154, 151))
    p.O(R(475, 168, 525, G))
    p.O(parch(480, 520, G, 196, 171))
    p.D(parch(483.5, 516.5, G, 197, 176))
    p.O(parch(490, 510, G, 213, 204))
    p.D(vl(cx, 207, G))
    for y in (213, 217, 221):
        p.D(hl(490.6, 509.4, y))
    p.D(circ(480.5, 174.5, 2.4), circ(519.5, 174.5, 2.4))
    for a in (467.5, 527.5):
        p.D(parch(a, a + 5, G - 3, 210, 204), parch(a, a + 5, 196, 182, 176))
    for x in (466, 534):
        p.O(L((x - 1.3, 146), (x - 1.3, 131)) + f"H{f(x + 1.3)}V146")
        p.O(f"M{f(x - 1.9)},131C{f(x - 2.4)},128 {f(x - .6)},126.5 {f(x)},124.5C{f(x + .6)},126.5 {f(x + 2.4)},128 {f(x + 1.9)},131")
        p.D(vl(x, 124.5, 121.5), hl(x - 1.3, x + 1.3, 138.5))
    for k in range(7):
        x = 474 + k * (52 / 6)
        p.add(chhatri(x, 146, 2.9, 4.4, 5, 2.6, arches=False))
    p.O(vl(cx, 134.7, 101.5))
    p.add(flag(cx, 102, 17, 10.5))
    return p

# ---------------------------------------------------------------- 4. Raisina Hill: North & South Blocks
def secretariat(cx):
    """North/South Block: long two-storey block, corner chhatris, tall central tower with colonnaded drum and dome."""
    p = Piece()
    g, hw = GH, 31
    p.O(R(cx - hw - 2, g - 5, cx + hw + 2, g))
    p.O(vl(cx - hw, g - 5, 172), vl(cx + hw, g - 5, 172))
    p.D(hl(cx - hw, cx + hw, g - 8))
    p.O(hl(cx - hw, cx - 10, 189.5), hl(cx + 10, cx + hw, 189.5))
    p.D(hl(cx - hw, cx - 10, 191.3), hl(cx + 10, cx + hw, 191.3))
    for s in (-1, 1):
        for k in range(4):
            x = cx + s * (13.2 + k * 4.9) - 1.5
            p.D(parch(x, x + 3, g - 9, 197.5, 194.2))
            p.D(R(x, 177.5, x + 3, 186.5))
    # recessed central loggia
    p.O(vl(cx - 10, g - 5, 172), vl(cx + 10, g - 5, 172))
    for k in range(4):
        x = cx - 6.9 + k * 4.6
        p.D(vl(x - .7, g - 6, 178.5), vl(x + .7, g - 6, 178.5))
        p.D(f"M{f(x - .7)},178.5Q{f(x - .7)},177.2 {f(x - 1.6)},176.7H{f(x + 1.6)}Q{f(x + .7)},177.2 {f(x + .7)},178.5")
    p.D(hl(cx - 10, cx + 10, 176.7))
    # chhajja, jaali parapet, corner chhatris
    p.O(L((cx - hw - 4.5, 174.2), (cx - hw - 2, 172), (cx + hw + 2, 172), (cx + hw + 4.5, 174.2)))
    p.O(R(cx - hw, 167, cx + hw, 172))
    x = cx - hw + 1.6
    while x < cx + hw - 1:
        p.D(vl(x, 167.8, 171.2)); x += 1.9
    for s in (-1, 1):
        p.add(chhatri(cx + s * (hw - 5), 167, 3.6, 6.5, 6, 3))
    # tall central tower
    p.O(vl(cx - 10, 167, 143), vl(cx + 10, 167, 143))
    p.D(parch(cx - 7, cx - 1, 165.5, 155, 150), parch(cx + 1, cx + 7, 165.5, 155, 150))
    p.D(hl(cx - 10, cx + 10, 146.5))
    p.O(L((cx - 13, 145.3), (cx - 10.6, 143), (cx + 10.6, 143), (cx + 13, 145.3)))
    # colonnaded drum
    p.O(hl(cx - 9.5, cx + 9.5, 141), hl(cx - 9.5, cx + 9.5, 130.5))
    for k in range(6):
        x = cx - 8 + k * 3.2
        p.D(vl(x - .45, 140.5, 132), vl(x + .45, 140.5, 132))
    p.O(vl(cx - 9.5, 143, 130.5), vl(cx + 9.5, 143, 130.5))
    p.O(L((cx - 10.8, 131.6), (cx - 10, 129.8), (cx + 10, 129.8), (cx + 10.8, 131.6)))
    p.O(arc(cx, 129.8, 9, 180, 0))
    p.add(chhatri(cx, 120.8, 2, 4, 3.4, 2.6, arches=False))
    return p

# ---------------------------------------------------------------- 5. Rashtrapati Bhavan
def rashtrapati(cx=840):
    p = Piece()
    g = GH
    p.O(R(cx - 74, g - 6, cx + 74, g))
    p.O(R(cx - 72, 200, cx + 72, g - 6))
    p.D(hl(cx - 72, cx + 72, 202.5))
    p.O(L((cx - 34, 200), (cx - 40, g - 6)), L((cx + 34, 200), (cx + 40, g - 6)))
    for y in (201.5, 203, 204.5):
        t = (y - 200) / 6
        p.D(hl(cx - 34 - 6 * t, cx + 34 + 6 * t, y))
    for s in (-1, 1):
        xo, xi = cx + s * 72, cx + s * 36
        p.O(vl(xo, 200, 168.5), vl(xi, 200, 168.5))
        a, b = sorted((xo, xi))
        p.O(hl(a, b, 184)); p.D(hl(a, b, 186))
        for k in range(5):
            x = a + 3.3 + k * 6.3
            p.D(parch(x, x + 3.4, 198, 191, 187.8))
            p.D(R(x + .2, 172.5, x + 3.2, 181))
    for k in range(12):
        x = cx - 33 + k * 6
        p.D(R(x - 1.7, 197.5, x + 1.7, 200))
        p.O(vl(x - 1.1, 197.5, 172), vl(x + 1.1, 197.5, 172))
        p.D(f"M{f(x - 1.1)},172Q{f(x - 1.1)},170.6 {f(x - 2.2)},170.1H{f(x + 2.2)}Q{f(x + 1.1)},170.6 {f(x + 1.1)},172")
        p.D(vl(x - 1.8, 170.1, 171.4), vl(x + 1.8, 170.1, 171.4))
    p.O(R(cx - 72, 164.5, cx + 72, 168.5))
    p.D(hl(cx - 72, cx + 72, 166.5))
    p.O(L((cx - 77, 166.2), (cx - 74, 162.5), (cx + 74, 162.5), (cx + 77, 166.2)))
    p.O(R(cx - 72, 156.5, cx + 72, 162.5))
    x = cx - 34
    while x <= cx + 34.1:
        p.D(vl(x, 157.3, 161.7)); x += 2
    for xs in (cx - 66, cx - 41, cx + 41, cx + 66):
        p.add(chhatri(xs, 156.5, 4.4, 7.5, 7, 3.4))
    p.O(R(cx - 30, 146, cx + 30, 156.5))
    p.D(R(cx - 26, 148.5, cx - 4, 154), R(cx + 4, 148.5, cx + 26, 154))
    p.O(R(cx - 28, 141, cx + 28, 146))
    p.O(vl(cx - 25, 141, 128), vl(cx + 25, 141, 128))
    for y in (131, 134.5, 138):
        p.D(hl(cx - 25, cx + 25, y))
    x = cx - 23.5
    while x < cx + 24:
        p.D(vl(x, 130, 139)); x += 2.5
    p.O(R(cx - 27.5, 126, cx + 27.5, 128))
    p.O(arc(cx, 126, 26.5, 180, 0))
    p.D(arc(cx, 126, 24.8, 172, 8))
    p.O(R(cx - 3.2, 96, cx + 3.2, 99.5))
    p.D(hl(cx - 3.2, cx + 3.2, 97.6))
    p.O(hl(cx - 5, cx + 5, 94.5), vl(cx, 96, 80))
    p.add(flag(cx, 80.5, 16, 10))
    return p

# ---------------------------------------------------------------- golden-ratio layout
# Local heights (ground to topmost point) and half-widths of each drawing.
H_QUTUB, H_IG, H_RF, H_RB, H_SB = 191, 135.9, 124.9, 132, 102.4
HW_QUTUB, HW_IG, HW_RFCORE, HW_RB, HW_SB = 22, 52, 60, 77, 35.5
LOGO_LAYOUT, GAP_V = 72, 7          # seal height the golden skyline is solved for, and gaps around the rule
LOGO = 96                           # displayed seal height (enlarged; skyline keeps its layout)
RULE_W = LOGO / PHI

# Heights: Rashtrapati must leave room above it for logo + rule; everything else follows phi.
h_rb = (LOGO_LAYOUT + 2 + 2 * GAP_V) * PHI          # Rashtrapati = (space above it) x phi
stack = h_rb * PHI                           # logo top to ground = phi x Rashtrapati
s_rb = h_rb / H_RB
s_sb = (h_rb / PHI) / H_SB                   # Rashtrapati = phi x North/South Block
s_q = 1.0
s_ig = (H_QUTUB / PHI) / H_IG                # Qutub = phi x India Gate
s_rf = (H_QUTUB / PHI) / H_RF                # Qutub = phi x Red Fort

MV, MH = 8, 6                                # outer margins
W = (stack + 2 * MV) * PHI ** 2              # canvas width from the golden solve (W : H = phi^2 at the layout seal size)
stack += LOGO - LOGO_LAYOUT                  # the larger seal adds height above the skyline only
H = stack + 2 * MV
CX = W / 2
GROUND = H - MV
LOGO_TOP = GROUND - stack

# Horizontal: Rashtrapati on the centre axis under the mark. Left half holds Qutub,
# India Gate and South Block; right half holds North Block and Red Fort.
# Outer gap g between landmarks, inner Raisina gap g / phi^2; Red Fort walls fill the balance.
w_q, w_ig, w_sb, hw_rb = 2 * HW_QUTUB * s_q, 2 * HW_IG * s_ig, 2 * HW_SB * s_sb, HW_RB * s_rb
left_fixed = MH + w_q + w_ig + w_sb + hw_rb
g = (W / 2 - left_fixed) / (2 + 1 / PHI ** 2)
gi = g / PHI ** 2
wall = (W / 2 - hw_rb - gi - w_sb - g - 2 * HW_RFCORE * s_rf - MH) / 2 / s_rf
assert g > 8 and wall > 10, (g, wall)

x = MH
x_q = x + w_q / 2;          x += w_q + g
x_ig = x + w_ig / 2;        x += w_ig + g
x_sb = x + w_sb / 2;        x += w_sb + gi
x_rb = CX
x_nb = CX + hw_rb + gi + w_sb / 2
x_rf = x_nb + w_sb / 2 + g + (HW_RFCORE + wall) * s_rf
assert abs(x_rf + (HW_RFCORE + wall) * s_rf + MH - W) < .01

def place(piece, lx, lg, s, X):
    """Map a locally drawn piece so (lx, lg) lands on (X, GROUND) at scale s."""
    return (piece, f"translate({f(X - s * lx)} {f(GROUND - s * lg)}) scale({f(s)})", s)

pieces = [
    ("Qutub Minar",        [place(qutub(), 78, G, s_q, x_q)]),
    ("India Gate",         [place(india_gate(), 228, G, s_ig, x_ig)]),
    ("Red Fort",           [place(red_fort(wall=wall), 500, G, s_rf, x_rf)]),
    ("Raisina Hill",       [place(secretariat(719), 719, GH, s_sb, x_sb), place(secretariat(961), 961, GH, s_sb, x_nb)]),
    ("Rashtrapati Bhavan", [place(rashtrapati(), 840, GH, s_rb, x_rb)]),
]
ground = f"M{f(MH)},{f(GROUND)}H{f(W - MH)}"

print(f"canvas {f(W)} x {f(H)}  gaps outer {f(g)} inner {f(gi)}  red fort wall {f(wall)}")
print(f"heights  qutub {f(H_QUTUB*s_q)}  india gate {f(H_IG*s_ig)}  red fort {f(H_RF*s_rf)}  rashtrapati {f(h_rb)}  blocks {f(H_SB*s_sb)}  stack {f(stack)}")

# ---------------------------------------------------------------- timing
T = 8000
STAGGER, WIN = 250, 1800
MARK0, MARK1 = 2400, 3800
RULE0, RULE1 = 3800, 4600
FADE0 = 7500
EASE_MARK = "cubic-bezier(0.16, 1, 0.3, 1)"
EASE_PEN = "cubic-bezier(0.55, 0, 0.25, 1)"
DRAW_END = STAGGER * (len(pieces) - 1) + WIN
pct = lambda ms: (f"{ms / T * 100:.3f}".rstrip("0").rstrip(".")) + "%"

def split_subpaths(d):
    return [s for s in re.split(r"(?=M)", d) if s.strip()]

def emit(cls, ds):
    return "\n".join(f'        <path class="{cls}" pathLength="1" d="{s}"/>' for d in ds for s in split_subpaths(d))

groups = []
for i, (name, placements) in enumerate(pieces, 1):
    parts = []
    for pc, tf, sc in placements:
        parts.append(f'      <g transform="{tf}" style="--s: {f(sc)}">\n{emit("o", pc.o)}\n{emit("d", pc.d)}\n      </g>')
    groups.append(f'    <g class="b b{i}" data-name="{name}">\n' + "\n".join(parts) + "\n    </g>")

def draw_kf(name, t0, t1):
    # Dashing exists only while a stroke is drawing; once drawn it switches off so
    # tiny closed shapes never show a sliver (Chrome's pathLength rounding).
    head = "0%" if t0 == 0 else f"0%, {pct(t0)}"
    return (f"    @keyframes {name} {{\n"
            f"      {head} {{ stroke-dasharray: 1.05 1.05; stroke-dashoffset: 1.05; animation-timing-function: {EASE_PEN}; }}\n"
            f"      {pct(t1)} {{ stroke-dasharray: 1.05 1.05; stroke-dashoffset: 0; animation-timing-function: step-end; }}\n"
            f"      {pct(t1 + 1)}, 100% {{ stroke-dasharray: none; stroke-dashoffset: 0; }}\n    }}")

kfs, rules = [draw_kf("ccd-ground", 0, DRAW_END)], []
for i in range(1, len(pieces) + 1):
    s = STAGGER * (i - 1)
    kfs.append(draw_kf(f"ccd-o{i}", s, s + WIN * .7))
    kfs.append(draw_kf(f"ccd-d{i}", s + WIN * .3, s + WIN))
    rules.append(f"    .ccd-loader .b{i} .o {{ animation-name: ccd-o{i}; }}\n    .ccd-loader .b{i} .d {{ animation-name: ccd-d{i}; }}")

style = f"""
    /* Loop {T}ms: ground + landmarks draw on 0–{DRAW_END}ms (stagger {STAGGER}ms, structure then detail),
       mark {MARK0}–{MARK1}ms, carnelian rule {RULE0}–{RULE1}ms, hold, fade {FADE0}–{T}ms, loop. */
    .ccd-loader .st0 {{ fill: #231F20; }}
    .ccd-loader .skyline {{ fill: none; stroke: currentColor; stroke-linejoin: round; stroke-linecap: butt; }}
    .ccd-loader .skyline {{ --o: 1.15px; --d: .6px; }}
    .ccd-loader .ground {{ stroke-width: var(--o); }}
    .ccd-loader .o {{ stroke-width: calc(var(--o) / var(--s, 1)); }}
    .ccd-loader .d {{ stroke-width: calc(var(--d) / var(--s, 1)); }}
    .ccd-loader .skyline path {{ animation: none {T}ms linear infinite both; }}
    .ccd-loader .skyline .ground {{ animation-name: ccd-ground; }}
{chr(10).join(rules)}
    .ccd-loader .scene {{ animation: ccd-scene {T}ms linear infinite both; }}
    .ccd-loader .mark, .ccd-loader .rule {{ transform-box: view-box; }}
    .ccd-loader .mark {{ transform-origin: {f(CX)}px {f(LOGO_TOP + LOGO / 2)}px; animation: ccd-mark {T}ms linear infinite both; }}
    .ccd-loader .rule {{ transform-origin: {f(CX)}px {f(LOGO_TOP + LOGO + GAP_V + 1)}px; animation: ccd-rule {T}ms linear infinite both; }}

{chr(10).join(kfs)}
    @keyframes ccd-mark {{
      0%, {pct(MARK0)} {{ opacity: 0; transform: scale(0.92); animation-timing-function: {EASE_MARK}; }}
      {pct(MARK1)}, 100% {{ opacity: 1; transform: scale(1); }}
    }}
    @keyframes ccd-rule {{
      0%, {pct(RULE0)} {{ transform: scaleX(0); animation-timing-function: {EASE_MARK}; }}
      {pct(RULE1)}, 100% {{ transform: scaleX(1); }}
    }}
    @keyframes ccd-scene {{
      0%, {pct(FADE0)} {{ opacity: 1; }}
      100% {{ opacity: 0; }}
    }}

    /* Keep lines legible when the graphic is drawn small. */
    @media (max-width: 480px) {{
      .ccd-loader .skyline {{ --o: 1.7px; --d: .95px; }}
    }}

    @media (prefers-reduced-motion: reduce) {{
      .ccd-loader .skyline path, .ccd-loader .mark, .ccd-loader .rule, .ccd-loader .scene {{ animation: none; }}
    }}
"""

svg_body = f"""<svg class="ccd-loader" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(W)} {f(H)}" width="{f(W)}" height="{f(H)}" color="#222222">
  <style>{style}  </style>
  <g class="scene">
  <g class="skyline">
    <path class="ground" pathLength="1" d="{ground}"/>
{chr(10).join(groups)}
  </g>
  <g class="mark">
    <svg x="{f(CX - LOGO / 2)}" y="{f(LOGO_TOP)}" width="{f(LOGO)}" height="{f(LOGO)}" viewBox="0 0 262.7 262.7">
{inner}
    </svg>
  </g>
  <rect class="rule" x="{f(CX - RULE_W / 2)}" y="{f(LOGO_TOP + LOGO + GAP_V)}" width="{f(RULE_W)}" height="2" fill="#B31B1B"/>
  </g>
</svg>
"""

with open(os.path.join(site, "assets", "ccd-skyline-loader.svg"), "w", encoding="utf-8") as fh:
    fh.write('<?xml version="1.0" encoding="utf-8"?>\n' + svg_body)

# Page-transition variant: same drawing and keyframes, whole loop compressed so the
# skyline, seal and rule complete in ~1.5s (keyframe percentages scale with duration).
T_TRANSITION = 2600
with open(os.path.join(site, "assets", "ccd-skyline-transition.svg"), "w", encoding="utf-8") as fh:
    fh.write('<?xml version="1.0" encoding="utf-8"?>\n' + svg_body.replace(f"{T}ms", f"{T_TRANSITION}ms"))

inline = svg_body.replace('<svg class="ccd-loader"', '<svg class="ccd-loader" aria-hidden="true" focusable="false"', 1)
html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Loading State</title>
  <link rel="icon" type="image/svg+xml" href="assets/cornell_seal_simple_web_b31b1b.svg">
  <style>
    :root {{ --dark-gray: #222222; --white: #FFFFFF; }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: var(--white); color: var(--dark-gray);
      font-family: "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;
      padding: 16px;
    }}
    .loading {{ display: flex; flex-direction: column; align-items: center; gap: 16px; width: 100%; max-width: {f(W)}px; }}
    .loading svg {{ width: 100%; height: auto; display: block; }}
    .loading-label {{ font-size: .85rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }}
  </style>
</head>
<body>
  <div class="loading" role="status" aria-live="polite">
    {inline.strip()}
    <span class="loading-label">Loading</span>
  </div>
</body>
</html>
"""
with open(os.path.join(site, "loading-state.html"), "w", encoding="utf-8") as fh:
    fh.write(html)
print(f"ok: {len(svg_body)} bytes, {svg_body.count('pathLength')} stroked paths")
