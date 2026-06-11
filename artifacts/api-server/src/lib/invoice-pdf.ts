import PDFDocument from "pdfkit";
import { fetchImageBufferSafe } from "./safe-fetch";

interface PdfLineItem {
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  lineTotal: number | string;
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
  paymentInstructions?: string | null;
  checkPayableTo?: string | null;
  zelleInfo?: string | null;
  venmoHandle?: string | null;
  cashAppTag?: string | null;
}

interface PdfInvoice {
  invoiceNumber: string;
  status: string;
  subtotal: number | string;
  tax: number | string;
  total: number | string;
  dueDate?: Date | string | null;
  notes?: string | null;
}

interface BuildInvoicePdfInput {
  invoice: PdfInvoice;
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

/**
 * Render an invoice to a PDF Buffer. Shared by the business dashboard route
 * and the customer portal route so both produce identical professional output.
 */
export async function buildInvoicePdf(input: BuildInvoicePdfInput): Promise<Buffer> {
  const { invoice: inv, customer, company, lineItems } = input;

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
          // If pdfkit can't render the logo format, fall back to text
          doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(companyName, margin, 28, { width: contentWidth * 0.6 });
        }
      } else {
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(22).text(companyName, margin, 28, { width: contentWidth * 0.6 });
      }

      // Company contact info (always shown, even when logo is present)
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

      // INVOICE label top-right
      doc.font("Helvetica-Bold").fontSize(28).fillColor("#ffffff").text("INVOICE", margin + contentWidth * 0.6, 22, { width: contentWidth * 0.4, align: "right" });
      doc.font("Helvetica").fontSize(10).fillColor("#ffffffcc").text(inv.invoiceNumber, margin + contentWidth * 0.6, 56, { width: contentWidth * 0.4, align: "right" });

      // Below header: bill to + invoice meta
      const infoY = 130;
      doc.fillColor("#111111");

      // Bill To
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("BILL TO", margin, infoY);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111").text(customerName, margin, infoY + 14);
      if (customer?.email) doc.font("Helvetica").fontSize(10).fillColor("#555555").text(customer.email, margin, infoY + 30);
      if (customer?.phone && customer.email !== customer.phone) doc.font("Helvetica").fontSize(10).fillColor("#555555").text(customer.phone, margin, infoY + (customer.email ? 44 : 30));

      // Invoice meta (right side)
      const metaX = margin + contentWidth * 0.6;
      const metaLabelW = 80;
      const metaValueW = contentWidth * 0.4 - metaLabelW;

      function metaRow(label: string, value: string, y: number) {
        doc.font("Helvetica").fontSize(10).fillColor("#888888").text(label, metaX, y, { width: metaLabelW, align: "left" });
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111").text(value, metaX + metaLabelW, y, { width: metaValueW, align: "right" });
      }

      metaRow("Invoice #", inv.invoiceNumber, infoY);
      if (inv.dueDate) {
        metaRow("Due Date", new Date(inv.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), infoY + 18);
      }
      metaRow("Status", inv.status.charAt(0).toUpperCase() + inv.status.slice(1), infoY + (inv.dueDate ? 36 : 18));

      // Line items table
      const tableY = infoY + 90;
      const colDesc = margin;
      const colQty = margin + contentWidth * 0.55;
      const colUnit = margin + contentWidth * 0.7;
      const colTotal = margin + contentWidth * 0.85;
      const colWidths = { desc: contentWidth * 0.55, qty: contentWidth * 0.15, unit: contentWidth * 0.15, total: contentWidth * 0.15 };

      // Table header
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
        doc.text(`$${Number(li.lineTotal).toFixed(2)}`, colTotal, rowY + 8, { width: colWidths.total, align: "right" });
        rowY += rowH;
      });

      // Border around table
      doc.rect(margin, tableY, contentWidth, rowY - tableY).strokeColor("#e5e7eb").lineWidth(1).stroke();

      // Totals block
      rowY += 12;
      const totalsX = margin + contentWidth * 0.6;
      const totalsW = contentWidth * 0.4;

      function totalRow(label: string, value: string, y: number, bold = false) {
        const font = bold ? "Helvetica-Bold" : "Helvetica";
        doc.font(font).fontSize(10).fillColor(bold ? "#111111" : "#555555").text(label, totalsX, y, { width: totalsW * 0.55 });
        doc.font(font).fontSize(10).fillColor(bold ? "#111111" : "#555555").text(value, totalsX + totalsW * 0.55, y, { width: totalsW * 0.45, align: "right" });
      }

      totalRow("Subtotal", `$${Number(inv.subtotal).toFixed(2)}`, rowY);
      totalRow("Tax", `$${Number(inv.tax).toFixed(2)}`, rowY + 18);

      // Total divider
      rowY += 36;
      doc.moveTo(totalsX, rowY).lineTo(totalsX + totalsW, rowY).strokeColor("#e5e7eb").lineWidth(1).stroke();
      rowY += 6;

      doc.font("Helvetica-Bold").fontSize(13).fillColor(`rgb(${pr},${pg},${pb})`).text("Total Due", totalsX, rowY, { width: totalsW * 0.55 });
      doc.font("Helvetica-Bold").fontSize(13).fillColor(`rgb(${pr},${pg},${pb})`).text(`$${Number(inv.total).toFixed(2)}`, totalsX + totalsW * 0.55, rowY, { width: totalsW * 0.45, align: "right" });

      // Notes
      if (inv.notes) {
        rowY += 50;
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("NOTES", margin, rowY);
        doc.font("Helvetica").fontSize(10).fillColor("#333333").text(inv.notes, margin, rowY + 14, { width: contentWidth * 0.55 });
      }

      // Payment instructions
      const paymentLines: string[] = [];
      if (company?.paymentInstructions) paymentLines.push(company.paymentInstructions);
      if (company?.checkPayableTo) paymentLines.push(`Check payable to: ${company.checkPayableTo}`);
      if (company?.zelleInfo) paymentLines.push(`Zelle: ${company.zelleInfo}`);
      if (company?.venmoHandle) paymentLines.push(`Venmo: ${company.venmoHandle}`);
      if (company?.cashAppTag) paymentLines.push(`Cash App: ${company.cashAppTag}`);

      if (paymentLines.length > 0) {
        const payY = inv.notes ? rowY + 70 : rowY + 50;
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#888888").text("PAYMENT INSTRUCTIONS", margin, payY);
        doc.font("Helvetica").fontSize(10).fillColor("#333333").text(paymentLines.join("\n"), margin, payY + 14, { width: contentWidth });
      }

      // Footer
      const footerY = doc.page.height - 50;
      doc.moveTo(margin, footerY).lineTo(pageWidth - margin, footerY).strokeColor("#e5e7eb").lineWidth(1).stroke();
      doc.font("Helvetica").fontSize(8).fillColor("#aaaaaa").text(`Thank you for your business — ${companyName}`, margin, footerY + 10, { width: contentWidth, align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
