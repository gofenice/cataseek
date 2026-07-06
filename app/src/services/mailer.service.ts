import nodemailer from 'nodemailer';

// ─── Transport ────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.mailtrap.io',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const FROM = process.env.SMTP_FROM || '"Cataseek" <no-reply@cataseek.com>';

// ─── 0. New Account Registration Welcome ─────────────────────────────────────
export async function sendRegistrationWelcomeEmail(
  to: string,
  storeName: string,
  trialEndsAt: Date,
) {
  const body = `
    <h2>Welcome to Cataseek! 🎉</h2>
    <p>Hi <strong>${storeName}</strong>,</p>
    <p>Your account has been created successfully. You're now on a <strong>free trial</strong> — explore all Cataseek features.</p>
    <div class="box">
      <p><strong>Trial ends:</strong> ${trialEndsAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
      <p><strong>What's next?</strong> Connect your store, sync your products, and test the search widget.</p>
    </div>
    <p>When you're ready to continue after the trial, head to your Billing page to choose a plan.</p>
    <a class="btn" href="${process.env.FRONTEND_URL || 'https://cataseek.com'}">Go to Dashboard →</a>
  `;
  await transporter.sendMail({
    from:    FROM,
    to,
    subject: `Welcome to Cataseek — your trial has started!`,
    html:    htmlWrap(body),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const htmlWrap = (body: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body  { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f4f6fb; margin:0; padding:0; }
    .wrap { max-width:600px; margin:32px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.08); }
    .hdr  { background:#4f46e5; padding:28px 40px; }
    .hdr h1 { color:#fff; margin:0; font-size:22px; letter-spacing:-0.02em; }
    .hdr p  { color:rgba(255,255,255,.75); margin:4px 0 0; font-size:13px; }
    .body { padding:32px 40px; color:#1e293b; font-size:15px; line-height:1.6; }
    .body h2 { font-size:18px; font-weight:700; margin:0 0 12px; }
    .box  { background:#f1f5f9; border-radius:8px; padding:16px 20px; margin:20px 0; }
    .box p { margin:6px 0; font-size:14px; }
    .box strong { color:#4f46e5; }
    .btn  { display:inline-block; background:#4f46e5; color:#fff !important; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:600; font-size:14px; margin:20px 0 0; }
    .ftr  { border-top:1px solid #e2e8f0; padding:20px 40px; font-size:12px; color:#94a3b8; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hdr">
      <h1>⚡ Cataseek</h1>
      <p>AI-Powered E-Commerce Search</p>
    </div>
    <div class="body">${body}</div>
    <div class="ftr">
      © ${new Date().getFullYear()} Cataseek · All rights reserved.<br/>
      This is an automated message, please do not reply.
    </div>
  </div>
</body>
</html>`;

// ─── 1. Welcome / New Subscription ────────────────────────────────────────────
export async function sendSubscriptionWelcomeEmail(
  to: string,
  storeName: string,
  planName: string,
  amount: number,
  periodEnd: Date,
) {
  const body = `
    <h2>Welcome to ${planName}! 🎉</h2>
    <p>Hi <strong>${storeName}</strong>,</p>
    <p>Your subscription has been activated. Here's a summary:</p>
    <div class="box">
      <p><strong>Plan:</strong> ${planName}</p>
      <p><strong>Amount:</strong> $${amount.toFixed(2)} USD</p>
      <p><strong>Next renewal:</strong> ${periodEnd.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
    <p>Your Cataseek search widget is now active. Head to your dashboard to start syncing products.</p>
    <a class="btn" href="${process.env.FRONTEND_URL || 'https://cataseek.com'}">Go to Dashboard →</a>
  `;
  await transporter.sendMail({
    from:    FROM,
    to,
    subject: `✅ Subscription Activated — ${planName}`,
    html:    htmlWrap(body),
  });
}

// ─── 2. Renewal Reminder (send ~3 days before period_end) ─────────────────────
export async function sendRenewalReminderEmail(
  to: string,
  storeName: string,
  planName: string,
  amount: number,
  renewalDate: Date,
) {
  const body = `
    <h2>Your subscription renews soon</h2>
    <p>Hi <strong>${storeName}</strong>,</p>
    <p>Just a heads-up that your <strong>${planName}</strong> subscription is due for renewal shortly.</p>
    <div class="box">
      <p><strong>Plan:</strong> ${planName}</p>
      <p><strong>Renewal amount:</strong> $${amount.toFixed(2)} USD</p>
      <p><strong>Renewal date:</strong> ${renewalDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
    <a class="btn" href="${process.env.FRONTEND_URL || 'https://cataseek.com'}/billing">Manage Subscription →</a>
  `;
  await transporter.sendMail({
    from:    FROM,
    to,
    subject: `⏰ Renewal Reminder — ${planName} renews on ${renewalDate.toLocaleDateString()}`,
    html:    htmlWrap(body),
  });
}

// ─── 4. Password Reset ─────────────────────────────────────────────────────────
export async function sendPasswordResetEmail(to: string, storeName: string, resetUrl: string) {
  const body = `
    <h2>Reset your password</h2>
    <p>Hi <strong>${storeName}</strong>,</p>
    <p>We received a request to reset the password for your Cataseek account. Click the button below to choose a new password. This link is valid for <strong>1 hour</strong>.</p>
    <a class="btn" href="${resetUrl}">Reset Password →</a>
    <p style="margin-top:20px;font-size:13px;color:#64748b;">If you didn't request this, you can safely ignore this email — your password will not change.</p>
  `;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: '🔐 Reset your Cataseek password',
    html: htmlWrap(body),
  });
}

// ─── 5. Email Verification ─────────────────────────────────────────────────────
export async function sendVerificationEmail(to: string, storeName: string, verifyUrl: string) {
  const body = `
    <h2>Verify your email address</h2>
    <p>Hi <strong>${storeName}</strong>,</p>
    <p>Please confirm this email address to secure your Cataseek account and make sure invoices and important notices reach you.</p>
    <a class="btn" href="${verifyUrl}">Verify Email →</a>
    <p style="margin-top:20px;font-size:13px;color:#64748b;">If you didn't create a Cataseek account, you can ignore this email.</p>
  `;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: '✉️ Verify your email — Cataseek',
    html: htmlWrap(body),
  });
}

// ─── 6. Trial Reminder (3 days before expiry) ──────────────────────────────────
export async function sendTrialReminderEmail(to: string, storeName: string, trialEndsAt: Date, daysLeft: number) {
  const body = `
    <h2>Your free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'} ⏳</h2>
    <p>Hi <strong>${storeName}</strong>,</p>
    <p>Your Cataseek trial ends on <strong>${trialEndsAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>. After that, search on your store will pause until you pick a plan.</p>
    <div class="box">
      <p><strong>Keep your search running:</strong> choose a plan before the trial ends and there will be no interruption for your customers.</p>
    </div>
    <a class="btn" href="${process.env.FRONTEND_URL || 'https://cataseek.com'}/billing">Choose a Plan →</a>
  `;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: `⏳ ${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your Cataseek trial`,
    html: htmlWrap(body),
  });
}

// ─── 7. Trial Expired ──────────────────────────────────────────────────────────
export async function sendTrialExpiredEmail(to: string, storeName: string) {
  const body = `
    <h2>Your free trial has ended</h2>
    <p>Hi <strong>${storeName}</strong>,</p>
    <p>Your 14-day Cataseek trial is over and search on your store is now <strong>paused</strong>. Your product data and settings are safe — pick a plan to switch it back on instantly.</p>
    <a class="btn" href="${process.env.FRONTEND_URL || 'https://cataseek.com'}/billing">Reactivate with a Plan →</a>
    <p style="margin-top:20px;font-size:13px;color:#64748b;">Questions? Just reply to this email or contact support.</p>
  `;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: '⚠️ Your Cataseek trial has ended — search is paused',
    html: htmlWrap(body),
  });
}

// ─── 8. Payment Failed (dunning) ───────────────────────────────────────────────
export async function sendPaymentFailedEmail(to: string, storeName: string, planName: string, reason?: string) {
  const body = `
    <h2>Payment failed — action needed</h2>
    <p>Hi <strong>${storeName}</strong>,</p>
    <p>We couldn't process the renewal payment for your <strong>${planName}</strong> subscription${reason ? ` (<em>${reason}</em>)` : ''}.</p>
    <div class="box">
      <p><strong>What happens now?</strong> We'll retry automatically. If payment keeps failing, your subscription will be paused.</p>
      <p><strong>What you can do:</strong> make sure your card/UPI has sufficient balance, or re-subscribe from your Billing page.</p>
    </div>
    <a class="btn" href="${process.env.FRONTEND_URL || 'https://cataseek.com'}/billing">Go to Billing →</a>
  `;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: `❌ Payment failed — ${planName} subscription`,
    html: htmlWrap(body),
  });
}

// ─── 9. Subscription Paused (after repeated failures / halt) ───────────────────
export async function sendSubscriptionPausedEmail(to: string, storeName: string, planName: string) {
  const body = `
    <h2>Your subscription is paused</h2>
    <p>Hi <strong>${storeName}</strong>,</p>
    <p>Repeated payment failures meant we had to pause your <strong>${planName}</strong> subscription, and search on your store is currently offline.</p>
    <p>Your data is safe. Re-subscribe any time to restore service instantly.</p>
    <a class="btn" href="${process.env.FRONTEND_URL || 'https://cataseek.com'}/billing">Re-activate Subscription →</a>
  `;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: `⏸ Subscription paused — ${planName}`,
    html: htmlWrap(body),
  });
}

// ─── 10. Usage Alert (80% / 100% of monthly searches) ─────────────────────────
export async function sendUsageAlertEmail(
  to: string, storeName: string, planName: string,
  used: number, limit: number, percent: number,
) {
  const maxed = percent >= 100;
  const body = `
    <h2>${maxed ? 'You\'ve reached your search limit' : `You\'ve used ${percent}% of your searches`}</h2>
    <p>Hi <strong>${storeName}</strong>,</p>
    <p>Your <strong>${planName}</strong> plan includes <strong>${limit.toLocaleString()}</strong> searches per month. This month you've used <strong>${used.toLocaleString()}</strong>${maxed ? ' — the limit is reached' : ` (${percent}%)`}.</p>
    <div class="box">
      ${maxed
        ? '<p>Additional searches this cycle may be blocked until your limit resets or you upgrade. Upgrade now to keep search running smoothly.</p>'
        : '<p>If you expect more traffic, consider upgrading to a higher plan so your customers never hit a wall.</p>'}
    </div>
    <a class="btn" href="${process.env.FRONTEND_URL || 'https://cataseek.com'}/billing">${maxed ? 'Upgrade Plan' : 'View Plans'} →</a>
  `;
  await transporter.sendMail({
    from: FROM,
    to,
    subject: maxed ? `🚦 Search limit reached — ${planName}` : `📈 ${percent}% of your monthly searches used`,
    html: htmlWrap(body),
  });
}

// ─── 3. Invoice Email (with PDF attachment) ────────────────────────────────────
export async function sendInvoiceEmail(
  to: string,
  storeName: string,
  invoiceNumber: string,
  planName: string,
  amount: number,
  pdfBuffer: Buffer,
) {
  const body = `
    <h2>Your invoice is ready</h2>
    <p>Hi <strong>${storeName}</strong>,</p>
    <p>Please find your invoice for the <strong>${planName}</strong> subscription attached to this email.</p>
    <div class="box">
      <p><strong>Invoice #:</strong> ${invoiceNumber}</p>
      <p><strong>Plan:</strong> ${planName}</p>
      <p><strong>Amount:</strong> $${amount.toFixed(2)} USD</p>
      <p><strong>Status:</strong> Paid ✅</p>
    </div>
    <p>You can also download this invoice any time from your billing dashboard.</p>
    <a class="btn" href="${process.env.FRONTEND_URL || 'https://cataseek.com'}/billing">View Billing History →</a>
  `;
  await transporter.sendMail({
    from:    FROM,
    to,
    subject: `🧾 Invoice ${invoiceNumber} — Cataseek ${planName}`,
    html:    htmlWrap(body),
    attachments: [
      {
        filename:    `${invoiceNumber}.pdf`,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

