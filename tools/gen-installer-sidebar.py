"""Regenerates assets/installer-sidebar.bmp (NSIS welcome/finish page art) with the CURRENT brand logo.
NSIS needs a 164x314, 24-bit, uncompressed BMP with no alpha."""
from PIL import Image, ImageDraw, ImageFont
R = 'F:/OBL/Kanvaz/assets/'
old = Image.open(R + 'installer-sidebar.bmp').convert('RGB')
bg = old.getpixel((4, 4)); rule = old.getpixel((80, 281))
print('old size', old.size, 'bg', bg, 'rule', rule)

W, H, S = 164, 314, 4                      # supersample 4x, downscale for clean edges
img = Image.new('RGB', (W * S, H * S), bg)
d = ImageDraw.Draw(img)

logo = Image.open(R + 'icons/icon-1024.png').convert('RGBA')
L = 112 * S
logo = logo.resize((L, L), Image.LANCZOS)
mask = Image.new('L', (L, L), 0)
ImageDraw.Draw(mask).ellipse([0, 0, L - 1, L - 1], fill=255)   # the PNG has opaque black corners
img.paste(logo.convert('RGB'), ((W * S - L) // 2, 38 * S), mask)

def font(name, px):
    return ImageFont.truetype('C:/Windows/Fonts/' + name, px * S)
def center(text, y, f, fill):
    w = d.textlength(text, font=f)
    d.text(((W * S - w) / 2, y * S), text, font=f, fill=fill)

center('Kanvaz', 168, font('segoeuib.ttf', 25), (236, 236, 240))
center('Reference', 205, font('segoeui.ttf', 11), (150, 150, 162))
center('Operating System', 220, font('segoeui.ttf', 11), (150, 150, 162))
d.line([(22 * S, 281 * S), ((W - 22) * S, 281 * S)], fill=rule, width=S)
center('Free & open source', 291, font('segoeui.ttf', 10), (150, 150, 162))

out = img.resize((W, H), Image.LANCZOS)
out.save(R + 'installer-sidebar.bmp', format='BMP')
chk = Image.open(R + 'installer-sidebar.bmp')
print('wrote', chk.size, chk.mode, chk.format)
out.save('C:/Users/Admin/AppData/Local/Temp/claude/F--OBL-Kanvaz/7471974a-3e1b-42f6-a8d5-209112326ee3/scratchpad/sidebar-new.png')
