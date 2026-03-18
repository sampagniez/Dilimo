#!/usr/bin/env python3
# generer_rapport.py — Compte rendu de visite ImmoAnalytics Pro
# Usage : python3 generer_rapport.py output.pdf  (données JSON sur stdin)

import sys
import json
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm, cm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ─── Données ──────────────────────────────────────────────────────────────────
data = json.load(sys.stdin)
output_path = sys.argv[1]

# ─── Palette ──────────────────────────────────────────────────────────────────
INK        = colors.HexColor('#0D1117')
INK2       = colors.HexColor('#1C2536')
SLATE      = colors.HexColor('#4A5568')
MIST       = colors.HexColor('#8896A8')
GHOST      = colors.HexColor('#C8D3DC')
FOG        = colors.HexColor('#E8EDF2')
PAPER      = colors.HexColor('#F4F6F8')
WHITE      = colors.white
GOLD       = colors.HexColor('#C9A84C')
GOLD_LIGHT = colors.HexColor('#FDF8EE')
GREEN      = colors.HexColor('#1A7F5A')
GREEN_BG   = colors.HexColor('#EBF8F3')
RED        = colors.HexColor('#C0392B')
RED_BG     = colors.HexColor('#FEF2F2')
ORANGE     = colors.HexColor('#D97706')
ORANGE_BG  = colors.HexColor('#FFFBEB')
BLUE       = colors.HexColor('#2563EB')
BLUE_BG    = colors.HexColor('#EFF6FF')

W, H = A4

# ─── Styles ───────────────────────────────────────────────────────────────────
def style(name, **kw):
    defaults = dict(fontName='Helvetica', fontSize=10, textColor=INK,
                    leading=14, spaceAfter=0, spaceBefore=0)
    defaults.update(kw)
    return ParagraphStyle(name, **defaults)

S_TITLE      = style('title',    fontName='Helvetica-Bold', fontSize=22, textColor=WHITE, leading=28)
S_SUBTITLE   = style('subtitle', fontName='Helvetica',      fontSize=12, textColor=GOLD,  leading=16)
S_SECTION    = style('section',  fontName='Helvetica-Bold', fontSize=11, textColor=INK2,  leading=16, spaceBefore=4)
S_LABEL      = style('label',    fontName='Helvetica-Bold', fontSize=8,  textColor=MIST,  leading=12)
S_VALUE      = style('value',    fontName='Helvetica',      fontSize=10, textColor=INK,   leading=14)
S_VALUE_MONO = style('vmono',    fontName='Courier-Bold',   fontSize=10, textColor=INK,   leading=14)
S_SMALL      = style('small',    fontName='Helvetica',      fontSize=8,  textColor=MIST,  leading=11)
S_NOTE       = style('note',     fontName='Helvetica',      fontSize=9,  textColor=SLATE, leading=13)
S_POS        = style('pos',      fontName='Helvetica-Bold', fontSize=10, textColor=GREEN, leading=14)
S_NEG        = style('neg',      fontName='Helvetica-Bold', fontSize=10, textColor=RED,   leading=14)
S_GOLD       = style('gold',     fontName='Helvetica-Bold', fontSize=10, textColor=GOLD,  leading=14)

# ─── Helpers ──────────────────────────────────────────────────────────────────
def fmt(n):
    if n is None: return '—'
    try:
        return f"{int(round(float(n))):,}".replace(',', '\u202f')
    except: return '—'

def fmtpct(n):
    if n is None: return '—'
    try: return f"{float(n):.1f}%"
    except: return '—'

def section_title(text, icon=''):
    elems = []
    elems.append(Spacer(1, 6*mm))
    elems.append(HRFlowable(width='100%', thickness=0.5, color=FOG))
    elems.append(Spacer(1, 3*mm))
    full = f"{icon}  {text}" if icon else text
    elems.append(Paragraph(full, S_SECTION))
    elems.append(Spacer(1, 3*mm))
    return elems

def kv_table(rows, col_widths=None):
    """rows = [(label, value), ...]  — 2 or 4 columns"""
    if col_widths is None:
        col_widths = [45*mm, 75*mm]
    data = []
    for r in rows:
        if len(r) == 2:
            data.append([Paragraph(r[0], S_LABEL), Paragraph(str(r[1]), S_VALUE_MONO)])
        else:  # 4 cols
            data.append([
                Paragraph(r[0], S_LABEL), Paragraph(str(r[1]), S_VALUE_MONO),
                Paragraph(r[2], S_LABEL), Paragraph(str(r[3]), S_VALUE_MONO),
            ])
    ts = TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), WHITE),
        ('ROWBACKGROUNDS', (0,0), (-1,-1), [WHITE, PAPER]),
        ('TOPPADDING',    (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING',   (0,0), (-1,-1), 6),
        ('RIGHTPADDING',  (0,0), (-1,-1), 6),
        ('GRID', (0,0), (-1,-1), 0.3, FOG),
        ('ROUNDEDCORNERS', [4]),
    ])
    return Table(data, colWidths=col_widths, style=ts, hAlign='LEFT')

def synth_table(rows):
    """Tableau de synthèse financière"""
    data = []
    for r in rows:
        label, value, style_val, is_total = r
        s_l = ParagraphStyle('sl', fontName='Helvetica-Bold' if is_total else 'Helvetica',
                              fontSize=10 if is_total else 9,
                              textColor=INK if is_total else SLATE, leading=14)
        s_v = ParagraphStyle('sv', fontName='Helvetica-Bold',
                              fontSize=10 if is_total else 9,
                              textColor=style_val, leading=14, alignment=TA_RIGHT)
        data.append([Paragraph(label, s_l), Paragraph(value, s_v)])

    ts = TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), WHITE),
        ('ROWBACKGROUNDS', (0,0), (-1,-1), [WHITE, PAPER]),
        ('TOPPADDING',    (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING',   (0,0), (-1,-1), 8),
        ('RIGHTPADDING',  (0,0), (-1,-1), 8),
        ('LINEABOVE', (0, len(data)-2), (-1, len(data)-2), 1, INK2),
        ('LINEABOVE', (0, len(data)-1), (-1, len(data)-1), 1, INK2),
        ('BACKGROUND', (0, len(data)-1), (-1, len(data)-1), PAPER),
    ])
    return Table(data, colWidths=[120*mm, 50*mm], style=ts, hAlign='LEFT')

# ─── Page header/footer callbacks ────────────────────────────────────────────
DATE_STR = datetime.now().strftime('%d/%m/%Y')
ADRESSE  = data.get('bien', {}).get('adresse', 'Adresse non renseignée')

def on_first_page(canvas, doc):
    canvas.saveState()
    # Header band
    canvas.setFillColor(INK2)
    canvas.rect(0, H - 52*mm, W, 52*mm, fill=1, stroke=0)
    # Gold accent bar
    canvas.setFillColor(GOLD)
    canvas.rect(0, H - 53.5*mm, W, 1.5*mm, fill=1, stroke=0)
    # Logo text
    canvas.setFillColor(WHITE)
    canvas.setFont('Helvetica-Bold', 9)
    canvas.drawString(20*mm, H - 14*mm, 'ImmoAnalytics Pro')
    canvas.setFillColor(GOLD)
    canvas.setFont('Helvetica', 8)
    canvas.drawString(20*mm, H - 20*mm, 'MARCHAND DE BIENS')
    # Title
    canvas.setFillColor(WHITE)
    canvas.setFont('Helvetica-Bold', 20)
    canvas.drawString(20*mm, H - 33*mm, 'Compte rendu de visite')
    canvas.setFillColor(GOLD)
    canvas.setFont('Helvetica', 11)
    canvas.drawString(20*mm, H - 42*mm, ADRESSE)
    # Date top right
    canvas.setFillColor(MIST)
    canvas.setFont('Helvetica', 8)
    canvas.drawRightString(W - 20*mm, H - 14*mm, f'Généré le {DATE_STR}')
    _footer(canvas, doc)
    canvas.restoreState()

def on_later_pages(canvas, doc):
    canvas.saveState()
    # Thin header
    canvas.setFillColor(INK2)
    canvas.rect(0, H - 14*mm, W, 14*mm, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, H - 14.8*mm, W, 0.8*mm, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont('Helvetica-Bold', 8)
    canvas.drawString(20*mm, H - 9*mm, 'ImmoAnalytics Pro  —  Compte rendu de visite')
    canvas.setFillColor(MIST)
    canvas.setFont('Helvetica', 8)
    canvas.drawRightString(W - 20*mm, H - 9*mm, ADRESSE)
    _footer(canvas, doc)
    canvas.restoreState()

def _footer(canvas, doc):
    canvas.setFillColor(FOG)
    canvas.rect(0, 0, W, 10*mm, fill=1, stroke=0)
    canvas.setFillColor(MIST)
    canvas.setFont('Helvetica', 7)
    canvas.drawString(20*mm, 3.5*mm, 'Document confidentiel — Usage interne marchand de biens')
    canvas.drawRightString(W - 20*mm, 3.5*mm, f'Page {doc.page}')

# ─── Document ─────────────────────────────────────────────────────────────────
doc = SimpleDocTemplate(
    output_path,
    pagesize=A4,
    leftMargin=20*mm, rightMargin=20*mm,
    topMargin=58*mm,  bottomMargin=16*mm,
    title=f'Compte rendu — {ADRESSE}',
    author='ImmoAnalytics Pro',
)

story = []

# ════════════════════════════════════════════════════════
# SECTION 1 — LE BIEN
# ════════════════════════════════════════════════════════
bien = data.get('bien', {})
story += section_title('Le bien', '🏠')

rows_bien = []
if bien.get('adresse'):    rows_bien.append(('ADRESSE', bien['adresse'], 'TYPE', bien.get('type', '—')))
if bien.get('surface'):    rows_bien.append(('SURFACE HABITABLE', f"{fmt(bien['surface'])} m²", 'ANNEE CONSTRUCTION', str(bien.get('anneeConstruction', '—'))))

if rows_bien:
    story.append(kv_table(rows_bien, col_widths=[35*mm, 55*mm, 35*mm, 45*mm]))
    story.append(Spacer(1, 4*mm))

# ════════════════════════════════════════════════════════
# SECTION 2 — MARCHÉ DVF
# ════════════════════════════════════════════════════════
dvf = data.get('dvf', {})
if dvf:
    story += section_title('Analyse de marché DVF', '📊')
    story.append(Paragraph(
        f"Zone analysée : rayon {dvf.get('dist', 1)} km · {dvf.get('months', 24)} mois · {fmt(dvf.get('total', 0))} transactions",
        S_SMALL))
    story.append(Spacer(1, 3*mm))

    # Tableau prix par catégorie
    prix_header = [
        Paragraph('CATÉGORIE', S_LABEL),
        Paragraph('MÉDIAN €/m²', S_LABEL),
        Paragraph('MOYENNE €/m²', S_LABEL),
        Paragraph('FOURCHETTE €/m²', S_LABEL),
        Paragraph('NB VENTES', S_LABEL),
    ]
    prix_rows = [prix_header]

    def dvf_row(label, s):
        if not s: return None
        fourchette = f"{fmt(s.get('p10'))} – {fmt(s.get('p90'))}"
        return [
            Paragraph(label, S_VALUE),
            Paragraph(fmt(s.get('median')) + ' €', S_VALUE_MONO),
            Paragraph(fmt(s.get('mean'))   + ' €', S_VALUE_MONO),
            Paragraph(fourchette + ' €',            S_VALUE_MONO),
            Paragraph(str(s.get('count', '—')),     S_VALUE),
        ]

    for label, key in [('Appartements', 'appartements'), ('Maisons', 'maisons'), ('Terrains', 'terrains')]:
        stats = dvf.get(key, {}).get('stats')
        row = dvf_row(label, stats)
        if row: prix_rows.append(row)

    if len(prix_rows) > 1:
        ts_prix = TableStyle([
            ('BACKGROUND',    (0,0), (-1,0),  INK2),
            ('TEXTCOLOR',     (0,0), (-1,0),  WHITE),
            ('ROWBACKGROUNDS',(0,1), (-1,-1), [WHITE, PAPER]),
            ('FONTNAME',      (0,0), (-1,0),  'Helvetica-Bold'),
            ('FONTSIZE',      (0,0), (-1,-1), 9),
            ('TOPPADDING',    (0,0), (-1,-1), 6),
            ('BOTTOMPADDING', (0,0), (-1,-1), 6),
            ('LEFTPADDING',   (0,0), (-1,-1), 6),
            ('RIGHTPADDING',  (0,0), (-1,-1), 6),
            ('GRID',          (0,0), (-1,-1), 0.3, FOG),
        ])
        story.append(Table(prix_rows,
            colWidths=[30*mm, 30*mm, 30*mm, 40*mm, 20*mm],
            style=ts_prix, hAlign='LEFT'))
        story.append(Spacer(1, 3*mm))

    # Typologies appartements
    typos = dvf.get('appartements', {}).get('typologies', {})
    if typos:
        story.append(Paragraph('Détail typologies appartements', S_SMALL))
        story.append(Spacer(1, 2*mm))
        typo_header = [Paragraph(h, S_LABEL) for h in ['TYPE', 'MÉDIAN €/m²', 'FOURCHETTE', 'NB']]
        typo_rows = [typo_header]
        for t in ['T1','T2','T3','T4','T5']:
            s = typos.get(t)
            if s:
                typo_rows.append([
                    Paragraph(t, S_VALUE),
                    Paragraph(fmt(s.get('median')) + ' €', S_VALUE_MONO),
                    Paragraph(f"{fmt(s.get('p10'))} – {fmt(s.get('p90'))} €", S_VALUE_MONO),
                    Paragraph(str(s.get('count', '—')), S_VALUE),
                ])
        ts_typo = TableStyle([
            ('BACKGROUND',    (0,0), (-1,0),  PAPER),
            ('ROWBACKGROUNDS',(0,1), (-1,-1), [WHITE, PAPER]),
            ('FONTSIZE',      (0,0), (-1,-1), 9),
            ('TOPPADDING',    (0,0), (-1,-1), 5),
            ('BOTTOMPADDING', (0,0), (-1,-1), 5),
            ('LEFTPADDING',   (0,0), (-1,-1), 6),
            ('RIGHTPADDING',  (0,0), (-1,-1), 6),
            ('GRID',          (0,0), (-1,-1), 0.3, FOG),
        ])
        story.append(Table(typo_rows,
            colWidths=[20*mm, 35*mm, 55*mm, 20*mm],
            style=ts_typo, hAlign='LEFT'))

# ════════════════════════════════════════════════════════
# SECTION 3 — CALCUL DE RENTABILITÉ
# ════════════════════════════════════════════════════════
rent = data.get('rentabilite', {})
if rent and rent.get('prixRevente'):
    story += section_title('Calcul de rentabilité', '💰')

    pr  = rent.get('prixRevente', 0)
    pa  = rent.get('prixAchat', 0)
    fn  = rent.get('fraisNotaire', 0)
    tr  = rent.get('travaux', 0)
    ff  = rent.get('fraisFinanciers', 0)
    fa  = rent.get('fraisAgence', 0)
    mb  = rent.get('margeBrute', 0)
    is_ = rent.get('is', 0)
    mn  = rent.get('margeNette', 0)
    mbp = rent.get('margeBrutePct', 0)
    mnp = rent.get('margeNettePct', 0)
    roi = rent.get('roiAnnuel', 0)
    portage = rent.get('portage', 12)
    niveau  = rent.get('niveauTravaux', '—')

    # Indicateur marge
    if mnp >= 15:   ind_col, ind_txt = GREEN,  'Opération rentable'
    elif mnp >= 8:  ind_col, ind_txt = ORANGE, 'Marge limite'
    else:           ind_col, ind_txt = RED,    'Marge insuffisante'

    # KPI band
    kpi_data = [[
        Paragraph('PRIX D\'ACHAT', S_LABEL),
        Paragraph('MARGE BRUTE', S_LABEL),
        Paragraph('MARGE NETTE', S_LABEL),
        Paragraph('ROI ANNUALISÉ', S_LABEL),
        Paragraph('PORTAGE', S_LABEL),
    ],[
        Paragraph(f"{fmt(pa)} €", S_VALUE_MONO),
        Paragraph(fmtpct(mbp), ParagraphStyle('x', fontName='Helvetica-Bold', fontSize=11, textColor=GOLD, leading=14)),
        Paragraph(fmtpct(mnp), ParagraphStyle('x', fontName='Helvetica-Bold', fontSize=11, textColor=ind_col, leading=14)),
        Paragraph(fmtpct(roi), S_VALUE_MONO),
        Paragraph(f"{portage} mois", S_VALUE_MONO),
    ]]
    ts_kpi = TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), PAPER),
        ('TOPPADDING',    (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING',   (0,0), (-1,-1), 8),
        ('RIGHTPADDING',  (0,0), (-1,-1), 8),
        ('BOX', (0,0), (-1,-1), 0.5, GHOST),
        ('LINEBELOW', (0,0), (-1,0), 0.3, FOG),
    ])
    story.append(Table(kpi_data, colWidths=[34*mm]*5, style=ts_kpi, hAlign='LEFT'))
    story.append(Spacer(1, 4*mm))

    # Tableau de synthèse
    synth_rows = [
        ('Prix de revente estimé',         f"+ {fmt(pr)} €",   GREEN, False),
        (f'— Prix d\'achat',               f"- {fmt(pa)} €",   RED,   False),
        (f'— Frais de notaire (3%)',        f"- {fmt(fn)} €",   RED,   False),
        (f'— Budget travaux ({niveau})',    f"- {fmt(tr)} €",   RED,   False),
    ]
    if ff:
        synth_rows.append((f'— Frais financiers ({portage} mois)', f"- {fmt(ff)} €", RED, False))
    synth_rows += [
        (f'— Frais d\'agence vente',        f"- {fmt(fa)} €",   RED,   False),
        ('= Marge brute',                   f"+ {fmt(mb)} €",   GOLD,  False),
        (f'— Impôt sur les sociétés',       f"- {fmt(is_)} €",  RED,   False),
        ('= Marge nette (après IS)',        f"+ {fmt(mn)} €",   GREEN if mn >= 0 else RED, True),
    ]
    story.append(KeepTogether([synth_table(synth_rows)]))
    story.append(Spacer(1, 4*mm))

    # Prix d'achat cibles
    pac = rent.get('prixAchatCibles', {})
    if pac:
        story.append(Paragraph('Prix d\'achat maximum pour atteindre la marge cible', S_SMALL))
        story.append(Spacer(1, 2*mm))
        pac_data = [[
            Paragraph('MARGE CIBLE', S_LABEL),
            Paragraph('PRIX D\'ACHAT MAX', S_LABEL),
            Paragraph('ÉCART AVEC PRIX SAISI', S_LABEL),
        ]]
        for marge, key, col in [(20, 'pac20', BLUE), (25, 'pac25', GOLD), (30, 'pac30', GREEN)]:
            val = pac.get(key, 0)
            ecart = val - pa if pa else 0
            ecart_str = f"{'+ ' if ecart >= 0 else ''}{fmt(ecart)} €"
            pac_data.append([
                Paragraph(f'{marge}%', ParagraphStyle('pm', fontName='Helvetica-Bold', fontSize=10, textColor=col, leading=14)),
                Paragraph(f"{fmt(val)} €", S_VALUE_MONO),
                Paragraph(ecart_str, ParagraphStyle('pe', fontName='Helvetica-Bold', fontSize=10,
                          textColor=GREEN if ecart >= 0 else RED, leading=14)),
            ])
        ts_pac = TableStyle([
            ('BACKGROUND',    (0,0), (-1,0),  PAPER),
            ('ROWBACKGROUNDS',(0,1), (-1,-1), [WHITE, PAPER]),
            ('FONTSIZE',      (0,0), (-1,-1), 10),
            ('TOPPADDING',    (0,0), (-1,-1), 7),
            ('BOTTOMPADDING', (0,0), (-1,-1), 7),
            ('LEFTPADDING',   (0,0), (-1,-1), 8),
            ('RIGHTPADDING',  (0,0), (-1,-1), 8),
            ('GRID',          (0,0), (-1,-1), 0.3, FOG),
        ])
        story.append(Table(pac_data, colWidths=[35*mm, 55*mm, 55*mm], style=ts_pac, hAlign='LEFT'))

# ════════════════════════════════════════════════════════
# SECTION 4 — NOTES DE VISITE
# ════════════════════════════════════════════════════════
notes = data.get('notes', {})
story += section_title('Notes de visite', '📝')

# Grille état du bien
etat = notes.get('etat', {})
def fmt_etat(val, note=''):
    labels = {'bon': '✓ Bon', 'moyen': '~ Moyen', 'mauvais': '✗ Mauvais'}
    v = labels.get(val, val or '—')
    return f"{v}  {note}" if note else v

etat_postes = [
    ('Etat général',       'etatGeneral'),
    ('Toiture / Charpente','toiture'),
    ('Façade / Extérieur', 'facade'),
    ('Menuiseries',        'menuiseries'),
    ('Plomberie',          'plomberie'),
    ('Electricité',        'electricite'),
    ('Chauffage',          'chauffage'),
    ('DPE estimé',         'dpe'),
]
etat_rows = []
for i in range(0, len(etat_postes), 2):
    l1, k1 = etat_postes[i]
    v1 = fmt_etat(etat.get(k1, ''), etat.get(k1+'_note', ''))
    if i+1 < len(etat_postes):
        l2, k2 = etat_postes[i+1]
        v2 = fmt_etat(etat.get(k2, ''), etat.get(k2+'_note', ''))
        etat_rows.append([l1, v1, l2, v2])
    else:
        etat_rows.append([l1, v1, '', ''])

story.append(kv_table(etat_rows, col_widths=[38*mm, 47*mm, 38*mm, 47*mm]))
story.append(Spacer(1, 4*mm))

# Points forts / Points faibles
points = notes.get('points', {})
pf_data = [[
    Paragraph('✅  POINTS FORTS', ParagraphStyle('ph', fontName='Helvetica-Bold', fontSize=9, textColor=GREEN, leading=12)),
    Paragraph('⚠️  POINTS DE VIGILANCE', ParagraphStyle('ph', fontName='Helvetica-Bold', fontSize=9, textColor=ORANGE, leading=12)),
],[
    Paragraph(points.get('forts', '—'), S_NOTE),
    Paragraph(points.get('faibles', '—'), S_NOTE),
]]
ts_pf = TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PAPER),
    ('BACKGROUND', (0,1), (0,1),  GREEN_BG),
    ('BACKGROUND', (1,1), (1,1),  ORANGE_BG),
    ('TOPPADDING',    (0,0), (-1,-1), 8),
    ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ('LEFTPADDING',   (0,0), (-1,-1), 8),
    ('RIGHTPADDING',  (0,0), (-1,-1), 8),
    ('BOX',    (0,0), (-1,-1), 0.5, GHOST),
    ('INNERGRID', (0,0), (-1,-1), 0.3, FOG),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
])
story.append(Table(pf_data, colWidths=[85*mm, 85*mm], style=ts_pf, hAlign='LEFT'))
story.append(Spacer(1, 4*mm))

# Notes libres
note_libre = notes.get('noteLibre', '')
if note_libre:
    story.append(Paragraph('Observations complémentaires', S_SMALL))
    story.append(Spacer(1, 2*mm))
    note_data = [[Paragraph(note_libre, S_NOTE)]]
    ts_note = TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), PAPER),
        ('BOX', (0,0), (-1,-1), 0.5, GHOST),
        ('LEFTBORDER', (0,0), (0,-1), 3, GOLD),
        ('TOPPADDING',    (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING',   (0,0), (-1,-1), 10),
        ('RIGHTPADDING',  (0,0), (-1,-1), 8),
    ])
    story.append(Table(note_data, colWidths=[170*mm], style=ts_note, hAlign='LEFT'))

# ════════════════════════════════════════════════════════
# SECTION 5 — DÉCISION
# ════════════════════════════════════════════════════════
decision_data = notes.get('decision', {})
story += section_title('Décision & Prochaines étapes', '🎯')

decision = decision_data.get('statut', 'A étudier')
dec_colors = {
    'Offre à faire': (GREEN, GREEN_BG),
    'A étudier':     (ORANGE, ORANGE_BG),
    'Non retenu':    (RED, RED_BG),
}
dec_col, dec_bg = dec_colors.get(decision, (MIST, PAPER))

dec_data = [[
    Paragraph('STATUT', S_LABEL),
    Paragraph('OFFRE ENVISAGÉE', S_LABEL),
    Paragraph('ÉCHÉANCE', S_LABEL),
],[
    Paragraph(decision, ParagraphStyle('ds', fontName='Helvetica-Bold', fontSize=12, textColor=dec_col, leading=16)),
    Paragraph(f"{fmt(decision_data.get('offreEnvisagee', None))} €" if decision_data.get('offreEnvisagee') else '—', S_VALUE_MONO),
    Paragraph(decision_data.get('echeance', '—'), S_VALUE),
]]
ts_dec = TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PAPER),
    ('BACKGROUND', (0,1), (0,1), dec_bg),
    ('BACKGROUND', (1,1), (-1,1), WHITE),
    ('TOPPADDING',    (0,0), (-1,-1), 8),
    ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ('LEFTPADDING',   (0,0), (-1,-1), 10),
    ('RIGHTPADDING',  (0,0), (-1,-1), 10),
    ('BOX', (0,0), (-1,-1), 0.5, GHOST),
    ('INNERGRID', (0,0), (-1,-1), 0.3, FOG),
])
story.append(Table(dec_data, colWidths=[50*mm, 60*mm, 60*mm], style=ts_dec, hAlign='LEFT'))

next_steps = decision_data.get('prochainesEtapes', '')
if next_steps:
    story.append(Spacer(1, 3*mm))
    story.append(Paragraph('Prochaines étapes :', S_SMALL))
    story.append(Spacer(1, 2*mm))
    for line in next_steps.split('\n'):
        if line.strip():
            story.append(Paragraph(f'• {line.strip()}', S_NOTE))

# ─── Build ────────────────────────────────────────────────────────────────────
doc.build(story, onFirstPage=on_first_page, onLaterPages=on_later_pages)
