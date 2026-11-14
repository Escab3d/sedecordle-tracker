"""Build the installable web app (PWA) into webapp/ from the extension's pages + web/.

    python tools/build_webapp.py

Output layout (host the whole webapp/ folder, e.g. on GitHub Pages):
    webapp/index.html, manifest.webmanifest, sw.js, pwa.js, capture.js, icons/
    webapp/lib/*.js          (from extension/lib)
    webapp/pages/*           (from extension/pages, with PWA tags injected)
The extension-only parts (manifest.json, content/, popup/) are not included.
"""
import hashlib
import json
import pathlib
import shutil
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
WEB = ROOT / "web"
OUT = ROOT / "webapp"

HEAD_TAGS = (
    '  <link rel="manifest" href="../manifest.webmanifest">\n'
    '  <meta name="theme-color" content="#2f7d4f">\n'
    '  <link rel="icon" href="../icons/icon-192.png">\n'
    '  <link rel="apple-touch-icon" href="../icons/icon-192.png">\n'
)
BODY_TAGS = '  <script src="../pwa.js"></script>\n'


def png(size, path, pad_ratio=0.12):
    """A 4x4 grid of Wordle-coloured tiles on a dark background."""
    bg = (0x16, 0x16, 0x18)
    colours = [(0x4F, 0x9D, 0x5C), (0xC9, 0xA2, 0x27), (0x8A, 0x8A, 0x8E)]
    pattern = [0, 1, 2, 0, 2, 0, 0, 1, 0, 2, 1, 0, 1, 0, 0, 0]
    pad = int(size * pad_ratio)
    gap = max(2, size // 48)
    cell = (size - 2 * pad - 3 * gap) / 4
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            c = bg
            cx, cy = x - pad, y - pad
            if 0 <= cx < size - 2 * pad and 0 <= cy < size - 2 * pad:
                i, j = int(cx // (cell + gap)), int(cy // (cell + gap))
                if i < 4 and j < 4 and cx - i * (cell + gap) < cell and cy - j * (cell + gap) < cell:
                    c = colours[pattern[j * 4 + i]]
            row += bytes(c)
        rows.append(bytes(row))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = zlib.compress(b"".join(rows), 9)
    data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", raw) + chunk(b"IEND", b""))
    path.write_bytes(data)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "lib").mkdir(parents=True)
    (OUT / "pages").mkdir()
    (OUT / "icons").mkdir()

    for f in sorted((EXT / "lib").glob("*.js")):
        shutil.copy2(f, OUT / "lib" / f.name)
    for f in sorted((EXT / "pages").iterdir()):
        if f.suffix == ".html":
            html = f.read_text(encoding="utf-8")
            assert "</head>" in html and "</body>" in html, f
            html = html.replace("</head>", HEAD_TAGS + "</head>", 1).replace("</body>", BODY_TAGS + "</body>", 1)
            (OUT / "pages" / f.name).write_text(html, encoding="utf-8")
        else:
            shutil.copy2(f, OUT / "pages" / f.name)
    for f in sorted(WEB.iterdir()):
        if f.name != "sw.template.js":
            shutil.copy2(f, OUT / f.name)
    png(192, OUT / "icons" / "icon-192.png")
    png(512, OUT / "icons" / "icon-512.png")
    png(512, OUT / "icons" / "icon-512-maskable.png", pad_ratio=0.22)
    (OUT / ".nojekyll").write_text("", encoding="utf-8")  # GitHub Pages: serve files as-is

    files = sorted(p.relative_to(OUT).as_posix() for p in OUT.rglob("*")
                   if p.is_file() and p.name not in (".nojekyll", "capture.js"))
    digest = hashlib.sha256()
    for rel in files:
        digest.update(rel.encode() + (OUT / rel).read_bytes())
    version = digest.hexdigest()[:12]
    sw = (WEB / "sw.template.js").read_text(encoding="utf-8")
    sw = sw.replace("__VERSION__", version).replace("__FILES__", json.dumps(["./" + f for f in files] + ["./"]))
    (OUT / "sw.js").write_text(sw, encoding="utf-8")
    print(f"built {OUT} ({len(files) + 1} files, version {version})")


if __name__ == "__main__":
    main()
