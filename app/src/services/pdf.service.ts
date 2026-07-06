import PDFDocument from 'pdfkit';
import https from 'https';
import http from 'http';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface InvoiceData {
  invoiceNumber: string;
  issueDate:     Date;
  dueDate?:      Date;
  status:        'paid' | 'pending' | 'failed';
  // Seller
  companyName:   string;
  companyEmail:  string;
  companyUrl?:   string;
  companyAddress?: string;
  companyGstin?: string;
  // Buyer (tenant)
  storeName:     string;
  storeEmail:    string;
  storeDomain?:  string;
  // Line items
  lineItems: {
    description: string;
    period?:     string;
    amount:      number;
  }[];
  currency: string;
  // Tax (optional). If taxRatePercent > 0, amounts are treated as tax-inclusive
  // and the breakdown is shown.
  taxRatePercent?: number;
  taxLabel?: string; // e.g. "GST"
}

// Currency symbol for the amounts. Falls back to the ISO code.
const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: 'Rs. ', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$',
};
const sym = (c: string) => CURRENCY_SYMBOLS[c] || `${c} `;

// ─── Colour palette ───────────────────────────────────────────────────────────
const PRIMARY   = '#4F46E5';
const WHITE     = '#FFFFFF';
const DARK      = '#1E293B';
const MUTED     = '#64748B';
const LIGHT_BG  = '#F8FAFC';
const BORDER    = '#E2E8F0';
const GREEN     = '#10B981';
const AMBER     = '#F59E0B';
const RED       = '#EF4444';

// Fetch a remote image into a Buffer
function fetchImage(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Draw a filled rounded rectangle (pdfkit doesn't have roundedRect fill shorthand)
function roundedRect(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  r: number, fillColor: string,
) {
  doc.roundedRect(x, y, w, h, r).fill(fillColor);
}

// ─── Main generator ───────────────────────────────────────────────────────────
export function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    // Single page, autoFirstPage=false so we control it — we'll add one page manually
    const doc = new PDFDocument({
      size:          'A4',
      margin:        50,
      autoFirstPage: false,  // prevent auto-adding a page before we configure
      bufferPages:   true,
    });
    doc.addPage();

    const chunks: Buffer[] = [];
    doc.on('data',  (c) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = doc.page.width;   // 595
    const L  = 50;               // left margin
    const R  = PW - 50;          // right edge
    const W  = R - L;            // usable width = 495
    let   y  = 0;                // current Y cursor

    // ── 1. Header Band ────────────────────────────────────────────────────────
    const HDR_H = 80;
    doc.rect(0, 0, PW, HDR_H).fill(PRIMARY);
    y = 0;

    // Logo: try to fetch from the configured FRONTEND_URL, fall back to styled text
    const logoUrl = process.env.LOGO_URL || '';
    let logoLoaded = false;
    if (logoUrl) {
      try {
        const imgBuf = await fetchImage(logoUrl);
        doc.image(imgBuf, L, 16, { height: 48, fit: [120, 48] });
        logoLoaded = true;
      } catch { /* fall through to text logo */ }
    }

    if (!logoLoaded) {
      // Draw a small indigo square with "C" as the icon (mirrors the sidebar logo)
      const iconSize = 32;
      const iconX    = L;
      const iconY    = 24;
      roundedRect(doc, iconX, iconY, iconSize, iconSize, 6, 'rgba(255,255,255,0.25)');
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(18)
         .text('C', iconX, iconY + 7, { width: iconSize, align: 'center' });
      // Company name next to icon
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(20)
         .text(data.companyName, iconX + iconSize + 10, iconY + 5, { lineBreak: false });
      doc.fillColor('rgba(255,255,255,0.7)').font('Helvetica').fontSize(9)
         .text('AI-Powered E-Commerce Search', iconX + iconSize + 10, iconY + 28);
    }

    // INVOICE label — top right of header
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(24)
       .text('INVOICE', 0, 18, { align: 'right', width: PW - L });
    doc.fillColor('rgba(255,255,255,0.7)').font('Helvetica').fontSize(10)
       .text(data.invoiceNumber, 0, 46, { align: 'right', width: PW - L });

    y = HDR_H + 24;

    // ── 2. From / To Addresses ────────────────────────────────────────────────
    // Fixed column width prevents long domains from colliding
    const COL_W = W / 2 - 16; // each column gets half minus a gap

    // FROM column
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
       .text('FROM', L, y, { characterSpacing: 1.5, width: COL_W });
    y += 14;
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11)
       .text(data.companyName, L, y, { width: COL_W });
    y += 16;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
       .text(data.companyEmail, L, y, { width: COL_W, ellipsis: true });
    if (data.companyUrl) {
      y += 14;
      doc.text(data.companyUrl.replace(/^https?:\/\//, ''), L, y, { width: COL_W, ellipsis: true });
    }
    if (data.companyAddress) {
      y += 13;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(data.companyAddress, L, y, { width: COL_W });
      y += doc.heightOfString(data.companyAddress, { width: COL_W }) - 4;
    }
    if (data.companyGstin) {
      y += 13;
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5).text(`GSTIN: ${data.companyGstin}`, L, y, { width: COL_W });
    }

    // TO column (starts at exact midpoint — no overflow into FROM)
    const toX = L + W / 2 + 8;
    let   tyy = HDR_H + 24;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
       .text('TO', toX, tyy, { characterSpacing: 1.5, width: COL_W });
    tyy += 14;
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11)
       .text(data.storeName, toX, tyy, { width: COL_W });
    tyy += 16;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
       .text(data.storeEmail, toX, tyy, { width: COL_W, ellipsis: true });
    if (data.storeDomain) {
      tyy += 14;
      doc.text(data.storeDomain.replace(/^https?:\/\//, ''), toX, tyy, { width: COL_W, ellipsis: true });
    }

    y = Math.max(y, tyy) + 24;

    // ── 3. Divider ─────────────────────────────────────────────────────────────
    doc.rect(L, y, W, 1).fill(BORDER);
    y += 16;

    // ── 4. Meta row (Issue Date / Due Date / Status) ──────────────────────────
    const metaItems = [
      { label: 'Issue Date', value: data.issueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
      { label: 'Due Date',   value: data.dueDate ? data.dueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Upon Receipt' },
      { label: 'Status',     value: data.status.toUpperCase(), color: data.status === 'paid' ? GREEN : data.status === 'failed' ? RED : AMBER },
    ];

    const metaColW = W / metaItems.length;
    metaItems.forEach((m, i) => {
      const mx = L + i * metaColW;
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text(m.label, mx, y, { characterSpacing: 1, width: metaColW - 8 });
      doc.fillColor(m.color || DARK).font('Helvetica-Bold').fontSize(11).text(m.value, mx, y + 14, { width: metaColW - 8 });
    });

    y += 44;

    // ── 5. Line Items Table ───────────────────────────────────────────────────
    // Table header
    doc.rect(L, y, W, 26).fill(LIGHT_BG);
    // Left accent bar
    doc.rect(L, y, 4, 26).fill(PRIMARY);

    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
    doc.text('DESCRIPTION',           L + 12, y + 9, { characterSpacing: 0.8, width: 240 });
    doc.text('PERIOD',                L + 280, y + 9, { characterSpacing: 0.8, width: 120 });
    doc.text(`AMOUNT (${data.currency})`, L + W - 90, y + 9, { characterSpacing: 0.8, width: 90, align: 'right' });

    y += 26;
    let subtotal = 0;

    data.lineItems.forEach((item, i) => {
      const rowH = 30;
      doc.rect(L, y, W, rowH).fill(i % 2 === 0 ? WHITE : LIGHT_BG);
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
         .text(item.description, L + 12, y + 9, { width: 240, lineBreak: false });
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
         .text(item.period || '\u2014', L + 280, y + 10, { width: 120, lineBreak: false });
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
         .text(`${sym(data.currency)}${item.amount.toFixed(2)}`, L + W - 90, y + 9, { width: 90, align: 'right', lineBreak: false });
      subtotal += item.amount;
      y += rowH;
    });

    // Table bottom border
    doc.rect(L, y, W, 1).fill(BORDER);
    y += 14;

    // ── 6. Totals (with optional tax breakdown) ───────────────────────────────
    // Amounts are tax-inclusive: net = total / (1 + rate), tax = total - net.
    const taxRate = data.taxRatePercent && data.taxRatePercent > 0 ? data.taxRatePercent : 0;
    const grandTotal = subtotal;
    const net = taxRate > 0 ? grandTotal / (1 + taxRate / 100) : grandTotal;
    const taxAmount = grandTotal - net;
    const cs = sym(data.currency);

    const TOT_W = 220;
    if (taxRate > 0) {
      // Net + tax rows above the total box
      const rowLabel = (label: string, value: string, yy: number) => {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9)
           .text(label, R - TOT_W, yy, { width: TOT_W - 90 });
        doc.fillColor(DARK).font('Helvetica').fontSize(9)
           .text(value, R - 90, yy, { width: 90, align: 'right' });
      };
      rowLabel('Taxable value', `${cs}${net.toFixed(2)}`, y);
      y += 16;
      rowLabel(`${data.taxLabel || 'Tax'} (${taxRate}%)`, `${cs}${taxAmount.toFixed(2)}`, y);
      y += 18;
    }

    const TOT_H = 38;
    roundedRect(doc, R - TOT_W, y, TOT_W, TOT_H, 6, LIGHT_BG);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('TOTAL DUE', R - TOT_W + 12, y + 8, { width: TOT_W - 16, characterSpacing: 1 });
    doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(15)
       .text(`${cs}${grandTotal.toFixed(2)} ${data.currency}`, R - TOT_W + 12, y + 20, { width: TOT_W - 24, align: 'right' });

    y += TOT_H + (taxRate > 0 ? 10 : 28);
    if (taxRate > 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
         .text('Amounts are inclusive of tax.', R - TOT_W, y, { width: TOT_W, align: 'right' });
      y += 22;
    }

    // ── 7. Footer (drawn immediately after content, not at page bottom) ───────
    doc.rect(L, y, W, 1).fill(BORDER);
    y += 14;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
       .text(
         `Thank you for your business! Questions? Contact ${data.companyEmail}.`,
         L, y, { align: 'center', width: W }
       );
    y += 14;
    doc.fillColor(BORDER).font('Helvetica').fontSize(8)
       .text(
         `\u00A9 ${new Date().getFullYear()} ${data.companyName}  \u00B7  ${data.invoiceNumber}`,
         L, y, { align: 'center', width: W }
       );

    doc.end();
  });
}
