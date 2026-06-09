import PDFDocument from "pdfkit";
import { fetchImageBufferSafe } from "./safe-fetch";

interface PdfLineItem {
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  total: number | string;
}

interface PdfCustomer {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface PdfCompany {
  name?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

interface PdfEstimate {
  estimateNumber: string;
  status: string;
  subtotal: number | string;
  tax: number | string;
  total: number | string;
  validUntil?: Date | string | null;
  notes?: string | null;
  signedAt?: Date | string | null;
  signerName?: string | null;
  signatureData?: string | null;
}

interface BuildEstimatePdfInput {
  estimate: PdfEstimate;
  customer?: PdfCustomer | null;
  company?: PdfCompany | null;
  lineItems: PdfLineItem[];
}

function isValidHex(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace("#", "");
  const bigint = parseInt(cleaned, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function decodeSignature(signatureData: string): Buffer | null {
  try {
    const base64 = signatureData.includes(",") ? signatureData.split(",")[1] : signatureData;
    if (!base64) return null;
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}

/**
 * Render an estimate (optionally signed) to a PDF Buffer.
 * Mirrors the invoice PDF layout and adds a signature block when the
 * estimate has been signed/accepted.
 */
export async function buildEstimatePdf(input: BuildEstimatePdfInput): Promise<Buffer> {
  const { estimate, customer, company, lineItems } = input;

  const customerName = customer
    ? (`${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || customer.phone || "Customer")
    : "Customer";
  const companyName = company?.name || "Your Service Provider";

  const rawColor = company?.primaryColor ?? "";
  const primaryHex = isValidHex(rawColor) ? rawColor : "#16a34a";
  const [pr, pg, pb] = hexToRgb(primaryHex);

  // Fetch company logo if available (SSRF-guarded against tenant-supplied URLs)
  const logoBuffer: Buffer | null = company?.logoUrl ? await fetchImageBufferSafe(company.logoUrl) : null;

  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "LETTER" });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width;
      const margin = 50;
      const contentWidth = pageWidth - margin * 2;

      // Header band
      doc.rect(0, 0, pageWidth, 110).fill(primaryHex);

      // Logo or company name in header
      const logoMaxH = 54;
      const logoMaxW = contentWidth * 0.35;
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, margin, 28, { fit: [logoMaxW, logoMaxH], valign: "center" });
        } catch {
          doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(companyName, margin, 28, { width: contentWidth * 0.6 });
        }
      } else {
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(companyName, margin, 28, { width: contentWidth * 0.6 });
      }

      // Company contact info
      const contactLines: string[] = [];
      if (company?.address) {
        const cityStateZip = [company.city, company.state, company.zip].filter(Boolean).join(", ");
        contactLines.push(company.address + (cityStateZip ? `, ${cityStateZip}` : ""));
      }
      if (company?.phone) contactLines.push(company.phone);
      if (company?.email) contactLines.push(company.email);
      if (contactLines.length > 0) {
        const contactY = logoBuffer ? 86 : 58;
        doc.font("Helvetica").fontSize(9).fillColor("#ffffff").text(contactLines.join("  ·  "), margin, contactY, { width: contentWidth * 0.65 });
      }

      // ESTIMATE label top-right
      doc.font("Helvetica-Bold").fontSize(28).fillColor("#ffffff").text("ESTIMATE", margin + contentWidth * 0.5, 22, { width: contentWidth * 0.5, align: "right" });
      doc.font("Helvetica").fontSize(10).fillColor("#ffffffcc").text(estimate.estimateNumber, margin + contentWidth * 0.5, 56, { width: contentWidth * 0.5, align: "right" });

      // Below header: prepared for + meta
      const infoY = 130;
      doc.fillColor("#111111");

      doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("PREPARED FOR", margin, infoY);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111").text(customerName, margin, infoY + 14);
      if (customer?.email) doc.font("Helvetica").fontSize(10).fillColor("#555555").text(customer.email, margin, infoY + 30);
      if (customer?.phone && customer.email !== customer.phone) doc.font("Helvetica").fontSize(10).fillColor("#555555").text(customer.phone, margin, infoY + (customer.email ? 44 : 30));

      // Estimate meta (right side)
      const metaX = margin + contentWidth * 0.6;
      const metaLabelW = 80;
      const metaValueW = contentWidth * 0.4 - metaLabelW;

      function metaRow(label: string, value: string, y: number) {
        doc.font("Helvetica").fontSize(10).fillColor("#888888").text(label, metaX, y, { width: metaLabelW, align: "left" });
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111").text(value, metaX + metaLabelW, y, { width: metaValueW, align: "right" });
      }

      let metaY = infoY;
      metaRow("Estimate #", estimate.estimateNumber, metaY);
      metaY += 18;
      if (estimate.validUntil) {
        metaRow("Valid Until", new Date(estimate.validUntil).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), metaY);
        metaY += 18;
      }
      const statusLabel = estimate.signedAt ? "Accepted" : (estimate.status.charAt(0).toUpperCase() + estimate.status.slice(1));
      metaRow("Status", statusLabel, metaY);

      // Line items table
      const tableY = infoY + 90;
      const colDesc = margin;
      const colQty = margin + contentWidth * 0.55;
      const colUnit = margin + contentWidth * 0.7;
      const colTotal = margin + contentWidth * 0.85;
      const colWidths = { desc: contentWidth * 0.55, qty: contentWidth * 0.15, unit: contentWidth * 0.15, total: contentWidth * 0.15 };

      doc.rect(margin, tableY, contentWidth, 24).fill(`rgb(${pr},${pg},${pb})`);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
      doc.text("DESCRIPTION", colDesc + 6, tableY + 7, { width: colWidths.desc });
      doc.text("QTY", colQty, tableY + 7, { width: colWidths.qty, align: "center" });
      doc.text("UNIT PRICE", colUnit, tableY + 7, { width: colWidths.unit, align: "right" });
      doc.text("TOTAL", colTotal, tableY + 7, { width: colWidths.total, align: "right" });

      let rowY = tableY + 24;
      lineItems.forEach((li, i) => {
        const rowH = 28;
        if (i % 2 === 1) doc.rect(margin, rowY, contentWidth, rowH).fill("#f9fafb");
        doc.font("Helvetica").fontSize(10).fillColor("#111111");
        doc.text(li.description || "—", colDesc + 6, rowY + 8, { width: colWidths.desc - 10 });
        doc.text(String(Number(li.quantity)), colQty, rowY + 8, { width: colWidths.qty, align: "center" });
        doc.text(`$${Number(li.unitPrice).toFixed(2)}`, colUnit, rowY + 8, { width: colWidths.unit, align: "right" });
        doc.text(`$${Number(li.total).toFixed(2)}`, colTotal, rowY + 8, { width: colWidths.total, align: "right" });
        rowY += rowH;
      });

      doc.rect(margin, tableY, contentWidth, rowY - tableY).strokeColor("#e5e7eb").lineWidth(1).stroke();

      // Totals block
      rowY += 12;
      const totalsX = margin + contentWidth * 0.6;
      const totalsW = contentWidth * 0.4;

      function totalRow(label: string, value: string, y: number) {
        doc.font("Helvetica").fontSize(10).fillColor("#555555").text(label, totalsX, y, { width: totalsW * 0.55 });
        doc.font("Helvetica").fontSize(10).fillColor("#555555").text(value, totalsX + totalsW * 0.55, y, { width: totalsW * 0.45, align: "right" });
      }

      totalRow("Subtotal", `$${Number(estimate.subtotal).toFixed(2)}`, rowY);
      totalRow("Tax", `$${Number(estimate.tax).toFixed(2)}`, rowY + 18);

      rowY += 36;
      doc.moveTo(totalsX, rowY).lineTo(totalsX + totalsW, rowY).strokeColor("#e5e7eb").lineWidth(1).stroke();
      rowY += 6;

      doc.font("Helvetica-Bold").fontSize(13).fillColor(`rgb(${pr},${pg},${pb})`).text("Total", totalsX, rowY, { width: totalsW * 0.55 });
      doc.font("Helvetica-Bold").fontSize(13).fillColor(`rgb(${pr},${pg},${pb})`).text(`$${Number(estimate.total).toFixed(2)}`, totalsX + totalsW * 0.55, rowY, { width: totalsW * 0.45, align: "right" });

      // Notes
      if (estimate.notes) {
        rowY += 50;
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("NOTES", margin, rowY);
        doc.font("Helvetica").fontSize(10).fillColor("#333333").text(estimate.notes, margin, rowY + 14, { width: contentWidth * 0.55 });
      }

      // Signature block (only when signed)
      if (estimate.signedAt && estimate.signatureData) {
        const sigBuffer = decodeSignature(estimate.signatureData);
        const sigY = rowY + (estimate.notes ? 80 : 50);
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("ACCEPTED & SIGNED", margin, sigY);
        if (sigBuffer) {
          try {
            doc.image(sigBuffer, margin, sigY + 16, { fit: [200, 70] });
          } catch {
            // Signature image could not be rendered; skip it
          }
        }
        const sigLineY = sigY + 92;
        doc.moveTo(margin, sigLineY).lineTo(margin + 220, sigLineY).strokeColor("#cccccc").lineWidth(1).stroke();
        const signedDate = new Date(estimate.signedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        doc.font("Helvetica").fontSize(9).fillColor("#555555").text(
          `${estimate.signerName || "Customer"} · Signed ${signedDate}`,
          margin,
          sigLineY + 6,
          { width: 280 },
        );
      }

      // Footer
      const footerY = doc.page.height - 50;
      doc.moveTo(margin, footerY).lineTo(pageWidth - margin, footerY).strokeColor("#e5e7eb").lineWidth(1).stroke();
      doc.font("Helvetica").fontSize(8).fillColor("#aaaaaa").text(`Thank you — ${companyName}`, margin, footerY + 10, { width: contentWidth, align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
