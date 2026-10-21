/* Reading export of the Markdown handoff. No application/provider access. */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const requireApi = createRequire(path.resolve(__dirname, "../artifacts/api-server/package.json"));
const PDFDocument = requireApi("pdfkit");
const dir = path.resolve(__dirname, "../generated-artifacts/claude-handoff");
const blocks = JSON.parse(fs.readFileSync(path.join(dir, "handoff-blocks.json"), "utf8"));
const filename = path.join(dir, "GreenSynk-Claude-Engineering-Handoff.pdf");
const doc = new PDFDocument({
  size: "LETTER", bufferPages: true,
  margins: { top: 54, bottom: 64, left: 48, right: 48 },
  info: { Title: "GreenSynk - Claude Engineering Handoff and Safe Development Protocol",
    Author: "GreenSynk", Subject: "Verified baseline, architecture, backlog, validation and safe Git exchange" },
});
const output = fs.createWriteStream(filename);
doc.pipe(output);
const W = 516, MAX = 722;
let section = "Engineering handoff", first = true;
const pages = new Map([[0, section]]);
doc.on("pageAdded", () => pages.set(doc.bufferedPageRange().count - 1, section));
const clean = s => s.replace(/\*\*/g, "").replace(/`/g, "")
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/→/g, " > ").replace(/≥/g, ">=").replace(/≤/g, "<=");
function font(size = 9.3, bold = false) {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
}
function ensure(height) {
  if (doc.y + height > MAX) doc.addPage();
}
function heading(b) {
  const text = clean(b.text);
  if (b.level === 1) {
    section = text;
    if (!first) doc.addPage();
    first = false;
    pages.set(doc.bufferedPageRange().count - 1, section);
    doc.outline.addItem(text);
    doc.rect(48, doc.y, W, 4).fill("#059669");
    doc.y += 17;
    font(24, true);
    doc.fillColor("#065f46").text(text, 48, doc.y, { width: W, lineGap: 3 });
    doc.y += 13;
    return;
  }
  font(b.level === 2 ? 14.5 : 11.5, true);
  const h = doc.heightOfString(text, { width: W, lineGap: 2 });
  ensure(h + 65);
  doc.y += 7;
  doc.fillColor("#065f46").text(text, 48, doc.y, { width: W, lineGap: 2 });
  doc.y += 8;
}
function paragraph(b) {
  const text = clean(b.text), code = /^`.*`$/.test(b.text);
  const size = code ? 8.3 : 9.3;
  if (code) doc.font("Courier").fontSize(size);
  else font(size);
  const options = { width: W, lineGap: 2.7 };
  const h = doc.heightOfString(text, options);
  if (h < 600) ensure(h + 7);
  doc.fillColor("#243c31").text(text, 48, doc.y, options);
  doc.y += b.type === "list" ? 4 : 8;
}
function table(rows) {
  const n = rows[0].length;
  let widths = Array(n).fill(W / n);
  if (n === 2) widths = [175, 341];
  if (n === 3) widths = [123, 150, 243];
  if (n === 4) widths = [104, 193, 113, 106];
  function height(row, header) {
    font(7.6, header);
    return Math.max(...row.map((v, i) => doc.heightOfString(clean(v), {
      width: widths[i] - 12, lineGap: 2,
    }))) + 13;
  }
  function draw(row, index, header) {
    const y = doc.y, h = height(row, header);
    doc.rect(48, y, W, h).fill(header ? "#e2f1e8" : index % 2 ? "#ffffff" : "#f4f8f5");
    let x = 48;
    for (let i = 0; i < n; i++) {
      font(7.6, header);
      doc.fillColor("#243c31").text(clean(row[i]), x + 6, y + 6, {
        width: widths[i] - 12, lineGap: 2,
      });
      x += widths[i];
    }
    doc.moveTo(48, y + h).lineTo(564, y + h).lineWidth(0.4).strokeColor("#cddfd2").stroke();
    doc.y = y + h; doc.x = 48;
  }
  ensure(height(rows[0], true) + (rows[1] ? height(rows[1], false) : 0));
  draw(rows[0], 0, true);
  for (let i = 1; i < rows.length; i++) {
    if (doc.y + height(rows[i], false) > MAX) {
      doc.addPage(); draw(rows[0], 0, true);
    }
    draw(rows[i], i, false);
  }
  doc.y += 11;
}
for (const b of blocks) {
  if (b.type === "heading") heading(b);
  else if (b.type === "table") table(b.rows);
  else paragraph(b);
}
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(i);
  doc.page.margins.bottom = 0;
  font(7.2);
  doc.fillColor("#64796e").text("GREENSYNK / " + (pages.get(i) || section), 48, 28, {
    width: W, height: 12, ellipsis: true, lineBreak: false,
  });
  doc.moveTo(48, 745).lineTo(564, 745).lineWidth(0.5).strokeColor("#cbded4").stroke();
  font(7.5);
  doc.fillColor("#64796e").text("Handoff preparation only | October 21, 2026", 48, 757, {
    width: 390, lineBreak: false,
  });
  doc.text(`${i + 1} / ${range.count}`, 490, 757, { width: 74, align: "right", lineBreak: false });
}
doc.end();
output.on("finish", () => console.log(JSON.stringify({
  filename, pages: range.count, bytes: fs.statSync(filename).size,
})));
