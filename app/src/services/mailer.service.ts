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

// Helper to get merchant console URL (https://console.cataseek.com)
const getConsoleUrl = (): string => {
  let url = (process.env.FRONTEND_URL || 'https://console.cataseek.com').trim().replace(/\/$/, '');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  // admin.cataseek.com is super-admin only; merchant console is console.cataseek.com
  if (url.includes('admin.cataseek.com')) {
    url = url.replace('admin.cataseek.com', 'console.cataseek.com');
  }
  return url;
};

// ─── HTML Email Wrapper & Brand Theme ─────────────────────────────────────────
const htmlWrap = (body: string, previewText?: string) => {
  const consoleUrl = getConsoleUrl();
  const logoUrl = `${consoleUrl}/logo-white.png`;
  const currentYear = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Cataseek</title>
  <style>
    body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; background-color: #F3F6F4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    a { color: #719406; text-decoration: none; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F3F6F4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  ${previewText ? `<div style="display: none; font-size: 1px; color: #F3F6F4; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">${previewText}</div>` : ''}
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F3F6F4; padding: 36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; border: 1px solid #E3EAE5; box-shadow: 0 4px 20px rgba(20, 32, 26, 0.06);">
          <!-- Header -->
          <tr>
            <td style="background-color: #14201A; padding: 32px 40px; text-align: left;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <a href="${consoleUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
                      <img src="${logoUrl}" alt="Cataseek" height="28" style="display: block; height: 28px; width: auto; border: 0; color: #FFFFFF; font-size: 22px; font-weight: bold; font-family: sans-serif;" />
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 6px; color: #93A29A; font-size: 12px; font-weight: 500; letter-spacing: 0.03em; text-transform: uppercase;">
                    Instant Search for E-Commerce
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td style="padding: 40px; color: #14201A; font-size: 15px; line-height: 1.6;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #FAFCFB; border-top: 1px solid #E3EAE5; padding: 24px 40px; text-align: left; font-size: 12px; color: #5A6B61; line-height: 1.5;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="color: #5A6B61; font-size: 12px;">
                    © ${currentYear} <strong>Cataseek</strong>. All rights reserved.<br />
                    This is an automated notification sent to your Cataseek account email.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

// Common UI Component Builders
const buildBox = (content: string, borderColor = '#99C124') => `
  <div style="background-color: #F3F8F5; border: 1px solid #E3EAE5; border-left: 4px solid ${borderColor}; border-radius: 10px; padding: 18px 22px; margin: 24px 0; color: #14201A;">
    ${content}
  </div>
`;

const buildBtn = (label: string, url: string) => `
  <div style="margin-top: 24px; margin-bottom: 8px;">
    <a href="${url}" target="_blank" style="display: inline-block; background-color: #14201A; color: #FFFFFF !important; text-decoration: none; padding: 13px 28px; border-radius: 10px; font-weight: 600; font-size: 14px; box-shadow: 0 2px 4px rgba(20,32,26,0.1);">
      ${label}
    </a>
  </div>
`;

// ─── 0. New Account Registration Welcome ─────────────────────────────────────
export async function sendRegistrationWelcomeEmail(
  to: string,
  storeName: string,
  trialEndsAt: Date,
) {
  const formattedDate = trialEndsAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const dashboardUrl = getConsoleUrl();
  
  const body = `
    <h2 style="margin: 0 0 16px 0; color: #14201A; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Welcome to Cataseek! 🎉</h2>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Hi <strong>${storeName}</strong>,</p>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Your account has been created successfully. You're now on a <strong>14-day free trial</strong> with full access to all Cataseek features.</p>
    ${buildBox(`
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Trial Expiration:</strong> ${formattedDate}</p>
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Next Steps:</strong> Connect your store, sync your product catalog, and test your instant search widget.</p>
    `)}
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Whenever you're ready, head over to your Billing page to choose a plan for continuous service.</p>
    ${buildBtn('Go to Dashboard →', dashboardUrl)}
  `;

  await transporter.sendMail({
    from:    FROM,
    to,
    subject: `Welcome to Cataseek — your trial has started!`,
    html:    htmlWrap(body, `Welcome to Cataseek! Your 14-day trial for ${storeName} has started.`),
  });
}

// ─── 1. Welcome / New Subscription ────────────────────────────────────────────
export async function sendSubscriptionWelcomeEmail(
  to: string,
  storeName: string,
  planName: string,
  amount: number,
  periodEnd: Date,
) {
  const formattedDate = periodEnd.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const dashboardUrl = getConsoleUrl();

  const body = `
    <h2 style="margin: 0 0 16px 0; color: #14201A; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Subscription Activated 🎉</h2>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Hi <strong>${storeName}</strong>,</p>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Thank you for subscribing! Your <strong>${planName}</strong> plan is now active. Here is a summary of your subscription:</p>
    ${buildBox(`
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Plan:</strong> ${planName}</p>
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Amount:</strong> $${amount.toFixed(2)} USD</p>
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Next Renewal Date:</strong> ${formattedDate}</p>
    `)}
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Your Cataseek search engine is fully operational. Head to your dashboard to manage product sync and search settings.</p>
    ${buildBtn('Go to Dashboard →', dashboardUrl)}
  `;

  await transporter.sendMail({
    from:    FROM,
    to,
    subject: `✅ Subscription Activated — ${planName}`,
    html:    htmlWrap(body, `Your ${planName} subscription for ${storeName} has been activated.`),
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
  const formattedDate = renewalDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const billingUrl = `${getConsoleUrl()}/billing`;

  const body = `
    <h2 style="margin: 0 0 16px 0; color: #14201A; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Your subscription renews soon</h2>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Hi <strong>${storeName}</strong>,</p>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">This is a quick notification that your <strong>${planName}</strong> subscription is scheduled for automatic renewal.</p>
    ${buildBox(`
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Plan:</strong> ${planName}</p>
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Renewal Amount:</strong> $${amount.toFixed(2)} USD</p>
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Renewal Date:</strong> ${formattedDate}</p>
    `)}
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">No action is required if your payment details are up to date. You can manage your billing preferences anytime.</p>
    ${buildBtn('Manage Subscription →', billingUrl)}
  `;

  await transporter.sendMail({
    from:    FROM,
    to,
    subject: `⏰ Renewal Reminder — ${planName} renews on ${formattedDate}`,
    html:    htmlWrap(body, `Renewal reminder for your ${planName} subscription on ${formattedDate}.`),
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
  const billingUrl = `${getConsoleUrl()}/billing`;

  const body = `
    <h2 style="margin: 0 0 16px 0; color: #14201A; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Your invoice is ready</h2>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Hi <strong>${storeName}</strong>,</p>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Thank you for your payment! Please find your tax invoice for the <strong>${planName}</strong> plan attached to this email.</p>
    ${buildBox(`
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Invoice #:</strong> ${invoiceNumber}</p>
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Plan:</strong> ${planName}</p>
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Amount Paid:</strong> $${amount.toFixed(2)} USD</p>
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Status:</strong> Paid ✅</p>
    `)}
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">You can also access and download your past invoices anytime from your billing dashboard.</p>
    ${buildBtn('View Billing History →', billingUrl)}
  `;

  await transporter.sendMail({
    from:    FROM,
    to,
    subject: `🧾 Invoice ${invoiceNumber} — Cataseek ${planName}`,
    html:    htmlWrap(body, `Invoice ${invoiceNumber} for your Cataseek ${planName} subscription.`),
    attachments: [
      {
        filename:    `${invoiceNumber}.pdf`,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

// ─── 4. Password Reset ─────────────────────────────────────────────────────────
export async function sendPasswordResetEmail(to: string, storeName: string, resetUrl: string) {
  const body = `
    <h2 style="margin: 0 0 16px 0; color: #14201A; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Reset your password</h2>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Hi <strong>${storeName}</strong>,</p>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">We received a request to reset the password for your Cataseek account. Click the button below to choose a new password. This link is valid for <strong>1 hour</strong>.</p>
    ${buildBtn('Reset Password →', resetUrl)}
    <p style="margin-top: 24px; font-size: 13px; color: #5A6B61;">If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged.</p>
  `;

  await transporter.sendMail({
    from: FROM,
    to,
    subject: '🔐 Reset your Cataseek password',
    html: htmlWrap(body, `Password reset link for your Cataseek account.`),
  });
}

// ─── 5. Email Verification ─────────────────────────────────────────────────────
export async function sendVerificationEmail(to: string, storeName: string, verifyUrl: string) {
  const body = `
    <h2 style="margin: 0 0 16px 0; color: #14201A; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Verify your email address</h2>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Hi <strong>${storeName}</strong>,</p>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Please confirm this email address to verify your Cataseek account and ensure you receive billing invoices and critical account notices.</p>
    ${buildBtn('Verify Email Address →', verifyUrl)}
    <p style="margin-top: 24px; font-size: 13px; color: #5A6B61;">If you didn't create a Cataseek account, you can safely ignore this email.</p>
  `;

  await transporter.sendMail({
    from: FROM,
    to,
    subject: '✉️ Verify your email address — Cataseek',
    html: htmlWrap(body, `Please confirm your email address for Cataseek.`),
  });
}

// ─── 6. Trial Reminder (3 days before expiry) ──────────────────────────────────
export async function sendTrialReminderEmail(to: string, storeName: string, trialEndsAt: Date, daysLeft: number) {
  const formattedDate = trialEndsAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const billingUrl = `${getConsoleUrl()}/billing`;

  const body = `
    <h2 style="margin: 0 0 16px 0; color: #14201A; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Your free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'} ⏳</h2>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Hi <strong>${storeName}</strong>,</p>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Your Cataseek trial ends on <strong>${formattedDate}</strong>. After this date, instant search on your store will be paused until you select a plan.</p>
    ${buildBox(`
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Avoid Interruption:</strong> Select a plan before your trial expires to keep search running seamlessly for your shoppers.</p>
    `, '#f59e0b')}
    ${buildBtn('Choose a Plan →', billingUrl)}
  `;

  await transporter.sendMail({
    from: FROM,
    to,
    subject: `⏳ ${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your Cataseek trial`,
    html: htmlWrap(body, `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining in your Cataseek free trial.`),
  });
}

// ─── 7. Trial Expired ──────────────────────────────────────────────────────────
export async function sendTrialExpiredEmail(to: string, storeName: string) {
  const billingUrl = `${getConsoleUrl()}/billing`;

  const body = `
    <h2 style="margin: 0 0 16px 0; color: #14201A; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Your free trial has ended</h2>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Hi <strong>${storeName}</strong>,</p>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Your 14-day Cataseek trial has expired, and search on your store is currently <strong>paused</strong>.</p>
    ${buildBox(`
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Your data is safe:</strong> All your synced products, search configurations, and analytics remain saved. Pick a plan to switch search back on instantly.</p>
    `, '#ef4444')}
    ${buildBtn('Reactivate with a Plan →', billingUrl)}
    <p style="margin-top: 24px; font-size: 13px; color: #5A6B61;">Have questions? Reply directly to this email or contact support.</p>
  `;

  await transporter.sendMail({
    from: FROM,
    to,
    subject: '⚠️ Your Cataseek trial has ended — search is paused',
    html: htmlWrap(body, `Your Cataseek free trial has ended. Select a plan to reactivate search.`),
  });
}

// ─── 8. Payment Failed (dunning) ───────────────────────────────────────────────
export async function sendPaymentFailedEmail(to: string, storeName: string, planName: string, reason?: string) {
  const billingUrl = `${getConsoleUrl()}/billing`;

  const body = `
    <h2 style="margin: 0 0 16px 0; color: #14201A; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Payment failed — action required</h2>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Hi <strong>${storeName}</strong>,</p>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">We were unable to process the renewal payment for your <strong>${planName}</strong> subscription${reason ? ` (Reason: <em>${reason}</em>)` : ''}.</p>
    ${buildBox(`
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Automatic Retries:</strong> We will retry processing payment automatically. If failures continue, search on your store will be paused.</p>
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">What you can do:</strong> Please verify your card or UPI payment method in your billing portal.</p>
    `, '#ef4444')}
    ${buildBtn('Update Payment Details →', billingUrl)}
  `;

  await transporter.sendMail({
    from: FROM,
    to,
    subject: `❌ Payment failed — ${planName} subscription`,
    html: htmlWrap(body, `Payment failed for your ${planName} subscription on Cataseek.`),
  });
}

// ─── 9. Subscription Paused (after repeated failures / halt) ───────────────────
export async function sendSubscriptionPausedEmail(to: string, storeName: string, planName: string) {
  const billingUrl = `${getConsoleUrl()}/billing`;

  const body = `
    <h2 style="margin: 0 0 16px 0; color: #14201A; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Your subscription is paused</h2>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Hi <strong>${storeName}</strong>,</p>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Due to repeated payment failures, your <strong>${planName}</strong> subscription has been paused and search on your store is currently offline.</p>
    ${buildBox(`
      <p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Data Safe:</strong> Your settings and product catalog are intact. Re-subscribe anytime to restore search immediately.</p>
    `, '#ef4444')}
    ${buildBtn('Re-activate Subscription →', billingUrl)}
  `;

  await transporter.sendMail({
    from: FROM,
    to,
    subject: `⏸ Subscription paused — ${planName}`,
    html: htmlWrap(body, `Subscription paused for ${planName} due to payment failure.`),
  });
}

// ─── 10. Usage Alert (80% / 100% of monthly searches) ─────────────────────────
export async function sendUsageAlertEmail(
  to: string, storeName: string, planName: string,
  used: number, limit: number, percent: number,
) {
  const maxed = percent >= 100;
  const billingUrl = `${getConsoleUrl()}/billing`;

  const body = `
    <h2 style="margin: 0 0 16px 0; color: #14201A; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">
      ${maxed ? 'You\'ve reached your search limit' : `You\'ve used ${percent}% of your monthly searches`}
    </h2>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">Hi <strong>${storeName}</strong>,</p>
    <p style="margin: 0 0 16px 0; color: #3A4B41; font-size: 15px; line-height: 1.6;">
      Your <strong>${planName}</strong> plan includes <strong>${limit.toLocaleString()}</strong> search queries per month. Your store has used <strong>${used.toLocaleString()}</strong> searches this cycle${maxed ? ' — the limit is reached' : ` (${percent}%)`}.
    </p>
    ${buildBox(`
      ${maxed
        ? '<p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">Notice:</strong> Additional search requests may be restricted until your cycle resets or you upgrade. Upgrade now to keep search running smoothly for customers.</p>'
        : '<p style="margin: 4px 0; font-size: 14px; color: #2A3B31;"><strong style="color: #14201A;">High Demand:</strong> If you expect more traffic, consider upgrading to a higher plan so your customers never experience search interruptions.</p>'}
    `, maxed ? '#ef4444' : '#f59e0b')}
    ${buildBtn(maxed ? 'Upgrade Plan →' : 'View Plans →', billingUrl)}
  `;

  await transporter.sendMail({
    from: FROM,
    to,
    subject: maxed ? `🚦 Search limit reached — ${planName}` : `📈 ${percent}% of your monthly searches used`,
    html: htmlWrap(body, maxed ? `Search limit reached for ${storeName}.` : `${percent}% of monthly search quota used.`),
  });
}
