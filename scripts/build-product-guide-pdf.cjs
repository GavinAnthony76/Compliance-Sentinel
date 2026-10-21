/* Render the shared guide blocks using the API package's existing PDFKit. */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const requireApi = createRequire(path.join(root, "artifacts/api-server/package.json"));
const PDFDocument = requireApi("pdfkit");
const output = path.join(root, "generated-artifacts/greensynk-guide");
const blocks = JSON.parse(fs.readFileSync(path.join(output, "guide-blocks.json"), "utf8"));
const filename = path.join(output, "GreenSynk-Product-Workflows-and-Technical-Reference.pdf");
const doc = new PDFDocument({
  size: "LETTER", margins: { top: 58, bottom: 62, left: 54, right: 54 },
  bufferPages: true,
  info: { Title: "GreenSynk — Product, Workflows & Technical Reference",
    Author: "GreenSynk", Subject: "Product specifications, workflows, implementation and operations" },
});
const stream = fs.createWriteStream(filename);
doc.pipe(stream);
const W = 504;
const maxY = 724;
let section = "Product, Workflows & Technical Reference";
const pageSections = new Map([[0, section]]);
doc.on("pageAdded", () => pageSections.set(doc.bufferedPageRange().count - 1, section));
const plain = text => text.replace(/\*\*/g, "").replace(/`/g, "")
  .replace(/→/g, " > ").replace(/≥/g, ">=").replace(/≤/g, "<=");
function font(size = 10, bold = false) {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
}
function ensure(height) {
  if (doc.y + height > maxY) doc.addPage();
}
function paragraph(text, list = false) {
  font(10);
  text = plain(text);
  const indent = list ? 10 : 0;
  const opts = { width: W - indent, lineGap: 3, paragraphGap: 0 };
  const height = doc.heightOfString(text, opts);
  if (height < 600) ensure(height + 9);
  doc.fillColor("#20352c").text(text, 54 + indent, doc.y, opts);
  doc.y += list ? 5 : 10;
  doc.x = 54;
}
function heading(text, level) {
  text = plain(text);
  if (level === 1) {
    doc.rect(0, 0, 612, 14).fill("#059669");
    doc.y = 95;
    font(48, true);
    doc.fillColor("#065f46").text(text, 54, doc.y, { width: W });
    doc.y += 15;
    return;
  }
  if (text === "Product, Workflows & Technical Reference") {
    font(23, true);
    doc.fillColor("#047857").text(text, 54, doc.y, { width: W, lineGap: 4 });
    doc.y += 20;
    return;
  }
  if (level === 2) {
    section = text;
    doc.addPage();
    pageSections.set(doc.bufferedPageRange().count - 1, section);
    doc.outline.addItem(text);
    font(21, true);
    doc.fillColor("#065f46").text(text, 54, doc.y, { width: W, lineGap: 2 });
    doc.y += 17;
    return;
  }
  font(12, true);
  const height = doc.heightOfString(text, { width: W, lineGap: 2 });
  ensure(height + 60);
  doc.y += 8;
  doc.fillColor("#164d3b").text(text, 54, doc.y, { width: W, lineGap: 2 });
  doc.y += 9;
}
function table(rows) {
  const n = rows[0].length;
  let widths = Array(n).fill(W / n);
  if (n === 2) widths = [166, W - 166];
  if (n === 3) widths = [130, 174, 200];
  if (n === 7) widths = [50, 65, 59, 60, 92, 89, 89];
  if (n === 2 && rows[0][0] === "Method") widths = [55, 449];
  const size = n >= 6 ? 7.5 : 8.4;
  function rowHeight(row, header) {
    font(size, header);
    return Math.max(...row.map((v, i) =>
      doc.heightOfString(plain(v), { width: widths[i] - 14, lineGap: 2 }))) + 15;
  }
  function draw(row, index, header) {
    const height = rowHeight(row, header);
    const y = doc.y;
    doc.rect(54, y, W, height).fill(header ? "#e4f2e9" : index % 2 === 0 ? "#f5f9f6" : "#ffffff");
    let x = 54;
    row.forEach((cell, i) => {
      font(size, header);
      doc.fillColor(header ? "#065f46" : "#20352c").text(plain(cell), x + 7, y + 7, {
        width: widths[i] - 14, lineGap: 2,
      });
      x += widths[i];
    });
    doc.moveTo(54, y + height).lineTo(558, y + height).lineWidth(0.4).strokeColor("#d6e5da").stroke();
    doc.y = y + height;
    doc.x = 54;
  }
  ensure(rowHeight(rows[0], true) + (rows[1] ? rowHeight(rows[1], false) : 0));
  draw(rows[0], 0, true);
  for (let i = 1; i < rows.length; i++) {
    const height = rowHeight(rows[i], false);
    if (doc.y + height > maxY) {
      doc.addPage();
      draw(rows[0], 0, true);
    }
    draw(rows[i], i, false);
  }
  doc.y += 12;
}
for (const b of blocks) {
  if (b.type === "heading") heading(b.text, b.level);
  else if (b.type === "table") table(b.rows);
  else paragraph(b.text, b.type === "list");
}
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  if (i > 0) {
    font(7.5);
    doc.fillColor("#64796e").text("GREENSYNK  /  " + (pageSections.get(i) || section), 54, 31, {
      width: W, height: 14, ellipsis: true, lineBreak: false,
    });
  }
  doc.moveTo(54, 746).lineTo(558, 746).lineWidth(0.5).strokeColor("#cbded4").stroke();
  font(8);
  doc.fillColor("#64796e").text("Codebase reference • October 21, 2026", 54, 757, { width: 350, lineBreak: false });
  doc.text(`${i + 1} / ${range.count}`, 485, 757, { width: 73, align: "right", lineBreak: false });
  doc.page.margins.bottom = bottom;
}
doc.end();
stream.on("finish", () => console.log(JSON.stringify({ filename, pages: range.count, bytes: fs.statSync(filename).size })));
