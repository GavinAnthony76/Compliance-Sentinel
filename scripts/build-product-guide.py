"""Build downloadable GreenSynk documentation without additional dependencies."""

from pathlib import Path
import html
import json
import re
import zipfile
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "generated-artifacts" / "greensynk-guide"
SOURCE = ROOT / "docs" / "GREENSYNK_PRODUCT_AND_TECHNICAL_GUIDE.md"
OUT.mkdir(parents=True, exist_ok=True)


def appendices():
    routes_dir = ROOT / "artifacts/api-server/src/routes"
    index = (routes_dir / "index.ts").read_text()
    imports = dict(re.findall(r'import\s+(\w+)\s+from\s+"\.\/([^"]+)"', index))
    mounts = {}
    for prefix, variable in re.findall(r'router\.use\("([^"]+)",\s*(\w+)\)', index):
        if variable in imports:
            mounts[imports[variable]] = "/api" + prefix
    mounts.update({"health": "/api", "storage": "/api"})
    text = [
        "\n\n## Appendix A. API handler inventory\n",
        "Generated from Express router declarations in the current workspace. "
        "Router-level middleware notes are abbreviated. Inline checks, method-specific "
        "gates, validation, signature verification, and business logic still apply. "
        "Duplicate methods on a helper path are intentional. Paths are not a statement "
        "of external API product support.\n",
    ]
    count = 0
    for name, prefix in sorted(mounts.items()):
        path = routes_dir / (name + ".ts")
        code = path.read_text()
        handlers = re.findall(r'router\.(get|post|put|patch|delete)\("([^"]+)"', code)
        if not handlers:
            continue
        gates = re.findall(r"router\.use\((require\w+\([^;\n]*|require\w+)\);", code)
        text.append(f"\n### {name.replace('-', ' ').title()}\n")
        if gates:
            text.append("Router middleware: " + "; ".join(f"`{g}`" for g in gates) + ".\n")
        else:
            text.append("Authentication/validation: inspect per-handler and inline checks; "
                        "absence of router-wide middleware does not imply unrestricted access.\n")
        text.extend(["| Method | Path |", "| --- | --- |"])
        for method, route in handlers:
            count += 1
            full = prefix + (route if route != "/" else "")
            text.append(f"| {method.upper()} | `{full}` |")
        text.append("")
    text.append(f"\nTotal explicit router handler declarations inventoried: **{count}**.\n")
    text += [
        "\n## Appendix B. Database field reference\n",
        "Generated from application PostgreSQL table declarations. Field names below "
        "are application-side names, with declared PostgreSQL type functions. This is "
        "not a live schema diff, relationship audit, or data export. Fields containing "
        "password/token/provider references are listed by name only; no values are included.\n",
    ]
    tables = []
    for path in sorted((ROOT / "lib/db/src/schema").glob("*.ts")):
        code = path.read_text()
        for match in re.finditer(r'pgTable\("([^"]+)",\s*\{', code):
            tail = code[match.end():]
            end = re.search(r"^\}", tail, re.M)
            body = tail[:end.start()] if end else tail
            fields = re.findall(
                r'^\s{2}(\w+):\s*(serial|text|timestamp|boolean|integer|numeric|json|jsonb)\(',
                body, re.M,
            )
            tables.append((match.group(1), fields))
    for table, fields in sorted(tables):
        text.append(f"\n### {table}\n")
        text.append("; ".join(f"`{name}` ({kind})" for name, kind in fields) + ".\n")
    text.append(f"\nApplication table declarations inventoried: **{len(tables)}**.\n")
    return "\n".join(text), count, len(tables)


def parse_markdown(source):
    blocks, paragraph, table = [], [], []

    def flush_p():
        if paragraph:
            blocks.append({"type": "paragraph", "text": " ".join(paragraph)})
            paragraph.clear()

    def flush_t():
        if table:
            blocks.append({"type": "table", "rows": table.copy()})
            table.clear()

    for line in source.splitlines():
        if line.startswith("|"):
            flush_p()
            row = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if not all(re.fullmatch(r":?-+:?", cell) for cell in row):
                table.append(row)
            continue
        flush_t()
        if not line.strip():
            flush_p()
        elif re.match(r"^#{1,3} ", line):
            flush_p()
            marker, text = line.split(" ", 1)
            blocks.append({"type": "heading", "level": len(marker), "text": text})
        elif re.match(r"^(?:- |\d+\. )", line):
            flush_p()
            blocks.append({"type": "list", "text": line})
        else:
            paragraph.append(line)
    flush_p()
    flush_t()
    return blocks


def inline_html(text):
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    return re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)


def plain(text):
    return text.replace("**", "").replace("`", "")


def render_html(blocks):
    sections = []
    for i, block in enumerate(blocks):
        t = block["type"]
        if t == "heading":
            level = block["level"]
            sections.append(f'<h{level} id="section-{i}">{inline_html(block["text"])}</h{level}>')
        elif t == "table":
            rows = []
            for j, row in enumerate(block["rows"]):
                tag = "th" if j == 0 else "td"
                rows.append("<tr>" + "".join(f"<{tag}>{inline_html(c)}</{tag}>" for c in row) + "</tr>")
            sections.append("<table>" + "".join(rows) + "</table>")
        elif t == "list":
            sections.append('<p class="list">' + inline_html(block["text"]) + "</p>")
        else:
            sections.append("<p>" + inline_html(block["text"]) + "</p>")
    css = """
    :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f1f5f2;color:#20352c;font:16px/1.65 system-ui,sans-serif}
    main{max-width:1080px;margin:36px auto;padding:60px 64px;background:#fff;border-top:9px solid #059669;box-shadow:0 2px 25px #20352c12}
    h1{font-size:60px;letter-spacing:-2px;color:#065f46;margin:0}h2{font-size:28px;line-height:1.3;color:#065f46;margin-top:54px;padding-top:22px;border-top:1px solid #cbded4}
    h3{font-size:19px;color:#164d3b;margin:30px 0 10px}p{margin:12px 0}p.list{padding-left:18px;margin:6px 0}
    table{width:100%;border-collapse:collapse;font-size:13px;margin:20px 0;table-layout:fixed}th,td{padding:10px 12px;border:1px solid #dce6df;text-align:left;vertical-align:top;overflow-wrap:anywhere}
    th{background:#e8f4ed;color:#065f46}tr:nth-child(2n){background:#f7faf8}code{font:0.88em ui-monospace,monospace;overflow-wrap:anywhere}
    a{color:#047857}nav{padding:20px;background:#edf7f1}nav a{display:block;font-size:14px}
    @media(max-width:700px){main{margin:0;padding:25px}h1{font-size:44px}table{font-size:11px}td,th{padding:6px}}
    @media print{body{background:white;font-size:10pt}main{max-width:none;margin:0;padding:0;box-shadow:none;border:0}h2{break-before:page}h2,h3{break-after:avoid}tr{break-inside:avoid}}
    """
    nav = '<nav aria-label="Document navigation"><strong>Jump to a section</strong>' + "".join(
        f'<a href="#section-{i}">{inline_html(b["text"])}</a>'
        for i, b in enumerate(blocks) if b["type"] == "heading" and b["level"] == 2
        and b["text"] != "Product, Workflows & Technical Reference"
    ) + "</nav>"
    sections.insert(4, nav)
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GreenSynk — Product, Workflows & Technical Reference</title><style>' + css + "</style></head><body><main>" + "\n".join(sections) + "</main></body></html>"


def render_docx(blocks, filename):
    def runs(text, bold=False):
        out = []
        for piece in re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", text):
            code = piece.startswith("`") and piece.endswith("`")
            strong = piece.startswith("**") and piece.endswith("**")
            value = piece[1:-1] if code else piece[2:-2] if strong else piece
            props = ("<w:b/>" if bold or strong else "") + (
                '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/>' if code else "")
            out.append("<w:r><w:rPr>" + props + "</w:rPr><w:t xml:space=\"preserve\">" + escape(value) + "</w:t></w:r>")
        return "".join(out)

    def p(text, style="Normal", bold=False):
        return f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr>{runs(text, bold)}</w:p>'

    body = []
    for block in blocks:
        t = block["type"]
        if t == "heading":
            level = block["level"]
            style = "Title" if level == 1 else "Subtitle" if block["text"] == "Product, Workflows & Technical Reference" else "Heading1" if level == 2 else "Heading2"
            body.append(p(block["text"], style))
        elif t == "table":
            rows = block["rows"]
            n = len(rows[0])
            widths = [9360 // n] * n
            if n == 2:
                widths = [3000, 6360]
            grid = "<w:tblGrid>" + "".join(f'<w:gridCol w:w="{v}"/>' for v in widths) + "</w:tblGrid>"
            table = '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>' + "".join(f'<w:{edge} w:val="single" w:sz="4" w:color="D8E5DC"/>' for edge in ["top", "left", "bottom", "right", "insideH", "insideV"]) + "</w:tblBorders><w:tblCellMar><w:top w:w=\"80\" w:type=\"dxa\"/><w:left w:w=\"90\" w:type=\"dxa\"/><w:bottom w:w=\"80\" w:type=\"dxa\"/><w:right w:w=\"90\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr>" + grid
            for j, row in enumerate(rows):
                table += "<w:tr><w:trPr><w:cantSplit/>" + ("<w:tblHeader/>" if j == 0 else "") + "</w:trPr>"
                for k, cell in enumerate(row):
                    fill = "E8F4ED" if j == 0 else "F7FAF8" if j % 2 == 0 else "FFFFFF"
                    table += f'<w:tc><w:tcPr><w:tcW w:w="{widths[k]}" w:type="dxa"/><w:shd w:fill="{fill}"/></w:tcPr>' + p(cell, "TableText", j == 0) + "</w:tc>"
                table += "</w:tr>"
            body.append(table + "</w:tbl>" + p(""))
        else:
            body.append(p(block["text"], "ListParagraph" if t == "list" else "Normal"))
    section = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440"/></w:sectPr>'
    document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + "".join(body) + section + "</w:body></w:document>"
    styles = """<?xml version="1.0" encoding="UTF-8"?>
    <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="20352C"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="500" w:after="220"/></w:pPr><w:rPr><w:b/><w:sz w:val="80"/><w:color w:val="065F46"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:sz w:val="34"/><w:color w:val="047857"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:outlineLvl w:val="0"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="065F46"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/><w:spacing w:before="220" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="164D3B"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="180"/><w:spacing w:after="70"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
    </w:styles>"""
    content_types = """<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>"""
    root_rels = """<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"""
    doc_rels = """<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>"""
    footer = """<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="64796E"/></w:rPr><w:t>GreenSynk | Product &amp; Technical Reference | </w:t></w:r><w:fldSimple w:instr="PAGE"/></w:p></w:ftr>"""
    with zipfile.ZipFile(filename, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in {
            "[Content_Types].xml": content_types, "_rels/.rels": root_rels,
            "word/document.xml": document, "word/styles.xml": styles,
            "word/_rels/document.xml.rels": doc_rels, "word/footer1.xml": footer,
        }.items():
            z.writestr(name, data)


if __name__ == "__main__":
    appendix, endpoints, tables = appendices()
    full = SOURCE.read_text() + appendix
    blocks = parse_markdown(full)
    basename = "GreenSynk-Product-Workflows-and-Technical-Reference"
    (OUT / (basename + ".md")).write_text(full)
    (OUT / (basename + ".html")).write_text(render_html(blocks))
    (OUT / "guide-blocks.json").write_text(json.dumps(blocks, ensure_ascii=False, indent=2))
    render_docx(blocks, OUT / (basename + ".docx"))
    print(json.dumps({"words": len(full.split()), "api_handlers": endpoints,
                      "tables": tables, "blocks": len(blocks), "output": str(OUT)}, indent=2))
