"""
generate_overview_pdf.py — Kanvaz 2-page overview/quick-start handout
Dark theme matching app: bg #0E0E10, surface #1A1A22, accent #4A9EFF,
text #DCDCE8, muted #6A6A8A, amber #F0A500, green for "free/private" notes.

Regenerate with:  python docs/generate_overview_pdf.py   (needs reportlab)

Every claim on these two pages was checked against the code or the shipped
build on 2026-10-05 (zoom limits, undo depth, annotation tools, shortcuts,
resize modifier, network calls, template count, installers). The version
pill is read from package.json, and the logo is the real app icon, so neither
can go stale silently. If you change a claim here, re-verify it first.
"""

import json
import os

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VERSION = json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf-8'))['version']
ICON = os.path.join(ROOT, 'assets', 'icons', 'icon-256.png')

# ── Colors ──
BG       = HexColor('#0E0E10')
CHROME   = HexColor('#131318')
SURFACE  = HexColor('#1A1A22')
SURFACE2 = HexColor('#22222C')
BORDER   = HexColor('#2E2E3A')
ACCENT   = HexColor('#4A9EFF')
AMBER    = HexColor('#F0A500')
GREEN    = HexColor('#4CAF82')
TEXT     = HexColor('#DCDCE8')
TEXT2    = HexColor('#A0A0B8')
TEXT3    = HexColor('#6A6A8A')

W, H = letter

def draw_bg(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)

def draw_logo(c, x, y, size=28):
    """The real Kanvaz app icon (K in a gradient ring), clipped to its circle.
    The PNG has opaque black corners, so the circular clip is required."""
    c.saveState()
    p = c.beginPath()
    p.circle(x + size / 2.0, y + size / 2.0, size / 2.0)
    c.clipPath(p, stroke=0, fill=0)
    c.drawImage(ICON, x, y, width=size, height=size, mask=None)
    c.restoreState()

def wrap_text(c, text, font, size, max_width):
    """Simple word-wrap returning list of lines."""
    words = text.split(' ')
    lines = []
    cur = ''
    for word in words:
        test = (cur + ' ' + word).strip()
        if stringWidth(test, font, size) <= max_width:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines

def draw_paragraph(c, text, x, y, max_width, font='Helvetica', size=10,
                    color=TEXT2, leading=14):
    c.setFont(font, size)
    c.setFillColor(color)
    lines = wrap_text(c, text, font, size, max_width)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y

def draw_section_label(c, text, x, y):
    c.setFont('Helvetica-Bold', 9)
    c.setFillColor(ACCENT)
    c.drawString(x, y, text.upper())
    return y - 16

def draw_feature_row(c, x, y, dot_color, title, desc, max_width):
    c.setFillColor(dot_color)
    c.circle(x + 3, y + 3, 3, fill=1, stroke=0)
    c.setFont('Helvetica-Bold', 11)
    c.setFillColor(TEXT)
    c.drawString(x + 14, y + 7, title)
    c.setFont('Helvetica', 9.5)
    c.setFillColor(TEXT3)
    y2 = y - 6
    lines = wrap_text(c, desc, 'Helvetica', 9.5, max_width - 14)
    for line in lines:
        c.drawString(x + 14, y2, line)
        y2 -= 12
    return y2 - 8

def draw_step(c, x, y, num, title, desc, max_width):
    # number badge
    c.setFillColor(SURFACE2)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.75)
    c.roundRect(x, y - 6, 22, 22, 4, fill=1, stroke=1)
    c.setFont('Helvetica-Bold', 11)
    c.setFillColor(ACCENT)
    c.drawCentredString(x + 11, y + 1, str(num))

    c.setFont('Helvetica-Bold', 11)
    c.setFillColor(TEXT)
    c.drawString(x + 32, y + 7, title)

    c.setFont('Helvetica', 9.5)
    c.setFillColor(TEXT3)
    y2 = y - 6
    lines = wrap_text(c, desc, 'Helvetica', 9.5, max_width - 32)
    for line in lines:
        c.drawString(x + 32, y2, line)
        y2 -= 12
    return y2 - 10

def draw_shortcut_row(c, x, y, key, desc, key_w=90):
    c.setFillColor(SURFACE2)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.75)
    c.roundRect(x, y - 3, key_w, 16, 3, fill=1, stroke=1)
    c.setFont('Courier-Bold', 9)
    c.setFillColor(TEXT2)
    c.drawCentredString(x + key_w/2, y + 1.5, key)

    c.setFont('Helvetica', 10)
    c.setFillColor(TEXT2)
    c.drawString(x + key_w + 14, y + 1.5, desc)

# ════════════════════════════════════════════════════════════
# PAGE 1 — What is Kanvaz
# ════════════════════════════════════════════════════════════

# pageCompression=0 keeps the page text readable in the raw file so test/doc-assets-test.js can
# check that the version pill matches package.json (the PDF is regenerated on every release).
c = canvas.Canvas(os.path.join(HERE, 'Kanvaz_Overview.pdf'), pagesize=letter, pageCompression=0)
c.setTitle('Kanvaz overview and quick start')
c.setAuthor('Atharva Patil | P4inz | P4inz Interactive Labs')
draw_bg(c)

margin = 0.75 * inch
content_w = W - 2 * margin

# Header
draw_logo(c, margin, H - margin - 30, size=36)
c.setFont('Helvetica-Bold', 26)
c.setFillColor(TEXT)
c.drawString(margin + 48, H - margin - 14, 'Kanvaz')
c.setFont('Helvetica', 11)
c.setFillColor(TEXT3)
c.drawString(margin + 48, H - margin - 30, 'The Reference Operating System.')

# Version pill (read from package.json)
c.setFillColor(SURFACE2)
c.setStrokeColor(GREEN)
c.setLineWidth(0.75)
pill_w = 150
c.roundRect(W - margin - pill_w, H - margin - 28, pill_w, 20, 10, fill=1, stroke=1)
c.setFont('Helvetica-Bold', 8.5)
c.setFillColor(GREEN)
c.drawCentredString(W - margin - pill_w/2, H - margin - 21, 'v' + VERSION)

y = H - margin - 70

# Divider
c.setStrokeColor(BORDER)
c.setLineWidth(0.75)
c.line(margin, y, W - margin, y)
y -= 30

# What is it
y = draw_section_label(c, 'What is this?', margin, y)
y = draw_paragraph(
    c,
    'Kanvaz is a free, offline infinite canvas for VFX, 3D and game artists. Drop in images, '
    'GIFs, video, audio, 3D models and PDFs, arrange them freely, draw directly on top, link '
    'related references together, and keep everything in one portable .kanvaz file. '
    'Built for breakdowns, mood boards, shot references, and anything you\'d normally pin to a wall.',
    margin, y, content_w, size=10.5, color=TEXT2, leading=15
)
y -= 14

# Made by
y = draw_section_label(c, 'Who made this', margin, y)
y = draw_paragraph(
    c,
    'Made by Atharva Patil | P4inz | P4inz Interactive Labs, Navi Mumbai, India. '
    'Kanvaz started as a personal tool for organizing VFX references and is now '
    'free, open-source (MIT) software, kept small and developed on real feedback.',
    margin, y, content_w, size=10.5, color=TEXT2, leading=15
)
y -= 22

# Key features
y = draw_section_label(c, 'Key features', margin, y)
y -= 4
features = [
    (ACCENT, 'Infinite canvas', 'Pan and zoom freely, 8% to 500%. Arrange hundreds of references with no fixed boundaries.'),
    (GREEN,  'Drop in anything', 'Images, GIFs, video, audio, 3D models, PDFs, and Adobe or HDR files land right on the canvas. Drag them in from your file explorer or paste an image with Ctrl+V.'),
    (AMBER,  'Live 3D preview', 'Orbit .glb, .gltf, .obj, .fbx and more right on the board, with 13 render modes such as wireframe and matcap, plus animation playback.'),
    (ACCENT, 'Annotate anything', 'Draw on any card with pen, highlighter, line, arrow, rectangle, ellipse, text, a pixel-measure tool and a color eyedropper.'),
    (GREEN,  'Connections & Map View', 'Link references with 7 kinds of typed relationship, then press M to see the whole web as a node graph.'),
    (AMBER,  'One portable file', 'Everything (boards, positions, annotations, zoom) saves to a single .kanvaz file and restores exactly. Multiple boards per file.'),
    (ACCENT, 'Themes & Top Mode', 'Press L to switch between dark and light. Ctrl+Shift+T keeps Kanvaz on top; Ctrl+Shift+L (MoodLock) isolates the selection and hides every toolbar, leaving just the reference.'),
]
for color, title, desc in features:
    y = draw_feature_row(c, margin, y, color, title, desc, content_w)

y -= 6

# Privacy & offline
y = draw_section_label(c, 'Privacy & offline', margin, y)
y = draw_paragraph(
    c,
    'Kanvaz runs entirely on your machine. No accounts, no telemetry, no analytics, and no '
    'internet connection required. Your boards and media never leave your computer unless you '
    'share the file yourself. The only network requests are ones you start with a click: '
    'Check for updates, Browse Official Plugins, Browse community templates, and a URL '
    'card\'s Fetch preview.',
    margin, y, content_w, size=10.5, color=TEXT2, leading=15
)

# Footer note
c.setFillColor(SURFACE)
c.setStrokeColor(BORDER)
c.setLineWidth(0.75)
c.roundRect(margin, margin - 6, content_w, 58, 8, fill=1, stroke=1)
c.setFont('Helvetica-Bold', 9.5)
c.setFillColor(GREEN)
c.drawString(margin + 14, margin + 36, 'Free & open source. Yours to keep.')
c.setFont('Helvetica', 9)
c.setFillColor(TEXT3)
c.drawString(margin + 14, margin + 22,
              'Found a bug or have an idea? Open an issue on GitHub, or tell Atharva directly.')
c.drawString(margin + 14, margin + 10,
              'It is a one-person project, so a quick message is the fastest way to get something fixed.')
c.setFillColor(ACCENT)
c.drawString(margin + 14, margin - 2,
              'Get the latest version: github.com/p4inz-code/kanvaz/releases/latest')

# Page number
c.setFont('Helvetica', 8)
c.setFillColor(TEXT3)
c.drawCentredString(W/2, 0.4 * inch, '1 / 2')

c.showPage()

# ════════════════════════════════════════════════════════════
# PAGE 2 — Quick Start
# ════════════════════════════════════════════════════════════

draw_bg(c)

# Header (smaller, repeated)
draw_logo(c, margin, H - margin - 24, size=28)
c.setFont('Helvetica-Bold', 18)
c.setFillColor(TEXT)
c.drawString(margin + 40, H - margin - 12, 'Kanvaz')
c.setFont('Helvetica', 10)
c.setFillColor(TEXT3)
c.drawString(margin + 40, H - margin - 26, 'Quick Start Guide')

c.setStrokeColor(BORDER)
c.setLineWidth(0.75)
c.line(margin, H - margin - 42, W - margin, H - margin - 42)

y = H - margin - 70

# Getting started steps
y = draw_section_label(c, 'Getting started', margin, y)
y -= 4

steps = [
    ('Install and open', 'Download the installer for your OS from the latest GitHub release. No account needed. Kanvaz is unsigned, so Windows may say "Windows protected your PC" (More info, then Run anyway); on macOS right-click the app and choose Open the first time.'),
    ('Start a board', 'On the Home Screen choose New Board, Open from computer, or one of 14 starter templates (Filmmaking, Game Art, Mood Board, VFX, and more).'),
    ('Add your media', 'Drag files from your file explorer onto the canvas, paste an image with Ctrl+V, or right-click and choose Add for a note, color swatch or URL.'),
    ('Move, resize & annotate', 'Drag a card to move it and drag its handles to resize (hold Shift to lock proportions). Select a card and press A, or right-click and choose Annotate, to draw on it.'),
    ('Boards & saving', 'The Boards section in the left rail creates, switches and renames boards; each keeps its own cards and view. Ctrl+S saves a .kanvaz file and Ctrl+Shift+S saves a copy. Autosave every 30 seconds is only a crash-recovery safety net, so save with Ctrl+S.'),
]
for i, (title, desc) in enumerate(steps, 1):
    y = draw_step(c, margin, y, i, title, desc, content_w)

y -= 6

# Shortcuts
y = draw_section_label(c, 'Top 5 shortcuts', margin, y)
y -= 6

shortcuts = [
    ('Space + Drag', 'Pan around the canvas'),
    ('Scroll', 'Zoom in / out'),
    ('Ctrl + S', 'Save the current board'),
    ('Ctrl + K', 'Command Palette'),
    ('Ctrl + Z', 'Undo (up to 50 steps)'),
]
col_split = content_w / 2 + 10
for i, (key, desc) in enumerate(shortcuts):
    col = i % 2
    row = i // 2
    sx = margin + col * col_split
    sy = y - row * 26
    draw_shortcut_row(c, sx, sy, key, desc)

y = y - ((len(shortcuts) + 1) // 2) * 26 - 12
c.setFont('Helvetica', 9)
c.setFillColor(TEXT3)
c.drawString(margin, y, 'Press ? anywhere in Kanvaz for the full, searchable shortcut list.')
y -= 28

# Pro tips
y = draw_section_label(c, 'Pro tips', margin, y)
y -= 2
tips = [
    (ACCENT, 'Pin cards in place', 'Select a card and press P (or right-click, then Pin) to lock its position so it can\'t be moved or nudged by accident.'),
    (GREEN,  'Duplicate with Ctrl+D', 'Quickly clone the selected card. Handy for creating variations or side-by-side comparisons.'),
    (AMBER,  'Toggle annotations with H', 'Select an annotated card and press H to hide or show your marks without deleting them.'),
]
for color, title, desc in tips:
    y = draw_feature_row(c, margin, y, color, title, desc, content_w)

# Feedback box
c.setFillColor(SURFACE)
c.setStrokeColor(ACCENT)
c.setLineWidth(0.75)
c.roundRect(margin, y - 50, content_w, 56, 8, fill=1, stroke=1)
c.setFont('Helvetica-Bold', 10.5)
c.setFillColor(TEXT)
c.drawString(margin + 14, y - 14, 'Found a bug? Have an idea?')
c.setFont('Helvetica', 9.5)
c.setFillColor(TEXT2)
c.drawString(margin + 14, y - 30, 'Open an issue at github.com/p4inz-code/kanvaz or tell Atharva directly.')
c.drawString(margin + 14, y - 42, 'The full user guide lives at p4inz-code.github.io/kanvaz/guide/')

# Page number
c.setFont('Helvetica', 8)
c.setFillColor(TEXT3)
c.drawCentredString(W/2, 0.4 * inch, '2 / 2')

c.showPage()
c.save()

print('PDF generated successfully (v%s)' % VERSION)
