from pathlib import Path
from shutil import copyfile

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "TAVONEL_ENTERPRISE_PRICING_2026-08-30.pdf"
PUBLIC = ROOT / "nextjs" / "public" / "legal" / OUTPUT.name

INK = colors.HexColor("#16201D")
MOSS = colors.HexColor("#52665D")
PAPER = colors.HexColor("#F4F0E6")
LINE = colors.HexColor("#CFC7B5")
ACCENT = colors.HexColor("#B46A3C")


def table(rows, widths):
    value = Table(rows, colWidths=widths, repeatRows=1, hAlign="LEFT")
    value.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("TEXTCOLOR", (0, 0), (-1, 0), PAPER),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return value


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(20 * mm, 15 * mm, 190 * mm, 15 * mm)
    canvas.setFillColor(MOSS)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(20 * mm, 10 * mm, "CommodityNode operates the TAVONEL brand and TAVONEL Foundation service.")
    canvas.drawRightString(190 * mm, 10 * mm, f"{doc.page}")
    canvas.restoreState()


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    title = ParagraphStyle("Title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=28, leading=31, textColor=INK, spaceAfter=5)
    eyebrow = ParagraphStyle("Eyebrow", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=ACCENT, tracking=1.2, spaceAfter=4)
    section = ParagraphStyle("Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=INK, spaceBefore=12, spaceAfter=6)
    body = ParagraphStyle("Body", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5, leading=12, textColor=MOSS, spaceAfter=6)
    meta = ParagraphStyle("Meta", parent=body, alignment=TA_RIGHT, fontSize=7.5, leading=10)

    doc = SimpleDocTemplate(str(OUTPUT), pagesize=A4, rightMargin=20 * mm, leftMargin=20 * mm, topMargin=18 * mm, bottomMargin=22 * mm, title="TAVONEL Enterprise Pricing Guidelines", author="CommodityNode")
    story = [
        Table([[Paragraph("ENTERPRISE PRICING", eyebrow), Paragraph("Effective 2026-08-30<br/>USD, taxes excluded", meta)]], colWidths=[110 * mm, 60 * mm], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)])),
        Paragraph("TAVONEL", title),
        Paragraph("Measured access. Bounded compute. Contracted enterprise scope.", body),
        Spacer(1, 3 * mm),
        Paragraph("STANDARD ACCESS", section),
        table([
            ["Plan", "Price", "Included scope"],
            ["Observer", "$29 / month", "Individual read and review access"],
            ["Studio", "$99 / month", "Individual production workspace access"],
            ["Institution", "$499-$4,999 / month", "Multi-user governance, support and deployment scope agreed by contract"],
        ], [35 * mm, 40 * mm, 95 * mm]),
        Paragraph("PREPAID COMPUTE", section),
        table([
            ["Pack", "Price", "Credits"],
            ["Starter", "$12 one time", "100"],
            ["Builder", "$30 one time", "300"],
            ["Scale", "$75 one time", "800"],
        ], [55 * mm, 60 * mm, 55 * mm]),
        Spacer(1, 2 * mm),
        Paragraph("Access plans do not include unlimited GPU processing. Compute is prepaid, reserved before dispatch, and subject to job and workspace limits.", body),
        Paragraph("CUSTOM SERVICES", section),
        table([
            ["Service", "Guideline range"],
            ["Security and deployment onboarding", "$1,500-$10,000 one time"],
            ["Source connector or workflow implementation", "$2,500-$25,000 one time"],
            ["Dedicated support or governance package", "$500-$5,000 / month"],
        ], [105 * mm, 65 * mm]),
        Spacer(1, 3 * mm),
        Paragraph("These are non-binding planning guidelines. A final quote depends on users, source volume, retention, support hours, security review, data residency, integration complexity, and qualified compute demand. No custom work starts until both parties accept a written scope and price.", body),
        Paragraph("CONTACT", section),
        Paragraph("hello@tavonel.com  |  tavonel.com/terms  |  tavonel.com/refunds", body),
    ]
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    copyfile(OUTPUT, PUBLIC)


if __name__ == "__main__":
    build()
