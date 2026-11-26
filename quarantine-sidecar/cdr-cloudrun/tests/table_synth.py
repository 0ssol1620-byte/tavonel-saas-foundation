"""Synthetic statement-like PDFs with their own truth (WO-E-TBL-P0). No corpus file, no generator library.

Copied from receipts/WO-E-TBL-P0/synth.py (sha256 1c315b55...) for WO-E-TBL-P2. One change: `Page.media`,
so the bounds tests can draw a page larger than Letter; the default writes the same bytes as the probe.

Every page is written by hand as a PDF content stream in the standard Helvetica font (WinAnsiEncoding),
so the generator knows the row and column of every string it draws. Widths for right/centre alignment
come from the Helvetica AFM advance widths below (1/1000 em).

Truth model, per table:
  row   = visual line index relative to the table's first line that carries a value cell (header lines
          above it are negative). One visual line per drawn baseline, so a wrapped label is two rows.
  col   = 0 for the label column, 1.. for value columns left to right.
  span  = columns covered (merged header cells only; 1 otherwise).
  label = for value cells, the full logical row label (wrapped lines joined), to measure label joining.
"""

from __future__ import annotations

from dataclasses import dataclass, field

W = {  # Helvetica AFM advance widths, 1/1000 em
    " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333,
    "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278, ":": 278, ";": 278, "<": 584, "=": 584,
    ">": 584, "?": 556, "@": 1015, "[": 278, "\\": 278, "]": 278, "^": 469, "_": 556, "`": 333, "{": 334,
    "|": 260, "}": 334, "~": 584, "—": 1000, "€": 556,
    **{d: 556 for d in "0123456789"},
    **dict(zip("abcdefghijklmnopqrstuvwxyz",
               [556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
                278, 556, 500, 722, 500, 500, 500])),
    **dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ",
               [667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
                611, 722, 667, 944, 667, 667, 611])),
}


def width(text: str, size: float) -> float:
    return sum(W[ch] for ch in text) * size / 1000.0


def _pdf_string(text: str) -> str:
    raw = text.encode("cp1252")
    out = []
    for b in raw:
        ch = chr(b)
        if ch in "()\\":
            out.append("\\" + ch)
        elif 32 <= b < 127:
            out.append(ch)
        else:
            out.append(f"\\{b:03o}")
    return "(" + "".join(out) + ")"


@dataclass
class Page:
    rotate: int = 0
    media: tuple[float, float] = (612, 792)
    ops: list[str] = field(default_factory=list)
    tables: list[dict] = field(default_factory=list)  # truth

    def text(self, x: float, y: float, s: str, size: float = 9.0, rotate90: bool = False) -> None:
        if rotate90:  # glyphs turned 90 degrees by the text matrix on an unrotated page
            self.ops.append(f"BT /F1 {size:g} Tf 0 1 -1 0 {x:.3f} {y:.3f} Tm {_pdf_string(s)} Tj ET")
        else:
            self.ops.append(f"BT /F1 {size:g} Tf {x:.3f} {y:.3f} Td {_pdf_string(s)} Tj ET")

    def rule(self, x1: float, x2: float, y: float) -> None:
        self.ops.append(f"0.5 w {x1:.3f} {y:.3f} m {x2:.3f} {y:.3f} l S")


def build_pdf(pages: list[Page]) -> bytes:
    objects: list[bytes] = []
    n_pages = len(pages)
    font_id = 3 + 2 * n_pages
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(n_pages))
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode())
    for i, page in enumerate(pages):
        content_id = 4 + 2 * i
        rot = f" /Rotate {page.rotate}" if page.rotate else ""
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page.media[0]:g} {page.media[1]:g}]{rot} "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>".encode()
        )
        stream = "\n".join(page.ops).encode("latin-1")
        objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def table(
    page: Page,
    *,
    left: float,
    col_rights: list[float],
    top: float,
    rows: list[dict],
    size: float = 9.0,
    pitch: float = 12.0,
    align: str = "right",
    currency_x: list[float] | None = None,
    rotate90: bool = False,
) -> float:
    """Draw a table and record its truth. Returns the baseline y below the last row.

    Row keys: label (str) | label_lines (list[str], values on the last line), indent (pt),
    values (list[str|None], one per column), spans (list[(first_col0, n, text)]) for a merged header line,
    rule_above (bool: a drawn path rule above the values), underscore_rule (bool: a text rule line),
    value_x (dict col0 -> right edge override, for adversarial cases), gap_before (extra pt).
    """
    y = top
    lines: list[dict] = []  # each: {"cells": [(col, span, text)], "values": bool}
    for row in rows:
        y -= row.get("gap_before", 0.0)
        label_lines = row.get("label_lines") or ([row["label"]] if row.get("label") else [])
        indent = row.get("indent", 0.0)
        logical_label = " ".join(label_lines) if label_lines else None
        for k, part in enumerate(label_lines[:-1]):
            page.text(left + indent + (6 if k else 0), y, part, size, rotate90)
            lines.append({"cells": [(0, 1, part, None)], "values": False})
            y -= pitch
        cells: list[tuple] = []
        if label_lines:
            last = label_lines[-1]
            page.text(left + indent + (6 if len(label_lines) > 1 else 0), y, last, size, rotate90)
            cells.append((0, 1, last, None))
        if row.get("rule_above"):
            for c in range(len(col_rights)):
                page.rule(col_rights[c] - 45, col_rights[c], y + size + 1.5)
        if row.get("underscore_rule"):
            for c in range(len(col_rights)):
                page.text(col_rights[c] - width("_______", size), y, "_______", size, rotate90)
            lines.append({"cells": [], "values": False, "rule": True})
            y -= pitch
            continue
        for first, n, text in row.get("spans", []):
            lo = col_rights[first] - 40
            hi = col_rights[first + n - 1]
            x = (lo + hi) / 2 - width(text, size) / 2
            page.text(x, y, text, size, rotate90)
            cells.append((first + 1, n, text, None))
        values = row.get("values", [])
        has_values = False
        for c, value in enumerate(values):
            if value is None:
                continue
            has_values = True
            right = row.get("value_x", {}).get(c, col_rights[c])
            body = value[:-1] if value.endswith(")") and align == "right" else value
            sign = ""
            if currency_x and value.startswith("$"):
                sign, value_body = "$", value[1:]
                page.text(currency_x[c], y, "$", size, rotate90)
                body = value_body.removesuffix(")")
                draw = value_body
            else:
                draw = value
            if align == "right":
                x = right - width(body, size)
            else:  # centre on the column
                x = right - 22 - width(draw, size) / 2
            page.text(x, y, draw, size, rotate90)
            cells.append((c + 1, 1, sign + draw, logical_label))
        lines.append({"cells": cells, "values": has_values})
        y -= pitch
    anchor = next(i for i, line in enumerate(lines) if line["values"])
    truth = []
    for i, line in enumerate(lines):
        for col, span, text, label in line["cells"]:
            truth.append({"row": i - anchor, "col": col, "span": span, "text": text, "label": label})
    page.tables.append({"cells": truth})
    return y


def prose(page: Page, top: float, lines: list[str], size: float = 10.0, leading: float = 12.0, left: float = 72.0) -> float:
    y = top
    for line in lines:
        page.text(left, y, line, size)
        y -= leading
    return y


PROSE = [
    "The consolidated statements below are prepared on the basis described in Note 1. Amounts are",
    "presented in thousands unless stated otherwise, and comparative figures have been reclassified",
    "where necessary. Revenue increased 12% to $4.5 million in 2026 compared with 2025.",
]

YEARS = {"values": ["2026", "2025"]}


def cases() -> list[dict]:
    out: list[dict] = []

    def case(cid: str, shape: str, expected: str, pages: list[Page], note: str = "") -> None:
        out.append({"id": cid, "shape": shape, "expected": expected, "pages": pages, "note": note})

    # 1. two numeric columns, right-aligned
    p = Page()
    table(p, left=72, col_rights=[430, 520], top=700, rows=[
        YEARS,
        {"label": "Revenue", "values": ["12,345", "11,002"]},
        {"label": "Cost of revenue", "values": ["7,210", "6,998"]},
        {"label": "Gross profit", "values": ["5,135", "4,004"]},
    ])
    case("c01_two_columns", "2 numeric columns", "placed", [p])

    # 2. six numeric columns
    p = Page()
    rights = [270, 330, 390, 450, 510, 570]
    table(p, left=40, col_rights=rights, top=700, rows=[
        {"values": ["Q1", "Q2", "Q3", "Q4", "2026", "2025"]},
        {"label": "Units shipped", "values": ["1,204", "1,330", "1,415", "1,602", "5,551", "4,980"]},
        {"label": "Average price", "values": ["12.40", "12.10", "11.95", "11.80", "12.04", "12.66"]},
        {"label": "Returns", "values": ["31", "28", "40", "35", "134", "151"]},
        {"label": "Net revenue", "values": ["14,546", "15,773", "16,431", "18,489", "65,239", "61,890"]},
    ])
    case("c02_six_columns", "6 numeric columns", "placed", [p])

    # 3. indented labels, sections and totals
    p = Page()
    table(p, left=72, col_rights=[430, 520], top=700, rows=[
        YEARS,
        {"label": "Current assets"},
        {"label": "Cash and equivalents", "indent": 10, "values": ["3,410", "2,950"]},
        {"label": "Receivables", "indent": 10, "values": ["1,220", "1,180"]},
        {"label": "Inventories", "indent": 10, "values": ["860", "910"]},
        {"label": "Total current assets", "indent": 20, "values": ["5,490", "5,040"]},
        {"label": "Non-current assets"},
        {"label": "Property and equipment", "indent": 10, "values": ["7,700", "7,420"]},
        {"label": "Total assets", "values": ["13,190", "12,460"]},
    ])
    case("c03_indented_labels", "indented labels, section lines", "placed", [p])

    # 4. multi-line labels (hanging indent), values on the last line
    p = Page()
    table(p, left=72, col_rights=[430, 520], top=700, rows=[
        YEARS,
        {"label_lines": ["Net cash provided by operating", "activities"], "values": ["4,210", "3,875"]},
        {"label_lines": ["Purchases of property, plant and", "equipment, net of disposals"], "values": ["(1,120)", "(980)"]},
        {"label": "Dividends paid", "values": ["(400)", "(380)"]},
    ])
    case("c04_multiline_labels", "multi-line labels", "placed", [p], "label join is measured separately")

    # 5. parenthesised negatives (closing paren hangs right of the digit column)
    p = Page()
    table(p, left=72, col_rights=[430, 520], top=700, rows=[
        YEARS,
        {"label": "Operating income", "values": ["2,310", "1,905"]},
        {"label": "Interest expense", "values": ["(312)", "(298)"]},
        {"label": "Foreign exchange loss", "values": ["(1,045)", "(7)"]},
        {"label": "Income before tax", "values": ["953", "1,600"]},
    ])
    case("c05_paren_negatives", "parenthesised negatives", "placed", [p])

    # 6. currency sign in its own run at the column's left edge
    p = Page()
    table(p, left=72, col_rights=[430, 520], top=700, currency_x=[380, 470], rows=[
        YEARS,
        {"label": "Revenue", "values": ["$12,345", "$11,002"]},
        {"label": "Operating costs", "values": ["9,870", "8,770"]},
        {"label": "Net income", "values": ["$2,475", "$2,232"]},
    ])
    case("c06_currency_own_run", "currency sign in its own run", "placed", [p])

    # 7. subtotal rules: drawn paths and an underscore text line
    p = Page()
    table(p, left=72, col_rights=[430, 520], top=700, rows=[
        YEARS,
        {"label": "Salaries", "values": ["2,100", "1,950"]},
        {"label": "Rent", "values": ["600", "600"]},
        {"underscore_rule": True},
        {"label": "Total expenses", "values": ["2,700", "2,550"], "rule_above": True},
    ])
    case("c07_subtotal_rules", "subtotal rules (path + underscore text)", "placed", [p])

    # 8. merged header cells over value columns
    p = Page()
    table(p, left=72, col_rights=[360, 430, 520], top=700, rows=[
        {"spans": [(0, 2, "Year ended Dec 31"), (2, 1, "Change")]},
        {"values": ["2026", "2025", "%"]},
        {"label": "Revenue", "values": ["12,345", "11,002", "12.2"]},
        {"label": "Operating income", "values": ["2,310", "1,905", "21.3"]},
        {"label": "Net income", "values": ["1,640", "1,388", "18.2"]},
    ])
    case("c08_merged_header", "merged header cells", "placed", [p])

    # 8b. a merged header wider than the columns it spans, reaching left of the first value column
    p = Page()
    table(p, left=72, col_rights=[360, 430, 520], top=700, rows=[
        {"spans": [(0, 2, "Year ended December 31"), (2, 1, "Change")]},
        {"values": ["2026", "2025", "%"]},
        {"label": "Revenue", "values": ["12,345", "11,002", "12.2"]},
        {"label": "Operating income", "values": ["2,310", "1,905", "21.3"]},
    ])
    case("c08b_wide_merged_header", "merged header wider than its columns", "placed", [p],
         "the header phrase crosses the label edge: header line stays text, body is placed")

    # 9. right-aligned numbers of very different widths
    p = Page()
    table(p, left=72, col_rights=[430, 520], top=700, rows=[
        YEARS,
        {"label": "Shares outstanding", "values": ["1,234,567", "1,198,004"]},
        {"label": "Options granted", "values": ["5", "12"]},
        {"label": "Options exercised", "values": ["310", "1,045"]},
        {"label": "Per-share value", "values": ["0.07", "0.1"]},
    ])
    case("c09_varied_widths", "right-aligned numbers of different widths", "placed", [p])

    # 10. two tables side by side
    p = Page()
    table(p, left=40, col_rights=[200, 260], top=700, rows=[
        YEARS,
        {"label": "Revenue", "values": ["900", "850"]},
        {"label": "Costs", "values": ["610", "590"]},
        {"label": "Margin", "values": ["290", "260"]},
    ])
    table(p, left=320, col_rights=[500, 560], top=700, rows=[
        YEARS,
        {"label": "Headcount", "values": ["120", "112"]},
        {"label": "Sites", "values": ["4", "4"]},
        {"label": "Countries", "values": ["3", "2"]},
    ])
    case("c10_side_by_side", "two tables side by side", "placed", [p])

    # 11. rotated page (/Rotate 90)
    p = Page(rotate=90)
    table(p, left=72, col_rights=[430, 520], top=700, rows=[
        YEARS,
        {"label": "Revenue", "values": ["12,345", "11,002"]},
        {"label": "Costs", "values": ["7,210", "6,998"]},
    ])
    case("c11_rotated_page", "rotated page (/Rotate 90)", "refused", [p])

    # 12. text turned 90 degrees by the text matrix on an unrotated page
    p = Page()
    table(p, left=100, col_rights=[300, 360], top=500, rotate90=True, rows=[
        YEARS,
        {"label": "Revenue", "values": ["12,345", "11,002"]},
        {"label": "Costs", "values": ["7,210", "6,998"]},
    ])
    case("c12_rotated_text", "glyphs rotated by the text matrix", "refused", [p])

    # 13. a table continued on the next page (no repeated header)
    p1, p2 = Page(), Page()
    table(p1, left=72, col_rights=[430, 520], top=200, rows=[
        YEARS,
        {"label": "Revenue", "values": ["12,345", "11,002"]},
        {"label": "Cost of revenue", "values": ["7,210", "6,998"]},
    ])
    table(p2, left=72, col_rights=[430, 520], top=740, rows=[
        {"label": "Selling expenses", "values": ["1,020", "980"]},
        {"label": "Administrative expenses", "values": ["870", "845"]},
        {"label": "Operating income", "values": ["3,225", "2,179"]},
    ])
    case("c13_continued_next_page", "table continued on the next page", "placed", [p1, p2],
         "each page fragment is its own table; joining across pages is not attempted")

    # 14. running prose above and below, prose that contains numbers
    p = Page()
    y = prose(p, 740, PROSE)
    table(p, left=72, col_rights=[430, 520], top=y - 24, rows=[
        YEARS,
        {"label": "Revenue", "values": ["4,512", "4,028"]},
        {"label": "Operating income", "values": ["610", "540"]},
        {"label": "Net income", "values": ["402", "377"]},
    ])
    prose(p, y - 24 - 4 * 12 - 24, ["Net income attributable to the parent was 402 in 2026 (377 in 2025), see Note 7.",
                                    "The remaining 2 items are immaterial."])
    case("c14_prose_around", "running prose around the table", "placed", [p])

    # 15. blank cells
    p = Page()
    table(p, left=72, col_rights=[430, 520], top=700, rows=[
        YEARS,
        {"label": "Revenue", "values": ["12,345", "11,002"]},
        {"label": "Discontinued operations", "values": [None, "(410)"]},
        {"label": "Restructuring", "values": ["(220)", None]},
        {"label": "Net income", "values": ["2,475", "2,232"]},
    ])
    case("c15_blank_cells", "blank cells", "placed", [p])

    # 16. centre-aligned numbers
    p = Page()
    table(p, left=72, col_rights=[430, 520], top=700, align="centre", rows=[
        YEARS,
        {"label": "Employees", "values": ["1,204", "998"]},
        {"label": "Sites", "values": ["7", "6"]},
        {"label": "Average tenure", "values": ["5.4", "5.1"]},
    ])
    case("c16_centred_numbers", "centre-aligned numbers", "placed", [p])

    # ---- adversarial shapes: the reader must refuse, or the measurement shows where it fails ----

    # 17. one value so wide it reaches into the next column's band
    p = Page()
    table(p, left=72, col_rights=[400, 450], top=700, rows=[
        YEARS,
        {"label": "Revenue", "values": ["12,345", "11,002"]},
        {"label": "Notional amount", "values": ["1,100", "1,234,567,890.00"]},
        {"label": "Costs", "values": ["7,210", "6,998"]},
    ])
    case("c17_wide_value_overlap", "a value reaching into the next column", "refused", [p])

    # 18. one column whose values alternate between two x positions that never overlap
    p = Page()
    table(p, left=72, col_rights=[400, 520], top=700, rows=[
        YEARS,
        {"label": "Revenue", "values": ["12,345", "11,002"]},
        {"label": "Costs", "values": ["7,210", "6,998"], "value_x": {0: 360}},
        {"label": "Margin", "values": ["5,135", "4,004"]},
        {"label": "Tax", "values": ["1,030", "880"], "value_x": {0: 360}},
    ])
    case("c18_staggered_column", "one column at two non-overlapping x positions", "refused", [p])

    # 19. a label long enough to run under the first value column
    p = Page()
    table(p, left=72, col_rights=[300, 400], top=700, rows=[
        YEARS,
        {"label": "Revenue", "values": ["12,345", "11,002"]},
        {"label": "Amortisation of acquired intangible assets and goodwill", "values": [None, "998"]},
        {"label": "Costs", "values": ["7,210", "6,998"]},
    ])
    case("c19_label_overrun", "a label running under the first value column", "refused", [p])

    # 20. a short prose line set directly above the table, same size and leading as the table
    p = Page()
    p.text(72, 712, "Selected figures:", 9.0)
    table(p, left=72, col_rights=[430, 520], top=700, rows=[
        YEARS,
        {"label": "Revenue", "values": ["12,345", "11,002"]},
        {"label": "Costs", "values": ["7,210", "6,998"]},
    ])
    case("c20_tight_caption", "a short caption line at table size and pitch directly above", "placed", [p],
         "geometry cannot tell this line from a section label; expected to show as a spurious row")

    # 21. a label-only line at the same pitch between two tables stacked vertically
    p = Page()
    y = table(p, left=72, col_rights=[430, 520], top=700, rows=[
        YEARS,
        {"label": "Revenue", "values": ["12,345", "11,002"]},
        {"label": "Costs", "values": ["7,210", "6,998"]},
    ])
    table(p, left=72, col_rights=[430, 520], top=y, rows=[
        {"label": "Segment B"},
        {"label": "Revenue", "values": ["2,100", "1,980"]},
        {"label": "Costs", "values": ["1,400", "1,390"]},
    ])
    case("c21_stacked_tables", "two tables stacked at row pitch, no gap", "placed", [p],
         "expected to merge into one table: rows of the second table are off by the merge")

    # 22. negative control: prose only, with numbers in it -> no table
    p = Page()
    prose(p, 740, PROSE + ["Total headcount was 1,204 at year end, up from 998.", "12,345", "Page 4 of 10"])
    case("c22_prose_only", "prose with numbers, no table", "none", [p])

    # 23. negative control: two text columns (newspaper layout) with numbers inside the text
    p = Page()
    left_col = ["Revenue rose 12% to 4,512 in", "2026, driven by new contracts", "in three of our 7 regions."]
    right_col = ["Costs fell to 3,902 as the", "group closed 2 sites and cut", "travel by 18% over the year."]
    for k, (a, b) in enumerate(zip(left_col, right_col)):
        p.text(72, 700 - 12 * k, a, 9.0)
        p.text(320, 700 - 12 * k, b, 9.0)
    case("c23_two_text_columns", "two prose columns with numbers, no table", "none", [p])
    return out
