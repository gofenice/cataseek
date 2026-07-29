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
const PRIMARY   = '#14201A'; // Cataseek Obsidian Dark
const ACCENT    = '#99C124'; // Cataseek Lime
const GREEN_ACC = '#719406'; // Cataseek Dark Green Accent
const WHITE     = '#FFFFFF';
const DARK      = '#14201A';
const MUTED     = '#5A6B61';
const LIGHT_BG  = '#F3F8F5';
const BORDER    = '#E3EAE5';
const GREEN     = '#719406';
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

// Draw a filled rounded rectangle
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
    // Single page, autoFirstPage=false
    const doc = new PDFDocument({
      size:          'A4',
      margin:        50,
      autoFirstPage: false,
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

    // Normalize company URL so merchant/public URLs never point to superadmin domain
    let companyUrlDisplay = data.companyUrl || process.env.FRONTEND_URL || 'https://console.cataseek.com';
    companyUrlDisplay = companyUrlDisplay.replace('admin.cataseek.com', 'console.cataseek.com');

    // ── 1. Header Band ────────────────────────────────────────────────────────
    const HDR_H = 80;
    doc.rect(0, 0, PW, HDR_H).fill(PRIMARY);
    y = 0;

    // Logo: try to fetch from logoUrl or FRONTEND_URL, fall back to styled brand text
    const consoleUrl = (process.env.FRONTEND_URL || 'https://console.cataseek.com').replace('admin.cataseek.com', 'console.cataseek.com').replace(/\/$/, '');
    const logoUrl = process.env.LOGO_URL || `${consoleUrl}/logo-white.png`;
    let logoLoaded = false;
    if (logoUrl) {
      try {
        const imgBuf = await fetchImage(logoUrl);
        doc.image(imgBuf, L, 16, { height: 48, fit: [140, 48] });
        logoLoaded = true;
      } catch { /* fall through to styled brand logo */ }
    }

    if (!logoLoaded) {
      // Draw a rounded dark-green square with lime 'C'
      const iconSize = 34;
      const iconX    = L;
      const iconY    = 23;
      roundedRect(doc, iconX, iconY, iconSize, iconSize, 8, GREEN_ACC);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(20)
         .text('C', iconX, iconY + 7, { width: iconSize, align: 'center' });

      // Company name next to icon
      const nameTitle = data.companyName && data.companyName.toLowerCase() !== 'cataseek' 
        ? data.companyName 
        : 'Cataseek';

      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(20)
         .text(nameTitle, iconX + iconSize + 12, iconY + 4, { lineBreak: false });
      doc.fillColor('#93A29A').font('Helvetica-Bold').fontSize(8.5)
         .text('INSTANT SEARCH FOR E-COMMERCE', iconX + iconSize + 12, iconY + 26, { characterSpacing: 0.5 });
    }

    // INVOICE label — top right of header
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(22)
       .text('INVOICE', 0, 20, { align: 'right', width: PW - L });
    doc.fillColor('#93A29A').font('Helvetica-Bold').fontSize(10)
       .text(data.invoiceNumber, 0, 46, { align: 'right', width: PW - L });

    y = HDR_H + 24;

    // ── 2. From / To Addresses ────────────────────────────────────────────────
    const COL_W = W / 2 - 16;

    // FROM column
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
       .text('FROM', L, y, { characterSpacing: 1.5, width: COL_W });
    y += 14;
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11)
       .text(data.companyName, L, y, { width: COL_W });
    y += 16;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9.5)
       .text(data.companyEmail, L, y, { width: COL_W, ellipsis: true });
    if (companyUrlDisplay) {
      y += 14;
      doc.text(companyUrlDisplay.replace(/^https?:\/\//, ''), L, y, { width: COL_W, ellipsis: true });
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

    // TO column
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
      { label: 'ISSUE DATE', value: data.issueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
      { label: 'DUE DATE',   value: data.dueDate ? data.dueDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Upon Receipt' },
      { label: 'STATUS',     value: data.status.toUpperCase(), color: data.status === 'paid' ? GREEN : data.status === 'failed' ? RED : AMBER },
    ];

    const metaColW = W / metaItems.length;
    metaItems.forEach((m, i) => {
      const mx = L + i * metaColW;
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5).text(m.label, mx, y, { characterSpacing: 1, width: metaColW - 8 });
      doc.fillColor(m.color || DARK).font('Helvetica-Bold').fontSize(11).text(m.value, mx, y + 14, { width: metaColW - 8 });
    });

    y += 44;

    // ── 5. Line Items Table ───────────────────────────────────────────────────
    doc.rect(L, y, W, 26).fill(LIGHT_BG);
    // Left accent bar in Cataseek Lime Green
    doc.rect(L, y, 4, 26).fill(ACCENT);

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

    // ── 6. Totals ─────────────────────────────────────────────────────────────
    const taxRate = data.taxRatePercent && data.taxRatePercent > 0 ? data.taxRatePercent : 0;
    const grandTotal = subtotal;
    const net = taxRate > 0 ? grandTotal / (1 + taxRate / 100) : grandTotal;
    const taxAmount = grandTotal - net;
    const cs = sym(data.currency);

    const TOT_W = 220;
    if (taxRate > 0) {
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
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('TOTAL DUE', R - TOT_W + 12, y + 8, { width: TOT_W - 16, characterSpacing: 1 });
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(15)
       .text(`${cs}${grandTotal.toFixed(2)} ${data.currency}`, R - TOT_W + 12, y + 18, { width: TOT_W - 24, align: 'right' });

    y += TOT_H + (taxRate > 0 ? 10 : 28);
    if (taxRate > 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
         .text('Amounts are inclusive of tax.', R - TOT_W, y, { width: TOT_W, align: 'right' });
      y += 22;
    }

    // ── 7. Footer ─────────────────────────────────────────────────────────────
    doc.rect(L, y, W, 1).fill(BORDER);
    y += 14;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
       .text(
         `Thank you for your business! Questions? Contact ${data.companyEmail}.`,
         L, y, { align: 'center', width: W }
       );
    y += 14;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
       .text(
         `\u00A9 ${new Date().getFullYear()} ${data.companyName}  \u00B7  ${data.invoiceNumber}`,
         L, y, { align: 'center', width: W }
       );

    doc.end();
  });
}
