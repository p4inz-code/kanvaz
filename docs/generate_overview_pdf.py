"""
generate_overview_pdf.py — Kanvaz 2-page overview/quick-start handout
Dark theme matching app: bg #0E0E10, surface #1A1A22, accent #4A9EFF,
text #DCDCE8, muted #6A6A8A, amber #F0A500, green for "free/private" notes.
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

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
    """3 stacked card rectangles + accent dot, matching app icon."""
    s = size / 18.0
    # bottom card
    c.setFillColor(HexColor('#2A2A35'))
    c.roundRect(x + 2*s, y + 0*s, 12*s, 9*s, 2*s, fill=1, stroke=0)
    # middle card
    c.setFillColor(SURFACE)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.roundRect(x + 3*s, y + 2*s, 12*s, 9*s, 2*s, fill=1, stroke=1)
    # top card
    c.setFillColor(TEXT)
    c.roundRect(x + 4*s, y + 4*s, 12*s, 9*s, 2*s, fill=1, stroke=0)
    # accent dot
    c.setFillColor(ACCENT)
    c.circle(x + 14*s, y + 13*s, 2*s, fill=1, stroke=0)

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

import os
c = canvas.Canvas(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'Kanvaz_Overview.pdf'), pagesize=letter)
draw_bg(c)

margin = 0.75 * inch
content_w = W - 2 * margin

# Header
draw_logo(c, margin, H - margin - 26, size=32)
c.setFont('Helvetica-Bold', 26)
c.setFillColor(TEXT)
c.drawString(margin + 46, H - margin - 14, 'Kanvaz')
c.setFont('Helvetica', 11)
c.setFillColor(TEXT3)
c.drawString(margin + 46, H - margin - 30, 'Your canvas. Your references.')

# Status pill
c.setFillColor(SURFACE2)
c.setStrokeColor(GREEN)
c.setLineWidth(0.75)
pill_w = 150
c.roundRect(W - margin - pill_w, H - margin - 28, pill_w, 20, 10, fill=1, stroke=1)
c.setFont('Helvetica-Bold', 8.5)
c.setFillColor(GREEN)
c.drawCentredString(W - margin - pill_w/2, H - margin - 21, 'v3.5.1')

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
    'Kanvaz is an infinite reference board for VFX and 3D artists — think of it as a '
    'digital pinboard where you can drop in images, GIFs, video clips, and audio tracks, arrange them '
    'freely, scribble notes and annotations directly on top, and keep everything '
    'organized across multiple boards. Built for breakdowns, mood boards, shot '
    'references, and anything you\'d normally pin to a wall.',
    margin, y, content_w, size=10.5, color=TEXT2, leading=15
)
y -= 14

# Made by
y = draw_section_label(c, 'Who made this', margin, y)
y = draw_paragraph(
    c,
    'Made by Atharva Patil (Northbyte Studios), a fellow artist and student in Navi Mumbai. '
    'Kanvaz started as a personal tool for organizing VFX references and grew into '
    'something worth sharing with the people Atharva works and studies with — '
    'teachers, classmates, and friends in the same field.',
    margin, y, content_w, size=10.5, color=TEXT2, leading=15
)
y -= 22

# Key features
y = draw_section_label(c, 'Key features', margin, y)
y -= 4
features = [
    (ACCENT, 'Infinite canvas', 'Pan and zoom freely — 8% to 500%. Arrange hundreds of references with no fixed boundaries.'),
    (GREEN,  'Drag, drop & paste', 'Drop images, GIFs, video, and audio files straight from your file explorer, or paste images with Ctrl+V.'),
    (AMBER,  'Annotate anything', 'Draw, circle, and arrow directly on top of any card with pen, arrow, and rectangle tools in 6 colors.'),
    (ACCENT, 'Multiple boards', 'Organize different projects or shot sequences into separate board tabs within one file.'),
    (GREEN,  'Save & reload', 'Everything — positions, annotations, zoom level — saves to a single .kanvaz file and restores exactly.'),
    (AMBER,  'Mood lock', 'Hide all UI chrome with one shortcut for distraction-free presenting or reviewing (Ctrl+Shift+F).'),
]
for color, title, desc in features:
    y = draw_feature_row(c, margin, y, color, title, desc, content_w)

y -= 10

# Privacy & offline
y = draw_section_label(c, 'Privacy & offline', margin, y)
y = draw_paragraph(
    c,
    'Kanvaz runs entirely on your machine. No accounts, no telemetry, no analytics, '
    'and no internet connection required — your boards, images, video, and audio '
    'never leave your computer unless you choose to share the file yourself.',
    margin, y, content_w, size=10.5, color=TEXT2, leading=15
)

# Footer note
c.setFillColor(SURFACE)
c.setStrokeColor(BORDER)
c.setLineWidth(0.75)
c.roundRect(margin, margin - 6, content_w, 58, 8, fill=1, stroke=1)
c.setFont('Helvetica-Bold', 9.5)
c.setFillColor(GREEN)
c.drawString(margin + 14, margin + 36, 'Free & open source — yours to keep')
c.setFont('Helvetica', 9)
c.setFillColor(TEXT3)
c.drawString(margin + 14, margin + 22,
              'Found a bug or have an idea? Feedback is genuinely welcome —')
c.drawString(margin + 14, margin + 10,
              'just tell Atharva directly (Northbyte Studios).')
c.setFillColor(ACCENT)
c.drawString(margin + 14, margin - 2,
              'Get the latest version: github.com/p4inz-code/kanvaz')

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
draw_logo(c, margin, H - margin - 20, size=24)
c.setFont('Helvetica-Bold', 18)
c.setFillColor(TEXT)
c.drawString(margin + 36, H - margin - 12, 'Kanvaz')
c.setFont('Helvetica', 10)
c.setFillColor(TEXT3)
c.drawString(margin + 36, H - margin - 26, 'Quick Start Guide')

c.setStrokeColor(BORDER)
c.setLineWidth(0.75)
c.line(margin, H - margin - 42, W - margin, H - margin - 42)

y = H - margin - 70

# Getting started steps
y = draw_section_label(c, 'Getting started', margin, y)
y -= 4

steps = [
    ('Open the app', 'Double-click the Kanvaz icon. On first launch you\'ll see a quick welcome screen — click through it to get to the canvas.'),
    ('Add your media', 'Drag image, GIF, video, or audio files from your file explorer straight onto the canvas, or copy an image anywhere and press Ctrl+V to paste it.'),
    ('Move, resize & annotate', 'Click and drag any card to move it. Drag the corner/edge handles to resize (hold Shift to resize freely). Right-click a card → "Annotate" to draw on top of it with pen, arrow, or rectangle tools.'),
    ('Create & switch boards', 'Click the "+" next to your board tabs to create a new board. Double-click a tab name to rename it. Each board keeps its own cards, zoom, and position.'),
    ('Save your work', 'Press Ctrl+S to save to a .kanvaz file. Ctrl+Shift+S saves a copy under a new name. Kanvaz also auto-saves every 30 seconds as a safety net.'),
]
for i, (title, desc) in enumerate(steps, 1):
    y = draw_step(c, margin, y, i, title, desc, content_w)

y -= 10

# Shortcuts
y = draw_section_label(c, 'Top 5 shortcuts', margin, y)
y -= 6

shortcuts = [
    ('Space + Drag', 'Pan around the canvas'),
    ('Scroll', 'Zoom in / out'),
    ('Ctrl + S', 'Save the current board'),
    ('Ctrl + Shift + F', 'Mood lock — hide all UI for presenting'),
    ('Ctrl + Z', 'Undo (up to 50 steps)'),
]
col_split = content_w / 2 + 10
for i, (key, desc) in enumerate(shortcuts):
    col = i % 2
    row = i // 2
    sx = margin + col * col_split
    sy = y - row * 26
    draw_shortcut_row(c, sx, sy, key, desc)

y = y - ((len(shortcuts) + 1) // 2) * 26 - 24

# Pro tips
y = draw_section_label(c, 'Pro tips', margin, y)
y -= 2
tips = [
    (ACCENT, 'Pin cards in place', 'Right-click any card and choose Pin (or press P) to lock its position so it can\'t be moved or nudged by accident.'),
    (GREEN,  'Duplicate with Ctrl+D', 'Quickly clone the selected card — handy for creating variations or side-by-side comparisons.'),
    (AMBER,  'Toggle annotations with H', 'Select an annotated card and press H to hide or show your pen, arrow, and rectangle marks without deleting them.'),
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
c.drawString(margin + 14, y - 30, 'Tell Atharva directly — that\'s it. This build is small enough that')
c.drawString(margin + 14, y - 42, 'a quick message is the fastest way to get something fixed.')

# Page number
c.setFont('Helvetica', 8)
c.setFillColor(TEXT3)
c.drawCentredString(W/2, 0.4 * inch, '2 / 2')

c.showPage()
c.save()

print('PDF generated successfully')
