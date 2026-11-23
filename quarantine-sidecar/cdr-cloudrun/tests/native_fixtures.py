"""Hand-written OOXML packages for the native reader tests: every byte of each package is chosen here.

No workbook library writes these: openpyxl, for one, always writes `fullCalcOnLoad="1"`, which
would make every cached value look declared-stale. Each builder returns the package bytes.
"""

from __future__ import annotations

import hashlib
import io
import zipfile

SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
OFFICE_DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
WORKSHEET_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def digest(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def sheet_xml(cells: str, merges: str = "") -> str:
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="{SPREADSHEET_NS}"><sheetData>{cells}</sheetData>{merges}</worksheet>'


def xlsx(
    sheets: list[tuple[str, str, str]],
    *,
    calc_pr: str = "",
    content_type_override: str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    extra_members: dict[str, bytes] | None = None,
    workbook_rels_extra: str = "",
    compression: int = zipfile.ZIP_DEFLATED,
    workbook_name: str = "workbook.xml",
) -> bytes:
    """`sheets` is (name, state, worksheet xml). `state` is "visible", "hidden" or "veryHidden"."""
    sheet_entries = "".join(
        f'<sheet name="{name}" sheetId="{index + 1}" r:id="rId{index + 1}"'
        + ("" if state == "visible" else f' state="{state}"')
        + "/>"
        for index, (name, state, _xml) in enumerate(sheets)
    )
    workbook = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="{SPREADSHEET_NS}" xmlns:r="{REL_NS}">'
        f"<sheets>{sheet_entries}</sheets>{calc_pr}</workbook>"
    )
    workbook_rels = "".join(
        f'<Relationship Id="rId{index + 1}" Type="{WORKSHEET_REL}" Target="worksheets/sheet{index + 1}.xml"/>'
        for index in range(len(sheets))
    )
    overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{index + 1}.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for index in range(len(sheets))
    )
    members = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            f'<Override PartName="/xl/{workbook_name}" ContentType="{content_type_override}"/>{overrides}</Types>'
        ).encode(),
        "_rels/.rels": (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{PKG_REL_NS}">'
            f'<Relationship Id="rId1" Type="{OFFICE_DOC_REL}" Target="xl/{workbook_name}"/></Relationships>'
        ).encode(),
        f"xl/{workbook_name}": workbook.encode(),
        f"xl/_rels/{workbook_name}.rels": (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{PKG_REL_NS}">'
            f"{workbook_rels}{workbook_rels_extra}</Relationships>"
        ).encode(),
    }
    for index, (_name, _state, xml) in enumerate(sheets):
        members[f"xl/worksheets/sheet{index + 1}.xml"] = xml.encode()
    members.update(extra_members or {})
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression) as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


def with_member(package: bytes, name: str, payload: bytes, compression: int = zipfile.ZIP_DEFLATED) -> bytes:
    """The same package plus one more member, written under exactly `name`."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(package)) as source, zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            target.writestr(info, source.read(info))
        target.writestr(zipfile.ZipInfo(name), payload, compress_type=compression)
    return buffer.getvalue()


def docx_with_table() -> bytes:
    import docx  # python-docx, a reader dependency; only called when it is installed

    document = docx.Document()
    document.add_paragraph("Rate schedule")
    table = document.add_table(rows=3, cols=3)
    for row, values in enumerate((("Plan", "Rate", "Unit"), ("Basic", "1.25", "%"), ("Plus", "2.50", "%"))):
        for column, value in enumerate(values):
            table.cell(row, column).text = value
    table.cell(2, 0).merge(table.cell(2, 1)).text = "Plus merged"
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def pptx_with_table() -> bytes:
    from pptx import Presentation
    from pptx.util import Inches

    presentation = Presentation()
    presentation.slides.add_slide(presentation.slide_layouts[6])
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    shape = slide.shapes.add_table(2, 2, Inches(1), Inches(1), Inches(4), Inches(1))
    for row, values in enumerate((("Region", "Total"), ("North", "42"))):
        for column, value in enumerate(values):
            shape.table.cell(row, column).text = value
    buffer = io.BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()
