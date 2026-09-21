"""Generates Adobe-format sample files for the card audit (tools/card-audit/media/adobe).
PSD/PSB are written to the published layout (header, colour mode data, image resources,
layer and mask info, merged image data, RLE). They are NOT files from Photoshop itself.
Run: python tools/card-audit/make-adobe-samples.py"""
import os, struct, zipfile, io
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), 'media', 'adobe')
os.makedirs(OUT, exist_ok=True)

def art(w, h, alpha=False):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0 if alpha else 255))
    d = ImageDraw.Draw(im)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=(30 + y * 60 // h, 20, 90 + y * 120 // h, 255))
    d.ellipse([w * .08, h * .15, w * .48, h * .85], fill=(245, 175, 65, 255))
    d.rectangle([w * .52, h * .22, w * .9, h * .7], fill=(90, 205, 165, 255))
    for i in range(0, w, 40):
        d.line([(i, 0), (i, h)], fill=(255, 255, 255, 28))
    d.text((24, 20), 'Kanvaz Adobe preview sample %dx%d' % (w, h), fill=(255, 255, 255, 255))
    d.text((24, h - 30), 'fine detail: 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ', fill=(255, 255, 255, 255))
    return im

def packbits(row):
    out = bytearray(); i = 0; n = len(row)
    while i < n:
        run = 1
        while i + run < n and row[i + run] == row[i] and run < 128: run += 1
        if run >= 3:
            out += bytes([257 - run, row[i]]); i += run
        else:
            start = i; cnt = 0
            while i < n and cnt < 128 and not (i + 2 < n and row[i] == row[i + 1] == row[i + 2]):
                i += 1; cnt += 1
            out += bytes([cnt - 1]) + bytes(row[start:start + cnt])
    return bytes(out)

def psd(im, psb=False, blank=False, layers=2, thumb=True):
    w, h = im.size
    bands = list(im.convert('RGBA').split())
    if blank:
        bands = [Image.new('L', (w, h), 255)] * 3
    planes = bands[:3] + ([bands[3]] if im.mode == 'RGBA' and not blank and bands[3].getextrema()[0] < 255 else [])
    merged_alpha = len(planes) == 4
    b = io.BytesIO()
    b.write(b'8BPS' + struct.pack('>H', 2 if psb else 1) + b'\0' * 6)
    b.write(struct.pack('>HIIHH', len(planes), h, w, 8, 3))
    b.write(struct.pack('>I', 0))
    res = io.BytesIO()
    if thumb:
        t = im.convert('RGB'); t.thumbnail((160, 160))
        tj = io.BytesIO(); t.save(tj, 'JPEG', quality=80)
        tb = tj.getvalue()
        hdr = struct.pack('>IIIIIIHH', 1, t.size[0], t.size[1], t.size[0] * 3, len(tb), len(tb), 24, 1)
        data = hdr + tb
        if len(data) % 2: data += b'\0'
        res.write(b'8BIM' + struct.pack('>H', 1036) + b'\0\0' + struct.pack('>I', len(hdr) + len(tb)) + data)
    rb = res.getvalue()
    b.write(struct.pack('>I', len(rb)) + rb)
    li = struct.pack('>h', -layers if merged_alpha else layers) + b'\0' * 16
    lm = (struct.pack('>Q' if psb else '>I', len(li)) + li)
    b.write(struct.pack('>Q' if psb else '>I', len(lm)) + lm)
    b.write(struct.pack('>H', 1))
    counts = bytearray(); data = bytearray()
    for p in planes:
        raw = p.tobytes()
        for y in range(h):
            c = packbits(raw[y * w:(y + 1) * w])
            counts += struct.pack('>I' if psb else '>H', len(c)); data += c
    b.write(bytes(counts)); b.write(bytes(data))
    return b.getvalue()

def w(name, data):
    p = os.path.join(OUT, name)
    open(p, 'wb').write(data)
    print(name, len(data))

main = art(1600, 1000)
w('sample.psd', psd(main))
w('sample.psb', psd(art(1200, 800), psb=True))
w('nocomposite.psd', psd(main, blank=True, layers=3))
w('transparent.psd', psd(art(800, 600, alpha=True)))

# AI: a PDF-compatible file (Illustrator's default save)
pdf = io.BytesIO(); main.convert('RGB').save(pdf, 'PDF', resolution=150)
w('sample.ai', pdf.getvalue())

# XD: zip with mimetype, preview and renditions
xd = io.BytesIO()
with zipfile.ZipFile(xd, 'w') as z:
    z.writestr(zipfile.ZipInfo('mimetype'), 'application/vnd.adobe.xd')
    for name, size in (('preview.png', (400, 250)), ('thumbnail.png', (160, 100)), ('renditions/image-512-320.png', (512, 320)), ('renditions/image-1920-1200.png', (1920, 1200))):
        bio = io.BytesIO(); art(*size).save(bio, 'PNG'); z.writestr(name, bio.getvalue())
w('sample.xd', xd.getvalue())

w('sample.fresco', b'FRESCO-STUB')
