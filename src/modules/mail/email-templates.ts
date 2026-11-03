import { escapeHtml } from '../../common/utils/sanitize';
import { formatNaira } from '../../common/utils/money';

export const BRAND = {
  ink: '#06231A',
  forest: '#0B3D2E',
  forestSoft: '#EBF6F0',
  forestBorder: '#C1E6D3',
  orange: '#FF5A1F',
  orangeSoft: '#FFF2EB',
  orangeBorder: '#FFD4C2',
  cream: '#FAF7F2',
  cardBg: '#FFFFFF',
  border: '#EDE7DE',
  line: '#EAE4D9',
  muted: '#5A6860',
  mutedLight: '#8C9890',
  yellow: '#F5D547',
  gold: '#B45309',
  goldSoft: '#FEF9C3',
  goldBorder: '#FDE68A',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  dangerBorder: '#FECACA',
  success: '#059669',
  successSoft: '#ECFDF5',
  successBorder: '#A7F3D0',
  white: '#FFFFFF',
};

export type BadgeTone = 'orange' | 'green' | 'gold' | 'danger' | 'neutral';

export interface EmailBadge {
  text: string;
  tone?: BadgeTone;
  icon?: string;
}

export interface EmailButton {
  label: string;
  url: string;
  secondary?: boolean;
}

export interface EmailLayoutOptions {
  title: string;
  preheader: string;
  badge?: EmailBadge;
  body: string;
  button?: EmailButton;
  secondaryButton?: EmailButton;
  footerNote?: string;
  businessName?: string;
  businessLogo?: string | null;
  businessTagline?: string | null;
  businessBrandColor?: string;
  accentColor?: string;
  headerType?: 'platform' | 'business';
  businessSlug?: string;
}

function renderBadge(badge?: EmailBadge): string {
  if (!badge) return '';
  let bg = BRAND.orangeSoft;
  let text = BRAND.orange;
  let border = BRAND.orangeBorder;
  let defaultIcon = '✦';

  if (badge.tone === 'green') {
    bg = BRAND.forestSoft;
    text = BRAND.forest;
    border = BRAND.forestBorder;
    defaultIcon = '✓';
  } else if (badge.tone === 'danger') {
    bg = BRAND.dangerSoft;
    text = BRAND.danger;
    border = BRAND.dangerBorder;
    defaultIcon = '⚠';
  } else if (badge.tone === 'gold') {
    bg = BRAND.goldSoft;
    text = BRAND.gold;
    border = BRAND.goldBorder;
    defaultIcon = '★';
  } else if (badge.tone === 'neutral') {
    bg = '#F3F4F6';
    text = '#4B5563';
    border = '#E5E7EB';
    defaultIcon = '•';
  }

  const icon = badge.icon || defaultIcon;

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
    <tr>
      <td style="background-color:${bg};border:1px solid ${border};border-radius:24px;padding:6px 14px;font-size:11px;font-weight:700;color:${text};letter-spacing:0.6px;text-transform:uppercase;line-height:1;">
        <span style="display:inline-block;margin-right:6px;font-size:11px;">${icon}</span>${escapeHtml(badge.text)}
      </td>
    </tr>
  </table>`;
}

function renderHeader(opts: EmailLayoutOptions): string {
  const { businessName, businessLogo, businessTagline, headerType } = opts;

  // Render business-branded header ONLY if explicitly requested as 'business' AND businessLogo exists
  if (headerType === 'business' && businessLogo) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:54px;vertical-align:middle;">
          <img src="${escapeHtml(businessLogo)}" width="48" height="48" alt="${escapeHtml(businessName || '')}" style="width:48px;height:48px;border-radius:14px;object-fit:cover;display:block;border:2px solid rgba(255,255,255,0.22);box-shadow:0 3px 10px rgba(0,0,0,0.18);" />
        </td>
        <td style="vertical-align:middle;padding-left:14px;">
          <div style="font-size:18px;font-weight:800;color:#FFFFFF;letter-spacing:-0.3px;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'DM Sans','Segoe UI',Arial,sans-serif;">
            ${escapeHtml(businessName || 'Ojaly Store')}
          </div>
          <div style="font-size:12px;color:#A8C0B4;margin-top:3px;font-weight:500;">
            ${escapeHtml(businessTagline || 'Verified Seller on Ojaly')}
          </div>
        </td>
        <td align="right" style="vertical-align:middle;">
          <a href="https://ojaly.org" target="_blank" style="text-decoration:none;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-block;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);border-radius:20px;padding:5px 12px;">
              <tr>
                <td style="vertical-align:middle;"><img src="https://ojaly.org/brand/ojaly-mark-64.png" width="18" height="18" alt="Ojaly" style="width:18px;height:18px;border-radius:5px;display:block;"></td>
                <td style="padding-left:7px;color:#E9F4EE;font-size:11px;font-weight:700;letter-spacing:0.5px;vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'DM Sans',Arial,sans-serif;">
                  Ojaly
                </td>
              </tr>
            </table>
          </a>
        </td>
      </tr>
    </table>`;
  }

  // Official Ojaly brand header featuring the official high-resolution logo
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="vertical-align:middle;">
        <a href="https://ojaly.org" target="_blank" style="text-decoration:none;display:inline-block;">
          <img src="https://ojaly.org/brand/ojaly-logo-light.png" width="150" height="40" alt="Ojaly" style="display:block;width:150px;height:40px;border:0;outline:none;text-decoration:none;">
        </a>
      </td>
      <td align="right" style="vertical-align:middle;">
        <a href="https://ojaly.org" target="_blank" style="text-decoration:none;display:inline-block;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:20px;padding:4px 12px;">
            <tr>
              <td style="vertical-align:middle;">
                <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background-color:#FF5A1F;margin-right:6px;"></span>
              </td>
              <td style="color:#D8E8E0;font-size:11px;font-weight:700;letter-spacing:0.4px;vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'DM Sans',Arial,sans-serif;">
                ojaly.org
              </td>
            </tr>
          </table>
        </a>
      </td>
    </tr>
  </table>`;
}

function absoluteAsset(url?: string | null): string | null {
  if (!url) return null;
  const value = String(url).trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://ojaly.org${value.startsWith('/') ? '' : '/'}${value}`;
}

function renderServicePromo(opts: EmailLayoutOptions): string {
  const slug = (opts.businessSlug || '').replace(/[^a-z0-9-]/gi, '');
  const url = slug ? `https://ojaly.org/s/${slug}/services` : 'https://ojaly.org/marketplace';
  const heading = slug ? 'More ways to book' : 'Discover trusted local services';
  const body = slug
    ? 'Explore more services, packages and availability from this business on Ojaly.'
    : 'Hair, food, nails, printing, laundry, repairs and more — book verified local providers on Ojaly.';
  const label = slug ? 'Book another service' : 'Explore the marketplace';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.cream};border-top:1px solid ${BRAND.border};">
    <tr>
      <td style="padding:24px 32px 26px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
          <tr><td style="background-color:${BRAND.orangeSoft};border:1px solid ${BRAND.orangeBorder};border-radius:20px;padding:4px 10px;color:${BRAND.orange};font-size:9px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">Book local</td></tr>
        </table>
        <p style="margin:0 0 5px;color:${BRAND.ink};font-size:16px;font-weight:800;letter-spacing:-0.2px;font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk','Segoe UI',Arial,sans-serif;">${heading}</p>
        <p style="margin:0 0 14px;color:${BRAND.muted};font-size:12px;line-height:1.6;">${body}</p>
        <a href="${url}" target="_blank" style="display:inline-block;background-color:${BRAND.ink};color:#ffffff !important;text-decoration:none;font-size:12px;font-weight:700;padding:10px 16px;border-radius:10px;">${label} &rarr;</a>
        <p style="margin:16px 0 0;color:${BRAND.mutedLight};font-size:10px;line-height:1.6;">Hair &amp; beauty &middot; Food &amp; catering &middot; Laundry &middot; Printing &middot; Design &middot; Repairs</p>
      </td>
    </tr>
  </table>`;
}

export function emailLayout(opts: EmailLayoutOptions): string {
  const { title, preheader, badge, body, button, secondaryButton, footerNote } = opts;
  const logo = absoluteAsset(opts.businessLogo);

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
<!--[if mso]>
<style>
  table { border-collapse: collapse; }
  *, text, td, a { font-family: -apple-system, 'Segoe UI', Arial, sans-serif !important; }
</style>
<![endif]-->
<style>
  body { margin: 0; padding: 0; background-color: ${BRAND.cream}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'DM Sans', Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  img { border: 0; outline: none; text-decoration: none; display: block; max-width: 100%; }
  table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  td { vertical-align: top; }
  .email-container { max-width: 600px; width: 100%; margin: 0 auto; background-color: ${BRAND.cardBg}; border-radius: 18px; overflow: hidden; border: 1px solid ${BRAND.border}; box-shadow: 0 8px 28px rgba(6,35,26,0.07); }
  .btn-primary { display: inline-block; background-color: ${BRAND.orange}; color: #ffffff !important; text-decoration: none; font-weight: 700; font-size: 13px; padding: 13px 24px; border-radius: 11px; text-align: center; box-shadow: 0 3px 10px rgba(255,90,31,0.22); }
  .btn-secondary { display: inline-block; background-color: ${BRAND.cream}; color: ${BRAND.ink} !important; text-decoration: none; font-weight: 700; font-size: 13px; padding: 12px 20px; border-radius: 11px; border: 1px solid ${BRAND.border}; text-align: center; }
  @media only screen and (max-width: 600px) {
    .content-padding { padding: 28px 20px 18px !important; }
    .header-padding { padding: 20px 20px !important; }
    .footer-padding { padding: 22px 20px 26px !important; }
    .promo-padding { padding: 22px 20px !important; }
    .btn-primary, .btn-secondary { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; margin-bottom: 8px !important; }
    .stat-table td { display: block !important; width: 100% !important; box-sizing: border-box !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.cream};color:${BRAND.ink};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#fff;opacity:0;">
  ${escapeHtml(preheader)} &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.cream};padding:28px 12px 20px;">
  <tr>
    <td align="center">
      <table role="presentation" class="email-container" cellpadding="0" cellspacing="0">
        <tr>
          <td class="header-padding" style="background-color:${BRAND.ink};padding:24px 30px;border-bottom:3px solid ${BRAND.orange};">
            ${renderHeader({ ...opts, businessLogo: logo })}
          </td>
        </tr>
        <tr>
          <td class="content-padding" style="padding:34px 30px 18px;background-color:${BRAND.white};">
            ${renderBadge(badge)}
            <h1 style="margin:0 0 14px;font-size:25px;font-weight:800;line-height:1.2;letter-spacing:-0.6px;color:${BRAND.ink};font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk','DM Sans',Arial,sans-serif;">
              ${escapeHtml(title)}
            </h1>
            <div style="font-size:14px;line-height:1.7;color:#23322B;">
              ${body}
            </div>
            ${
              button || secondaryButton
                ? `<div style="margin:26px 0 4px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
                      <tr>
                        <td style="padding:0 0 4px;">
                          ${button ? `<a href="${button.url}" target="_blank" class="btn-primary">${escapeHtml(button.label)} &rarr;</a>` : ''}
                          ${secondaryButton ? `<span style="display:inline-block;width:8px;height:1px;"></span><a href="${secondaryButton.url}" target="_blank" class="btn-secondary">${escapeHtml(secondaryButton.label)}</a>` : ''}
                        </td>
                      </tr>
                    </table>
                  </div>`
                : ''
            }
          </td>
        </tr>
        <tr><td class="promo-padding" style="padding:0;">${renderServicePromo(opts)}</td></tr>
        <tr>
          <td class="footer-padding" style="padding:22px 30px 26px;background-color:${BRAND.white};">
            <div style="border-top:1px solid ${BRAND.border};padding-top:18px;color:${BRAND.muted};font-size:12px;line-height:1.6;">
              ${footerNote ? `<p style="margin:0 0 14px;color:#3D4641;font-weight:500;">${footerNote}</p>` : ''}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:34px;vertical-align:top;padding-right:10px;">
                    <img src="https://ojaly.org/brand/ojaly-mark-64.png" width="28" height="28" alt="Ojaly" style="width:28px;height:28px;border-radius:8px;">
                  </td>
                  <td style="color:${BRAND.muted};font-size:11px;line-height:1.6;">
                    <strong style="color:${BRAND.ink};font-size:12px;">Ojaly</strong> &middot; Book local. Pay secure.<br>
                    Need help? Reply to this email or reach us at <a href="mailto:hello@ojaly.org" style="color:${BRAND.ink};text-decoration:underline;">hello@ojaly.org</a>.
                  </td>
                </tr>
              </table>
            </div>
          </td>
        </tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-top:14px;">
        <tr>
          <td align="center" style="color:${BRAND.mutedLight};font-size:10px;line-height:1.6;">
            &copy; 2026 Ojaly Technologies &middot; <a href="https://ojaly.org" target="_blank" style="color:${BRAND.mutedLight};text-decoration:underline;">ojaly.org</a><br>
            You are receiving this because you booked or manage a business on Ojaly.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ─── TEMPLATES ─────────────────────────────────────────────────────────────

export function welcomeEmail(
  name: string,
  businessName: string,
  url: string,
  businessLogo?: string | null,
  businessTagline?: string | null,
  verifyUrl?: string | null,
): { subject: string; html: string } {
  const firstName = name.split(' ')[0] || 'there';
  const initials = (businessName || 'Store')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  return {
    subject: `Welcome to Ojaly, ${firstName}! ${businessName} is live 🚀`,
    html: emailLayout({
      title: `Welcome to Ojaly, ${firstName}!`,
      preheader: `${businessName} is live on Ojaly. Manage bookings, payments, products and the record behind them.`,
      badge: { text: 'Business Active', tone: 'orange', icon: '🚀' },
      headerType: 'platform',
      businessName,
      businessLogo,
      businessTagline,
      body: `<p style="margin-top:0;font-size:15px;line-height:1.6;">Hi <strong>${escapeHtml(firstName)}</strong>,</p>
      <p style="font-size:15px;line-height:1.6;">Congratulations! <strong>${escapeHtml(businessName)}</strong> is now officially registered on Ojaly. You now have a complete operating system for bookings, payments, products and the records behind them.</p>
      
      <!-- Business Spotlight Card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;background-color:#06231A;background-image:linear-gradient(135deg, #06231A 0%, #0B3D2E 100%);border-radius:16px;border:1px solid rgba(255,255,255,0.12);box-shadow:0 6px 18px rgba(6,35,26,0.12);overflow:hidden;">
        <tr>
          <td style="padding:22px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">
                  <span style="display:inline-block;background:rgba(255,90,31,0.22);border:1px solid rgba(255,90,31,0.45);border-radius:12px;padding:3px 10px;font-size:10px;font-weight:800;color:#FF7A45;text-transform:uppercase;letter-spacing:0.8px;">Storefront Ready</span>
                  <div style="margin:8px 0 4px;font-size:20px;font-weight:800;color:#FFFFFF;letter-spacing:-0.4px;font-family:-apple-system,BlinkMacSystemFont,'DM Sans',Arial,sans-serif;">
                    ${escapeHtml(businessName)}
                  </div>
                  <div style="font-size:12px;color:#A8C0B4;">
                    ${escapeHtml(businessTagline || 'Verified merchant on Ojaly')}
                  </div>
                </td>
                <td align="right" style="vertical-align:middle;width:48px;">
                  ${businessLogo ? `<img src="${absoluteAsset(businessLogo)}" width="46" height="46" alt="${escapeHtml(businessName)}" style="width:46px;height:46px;border-radius:14px;object-fit:cover;border:1px solid rgba(255,255,255,0.15);">` : `<div style="width:46px;height:46px;border-radius:14px;background:#FF5A1F;text-align:center;line-height:46px;color:#ffffff;font-size:18px;font-weight:800;font-family:-apple-system,BlinkMacSystemFont,'DM Sans',Arial,sans-serif;box-shadow:0 3px 10px rgba(255,90,31,0.3);">${escapeHtml(initials)}</div>`}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${
        verifyUrl
          ? `<div style="background-color:${BRAND.forestSoft};border:1px solid ${BRAND.forestBorder};border-radius:14px;padding:16px 20px;margin:20px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <div style="font-weight:800;color:${BRAND.forest};font-size:13px;">
                      🛡️ Confirm your email address
                    </div>
                    <div style="font-size:12px;color:#184232;margin-top:3px;line-height:1.4;">
                      Please verify your email to secure your account and enable online payouts.
                    </div>
                  </td>
                  <td align="right" style="vertical-align:middle;padding-left:12px;">
                    <a href="${verifyUrl}" target="_blank" style="display:inline-block;background-color:${BRAND.forest};color:#ffffff !important;text-decoration:none;font-size:12px;font-weight:700;padding:8px 16px;border-radius:8px;white-space:nowrap;">
                      Verify now &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </div>`
          : ''
      }

      <div style="background-color:${BRAND.orangeSoft};border:1px solid ${BRAND.orangeBorder};border-radius:14px;padding:16px 20px;margin:20px 0;">
        <div style="font-weight:800;color:${BRAND.orange};font-size:14px;">
          ✨ Auto-Generated Online Storefront
        </div>
        <div style="font-size:13px;color:#4A2312;margin-top:5px;line-height:1.5;">
          Add products or services with photos and prices &mdash; share your custom website link in your Instagram bio or WhatsApp status immediately.
        </div>
      </div>

      <p style="font-weight:800;color:${BRAND.ink};margin:24px 0 12px;font-size:15px;">Your first 3 steps to take control:</p>
      
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;margin-bottom:14px;">
        <tr>
          <td style="padding:10px 0;width:32px;vertical-align:top;">
            <span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:50%;background:${BRAND.ink};color:#fff;text-align:center;font-size:11px;font-weight:800;">1</span>
          </td>
          <td style="padding:10px 0 10px 8px;vertical-align:top;">
            <strong>Add your first product or service:</strong> Set cost and selling prices so your margins are tracked to the kobo.
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;width:32px;vertical-align:top;">
            <span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:50%;background:${BRAND.ink};color:#fff;text-align:center;font-size:11px;font-weight:800;">2</span>
          </td>
          <td style="padding:10px 0 10px 8px;vertical-align:top;">
            <strong>Record a sale:</strong> Log it in under 10 seconds via the web app or straight through our WhatsApp assistant.
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;width:32px;vertical-align:top;">
            <span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:50%;background:${BRAND.ink};color:#fff;text-align:center;font-size:11px;font-weight:800;">3</span>
          </td>
          <td style="padding:10px 0 10px 8px;vertical-align:top;">
            <strong>Watch your numbers:</strong> View real-time revenue, margins, and customer debts with zero bookkeeping headache.
          </td>
        </tr>
      </table>`,
      button: { label: 'Open My Store Dashboard', url },
      footerNote: 'Tip: You can customize daily WhatsApp sales digests in Settings &rarr; WhatsApp & Summaries.',
    }),
  };
}

export function verificationEmail(name: string, url: string, businessName?: string): { subject: string; html: string } {
  const firstName = name.split(' ')[0] || 'there';
  const displayBusiness = businessName ? ` for ${businessName}` : '';
  return {
    subject: `Confirm your Ojaly account email${displayBusiness} 🛡️`,
    html: emailLayout({
      title: 'Confirm your email address',
      preheader: `One quick tap to verify your email and secure ${businessName || 'your Ojaly account'}.`,
      badge: { text: 'Account Security', tone: 'green', icon: '🛡️' },
      headerType: 'platform',
      businessName,
      body: `<p style="margin-top:0;font-size:15px;line-height:1.6;">Hi <strong>${escapeHtml(firstName)}</strong>,</p>
      <p style="font-size:15px;line-height:1.6;">Thank you for registering on Ojaly${businessName ? ` to power <strong>${escapeHtml(businessName)}</strong>` : ''}. Please tap the button below to confirm that this email address belongs to you and complete your setup.</p>
      
      <div style="background-color:${BRAND.forestSoft};border:1px solid ${BRAND.forestBorder};border-radius:14px;padding:16px 20px;margin:22px 0;">
        <div style="font-weight:800;color:${BRAND.forest};font-size:13px;">
          ✦ Why verify your email?
        </div>
        <div style="font-size:13px;color:#184232;margin-top:5px;line-height:1.5;">
          Verification secures your storefront link, activates online Paystack payouts, and ensures you receive urgent order and payment notifications.
        </div>
      </div>

      <div style="background-color:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:14px;padding:14px 18px;margin:20px 0;font-size:12px;color:${BRAND.muted};line-height:1.5;">
        🔒 This secure link is valid for <strong>24 hours</strong>. If you did not create an Ojaly account, you can safely disregard this email.
      </div>`,
      button: { label: 'Confirm My Email Address', url },
      footerNote: 'For security reasons, never forward this verification link to anyone.',
    }),
  };
}

export function resetPasswordEmail(name: string, url: string): { subject: string; html: string } {
  const firstName = name.split(' ')[0] || 'there';
  return {
    subject: 'Reset your Ojaly password',
    html: emailLayout({
      title: 'Reset your password',
      preheader: 'Use this secure link to set a new password for your Ojaly account.',
      badge: { text: 'Security Request', tone: 'orange', icon: '🔐' },
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p>We received a request to reset the password for your Ojaly account. Tap the button below to choose a fresh, secure password.</p>
      
      <div style="background-color:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:14px;padding:16px 18px;margin:22px 0;font-size:13px;color:${BRAND.muted};line-height:1.5;">
        ⏳ This reset link expires in <strong>1 hour</strong>. If you did not make this request, your account remains secure and no action is required.
      </div>`,
      button: { label: 'Choose new password', url },
      footerNote: 'Ojaly team members will never ask you for your password via email, SMS, or WhatsApp.',
    }),
  };
}


export interface BookingConfirmationEmailInput {
  customerName: string;
  businessName: string;
  businessLogo?: string | null;
  businessTagline?: string | null;
  businessSlug?: string;
  serviceName: string;
  providerName: string;
  dateLabel: string;
  timeLabel: string;
  durationMinutes: number;
  reference: string;
  location?: string | null;
  manageUrl: string;
  calendarUrl: string;
  priceKobo: number;
  depositKobo: number;
  policy?: string | null;
}

export function bookingConfirmedEmail(input: BookingConfirmationEmailInput): { subject: string; html: string } {
  const firstName = input.customerName.split(' ')[0] || 'there';
  const deposit = input.depositKobo > 0
    ? `<tr><td style="padding:7px 0;color:${BRAND.muted};font-size:12px;">Deposit</td><td align="right" style="padding:7px 0;color:${BRAND.ink};font-size:12px;font-weight:700;">${formatNaira(input.depositKobo)}</td></tr>`
    : '';
  return {
    subject: `Your ${input.serviceName} at ${input.businessName} is confirmed`,
    html: emailLayout({
      title: `You’re booked at ${input.businessName}`,
      preheader: `${input.dateLabel} at ${input.timeLabel} with ${input.providerName} · ${input.reference}`,
      badge: { text: 'Appointment confirmed', tone: 'green', icon: '✓' },
      headerType: 'business',
      businessName: input.businessName,
      businessLogo: input.businessLogo,
      businessTagline: input.businessTagline,
      businessSlug: input.businessSlug,
      body: `<p style="margin-top:0;">Hi <strong>${escapeHtml(firstName)}</strong>,</p>
        <p>Your <strong>${escapeHtml(input.serviceName)}</strong> with <strong>${escapeHtml(input.providerName)}</strong> is confirmed.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;background-color:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:14px;">
          <tr><td style="padding:18px 20px;">
            <p style="margin:0 0 2px;color:${BRAND.muted};font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">Your appointment</p>
            <p style="margin:0;color:${BRAND.ink};font-size:20px;font-weight:800;letter-spacing:-0.4px;">${escapeHtml(input.dateLabel)} · ${escapeHtml(input.timeLabel)}</p>
            <p style="margin:4px 0 0;color:${BRAND.muted};font-size:12px;">${escapeHtml(input.serviceName)} · ${input.durationMinutes} minutes · ${escapeHtml(input.providerName)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid ${BRAND.border};">
              <tr><td style="padding:10px 0 7px;color:${BRAND.muted};font-size:12px;">Reference</td><td align="right" style="padding:10px 0 7px;color:${BRAND.ink};font-size:12px;font-weight:700;">${escapeHtml(input.reference)}</td></tr>
              ${input.location ? `<tr><td style="padding:7px 0;color:${BRAND.muted};font-size:12px;">Location</td><td align="right" style="padding:7px 0;color:${BRAND.ink};font-size:12px;font-weight:700;">${escapeHtml(input.location)}</td></tr>` : ''}
              <tr><td style="padding:7px 0;color:${BRAND.muted};font-size:12px;">Price</td><td align="right" style="padding:7px 0;color:${BRAND.ink};font-size:12px;font-weight:700;">${formatNaira(input.priceKobo)}</td></tr>
              ${deposit}
            </table>
          </td></tr>
        </table>
        <p style="margin:0;color:${BRAND.muted};font-size:12px;line-height:1.6;">${escapeHtml(input.policy || 'Please arrive a few minutes early. Manage or reschedule from your booking page.')}</p>`,
      button: { label: 'Manage my booking', url: input.manageUrl },
      secondaryButton: { label: 'Add to calendar', url: input.calendarUrl },
      footerNote: 'Need to change your appointment? Use the management button above.',
    }),
  };
}

export interface BookingReviewEmailInput {
  customerName: string;
  businessName: string;
  businessLogo?: string | null;
  businessTagline?: string | null;
  businessSlug?: string;
  serviceName: string;
  providerName: string;
  reviewUrl: string;
  policy?: string | null;
}

export function bookingReviewEmail(input: BookingReviewEmailInput): { subject: string; html: string } {
  const firstName = input.customerName.split(' ')[0] || 'there';
  return {
    subject: `How was your ${input.serviceName} at ${input.businessName}?`,
    html: emailLayout({
      title: 'How did we do?',
      preheader: `Share a quick review of your ${input.serviceName} with ${input.providerName}.`,
      badge: { text: 'Review request', tone: 'orange', icon: '★' },
      headerType: 'business',
      businessName: input.businessName,
      businessLogo: input.businessLogo,
      businessTagline: input.businessTagline,
      businessSlug: input.businessSlug,
      body: `<p style="margin-top:0;">Hi <strong>${escapeHtml(firstName)}</strong>,</p>
        <p>Thanks for visiting <strong>${escapeHtml(input.businessName)}</strong>. How was your <strong>${escapeHtml(input.serviceName)}</strong> with ${escapeHtml(input.providerName)}?</p>
        <p style="margin:18px 0 8px;color:${BRAND.orange};font-size:26px;letter-spacing:3px;">★★★★★</p>
        <p style="color:${BRAND.muted};font-size:13px;line-height:1.6;">Your review helps other customers choose with confidence and helps the business improve.</p>
        <p style="margin:0;color:${BRAND.muted};font-size:12px;line-height:1.6;">${escapeHtml(input.policy || 'It takes less than a minute. Thank you for supporting a local business.')}</p>`,
      button: { label: 'Leave a review', url: input.reviewUrl },
      footerNote: 'Your review is public after moderation and linked to a real completed appointment.',
    }),
  };
}

export function staffInviteEmail(
  name: string,
  businessName: string,
  inviterName: string,
  url: string,
  businessLogo?: string | null,
): { subject: string; html: string } {
  const firstName = name.split(' ')[0] || 'there';
  return {
    subject: `${inviterName} invited you to join ${businessName} on Ojaly`,
    html: emailLayout({
      title: `You're invited to ${businessName}`,
      preheader: `${inviterName} has invited you to help manage ${businessName} on Ojaly.`,
      badge: { text: 'Team Invitation', tone: 'green', icon: '👥' },
      businessName,
      businessLogo,
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p><strong>${escapeHtml(inviterName)}</strong> has added you as a team member for <strong>${escapeHtml(businessName)}</strong> on Ojaly.</p>
      <p>As a staff member, you can help record customer sales, manage products, check stock levels, and issue digital receipts according to your role permissions.</p>
      
      <div style="background-color:${BRAND.forestSoft};border:1px solid ${BRAND.forestBorder};border-radius:14px;padding:16px 18px;margin:20px 0;font-size:13px;color:${BRAND.forest};">
        💼 Ready to collaborate? Tap below to accept the invitation and choose your secure password.
      </div>`,
      button: { label: 'Accept invite & set password', url },
      footerNote: 'If you were not expecting this invitation, you can safely ignore this email.',
    }),
  };
}

export function lowStockEmail(
  businessName: string,
  items: { name: string; remaining: number }[],
  url: string,
  businessLogo?: string | null,
  businessTagline?: string | null,
): { subject: string; html: string } {
  const rows = items
    .map(
      (i) => `<tr>
        <td style="padding:12px 14px;border-bottom:1px solid ${BRAND.border};font-size:14px;color:${BRAND.ink};"><strong>${escapeHtml(i.name)}</strong></td>
        <td align="right" style="padding:12px 14px;border-bottom:1px solid ${BRAND.border};font-size:13px;font-weight:700;">
          ${i.remaining <= 0 ? `<span style="background:${BRAND.dangerSoft};border:1px solid ${BRAND.dangerBorder};padding:4px 10px;border-radius:20px;color:${BRAND.danger};font-size:11px;font-weight:800;letter-spacing:0.5px;">OUT OF STOCK</span>` : `<span style="background:${BRAND.orangeSoft};border:1px solid ${BRAND.orangeBorder};padding:4px 10px;border-radius:20px;color:${BRAND.orange};font-size:12px;">${i.remaining} left</span>`}
        </td>
      </tr>`,
    )
    .join('');

  return {
    subject: `⚠️ Low stock alert for ${businessName}: ${items[0]?.name || 'Items running out'}`,
    html: emailLayout({
      title: 'Restock reminder for your store',
      preheader: `${items.length} product${items.length === 1 ? '' : 's'} at ${businessName} hit low-stock thresholds.`,
      badge: { text: 'Inventory Alert', tone: 'danger', icon: '⚠️' },
      businessName,
      businessLogo,
      businessTagline,
      body: `<p style="margin-top:0;">Don't miss customer sales! The following items in <strong>${escapeHtml(businessName)}</strong> are running low or out of stock:</p>
      
      <div style="background-color:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden;margin:18px 0 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr style="background-color:${BRAND.cream};border-bottom:1px solid ${BRAND.border};">
            <th align="left" style="padding:10px 14px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:${BRAND.muted};font-weight:700;">Product Name</th>
            <th align="right" style="padding:10px 14px;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:${BRAND.muted};font-weight:700;">Status</th>
          </tr>
          ${rows}
        </table>
      </div>
      <p style="font-size:14px;color:${BRAND.muted};">Update inventory in your dashboard to keep online orders running smoothly.</p>`,
      button: { label: 'Update stock levels', url },
      footerNote: 'Manage low-stock notification thresholds in Settings &rarr; Alerts.',
    }),
  };
}

export function debtReminderEmail(opts: {
  businessName: string;
  customerName: string;
  amountKobo: number;
  dueDate: string;
  paymentUrl?: string;
  businessPhone?: string;
  businessLogo?: string | null;
  businessTagline?: string | null;
}): { subject: string; html: string } {
  const firstName = opts.customerName.split(' ')[0] || opts.customerName;

  return {
    subject: `Friendly reminder: ${formatNaira(opts.amountKobo)} due to ${opts.businessName}`,
    html: emailLayout({
      title: 'A gentle balance reminder',
      preheader: `Your outstanding balance with ${opts.businessName} is ${formatNaira(opts.amountKobo)}, due ${opts.dueDate}.`,
      badge: { text: 'Payment Reminder', tone: 'gold', icon: '⏳' },
      businessName: opts.businessName,
      businessLogo: opts.businessLogo,
      businessTagline: opts.businessTagline,
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p>This is a quick and friendly reminder regarding your outstanding balance with <strong>${escapeHtml(opts.businessName)}</strong>.</p>
      
      <div style="background-color:${BRAND.cream};border-radius:18px;padding:24px 20px;margin:22px 0;border:1px solid ${BRAND.border};text-align:center;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${BRAND.muted};font-weight:700;">Amount Due</div>
        <div style="font-size:34px;font-weight:800;color:${BRAND.orange};margin:8px 0 6px;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk','DM Sans',Arial,sans-serif;">
          ${formatNaira(opts.amountKobo)}
        </div>
        <div style="display:inline-block;background-color:#ffffff;border:1px solid ${BRAND.border};border-radius:20px;padding:4px 12px;font-size:12px;color:${BRAND.muted};font-weight:600;">
          Due date: <strong style="color:${BRAND.ink};">${escapeHtml(opts.dueDate)}</strong>
        </div>
      </div>

      ${
        opts.paymentUrl
          ? `<div style="background-color:${BRAND.forestSoft};border:1px solid ${BRAND.forestBorder};padding:14px 16px;border-radius:14px;font-size:13px;color:${BRAND.forest};margin-bottom:18px;line-height:1.5;">
              💳 <strong>Instant online payment:</strong> You can clear this balance instantly using debit card or bank transfer via our secure Paystack link below.
            </div>`
          : ''
      }
      <p style="font-size:13px;color:${BRAND.muted};line-height:1.5;">Already made this transfer? Please feel free to ignore this reminder &mdash; thank you so much for patronising ${escapeHtml(opts.businessName)}!</p>`,
      ...(opts.paymentUrl ? { button: { label: `Pay ${formatNaira(opts.amountKobo)} online`, url: opts.paymentUrl } } : {}),
      footerNote: opts.businessPhone ? `For queries or confirmation, reach ${escapeHtml(opts.businessName)} directly at ${escapeHtml(opts.businessPhone)}.` : undefined,
    }),
  };
}

export function receiptEmail(opts: {
  businessName: string;
  customerName: string;
  receiptNumber: string;
  totalKobo: number;
  receiptUrl: string;
  items: { name: string; quantity: number; totalKobo: number }[];
  businessLogo?: string | null;
  businessTagline?: string | null;
}): { subject: string; html: string } {
  const firstName = opts.customerName.split(' ')[0] || opts.customerName;
  const rows = opts.items
    .map(
      (i) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};font-size:14px;color:${BRAND.ink};">
          <div style="font-weight:600;">${escapeHtml(i.name)}</div>
          <div style="font-size:12px;color:${BRAND.muted};margin-top:2px;">Qty: ${i.quantity}</div>
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid ${BRAND.border};font-size:14px;font-weight:700;color:${BRAND.ink};">
          ${formatNaira(i.totalKobo)}
        </td>
      </tr>`,
    )
    .join('');

  return {
    subject: `Receipt #${opts.receiptNumber} from ${opts.businessName}`,
    html: emailLayout({
      title: 'Payment confirmed & receipt',
      preheader: `Thank you for your payment of ${formatNaira(opts.totalKobo)} to ${opts.businessName}. Receipt #${opts.receiptNumber}.`,
      badge: { text: 'Official Receipt', tone: 'green', icon: '🧾' },
      businessName: opts.businessName,
      businessLogo: opts.businessLogo,
      businessTagline: opts.businessTagline,
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p>Thank you for supporting <strong>${escapeHtml(opts.businessName)}</strong>. Your payment has been received and verified.</p>
      
      <div style="background-color:${BRAND.cream};border-radius:18px;padding:22px;margin:22px 0;border:1px solid ${BRAND.border};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
          <tr>
            <td style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${BRAND.muted};font-weight:700;">Receipt #${escapeHtml(opts.receiptNumber)}</td>
            <td align="right">
              <span style="background-color:${BRAND.forestSoft};border:1px solid ${BRAND.forestBorder};color:${BRAND.forest};font-size:11px;font-weight:800;padding:3px 9px;border-radius:12px;letter-spacing:0.5px;">PAID IN FULL</span>
            </td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 16px;">
          ${rows}
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px dashed ${BRAND.border};padding-top:14px;">
          <tr>
            <td style="font-size:15px;font-weight:700;color:${BRAND.ink};vertical-align:middle;">Total Amount Paid</td>
            <td align="right" style="font-size:24px;font-weight:800;color:${BRAND.orange};font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk','DM Sans',Arial,sans-serif;vertical-align:middle;">
              ${formatNaira(opts.totalKobo)}
            </td>
          </tr>
        </table>
      </div>`,
      button: { label: 'View & download receipt', url: opts.receiptUrl },
      footerNote: 'Please retain this digital receipt for your records.',
    }),
  };
}

export function invoiceEmail(opts: {
  businessName: string;
  customerName: string;
  invoiceNumber: string;
  totalKobo: number;
  dueDate: string;
  invoiceUrl: string;
  paymentUrl?: string;
  businessLogo?: string | null;
  businessTagline?: string | null;
}): { subject: string; html: string } {
  const firstName = opts.customerName.split(' ')[0] || opts.customerName;

  return {
    subject: `Invoice #${opts.invoiceNumber} from ${opts.businessName}`,
    html: emailLayout({
      title: `Invoice #${opts.invoiceNumber}`,
      preheader: `Invoice for ${formatNaira(opts.totalKobo)} from ${opts.businessName}, due ${opts.dueDate}.`,
      badge: { text: 'New Invoice', tone: 'orange', icon: '💳' },
      businessName: opts.businessName,
      businessLogo: opts.businessLogo,
      businessTagline: opts.businessTagline,
      body: `<p style="margin-top:0;">Hi ${escapeHtml(firstName)},</p>
      <p>Here is your new invoice from <strong>${escapeHtml(opts.businessName)}</strong>:</p>
      
      <div style="background-color:${BRAND.cream};border-radius:18px;padding:24px 20px;margin:22px 0;border:1px solid ${BRAND.border};text-align:center;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${BRAND.muted};font-weight:700;">Total Balance Due</div>
        <div style="font-size:34px;font-weight:800;color:${BRAND.ink};margin:8px 0 6px;letter-spacing:-0.5px;font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk','DM Sans',Arial,sans-serif;">
          ${formatNaira(opts.totalKobo)}
        </div>
        <div style="display:inline-block;background-color:#ffffff;border:1px solid ${BRAND.border};border-radius:20px;padding:4px 12px;font-size:12px;color:${BRAND.muted};font-weight:600;">
          Due date: <strong style="color:${BRAND.ink};">${escapeHtml(opts.dueDate)}</strong>
        </div>
      </div>`,
      button: { label: opts.paymentUrl ? 'Pay invoice online' : 'View invoice details', url: opts.paymentUrl || opts.invoiceUrl },
      footerNote: 'Thank you for your business!',
    }),
  };
}

export function summaryEmail(opts: {
  businessName: string;
  periodLabel: string;
  revenueKobo: number;
  profitKobo: number;
  expensesKobo: number;
  newDebtsKobo: number;
  topProduct?: string;
  lowStockCount: number;
  dashboardUrl: string;
  businessLogo?: string | null;
  businessTagline?: string | null;
}): { subject: string; html: string } {
  const statBox = (label: string, value: string, color = BRAND.ink, sublabel?: string) => `
    <td width="50%" style="padding:6px;">
      <div style="background-color:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:14px;padding:16px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:${BRAND.muted};font-weight:700;margin-bottom:6px;">${label}</div>
        <div style="font-size:22px;font-weight:800;color:${color};letter-spacing:-0.4px;font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk','DM Sans',Arial,sans-serif;">${value}</div>
        ${sublabel ? `<div style="font-size:11px;color:${BRAND.muted};margin-top:4px;">${sublabel}</div>` : ''}
      </div>
    </td>`;

  return {
    subject: `📊 Your ${opts.periodLabel} performance summary: ${opts.businessName}`,
    html: emailLayout({
      title: `Your ${opts.periodLabel} numbers are ready`,
      preheader: `Profit: ${formatNaira(opts.profitKobo)} | Revenue: ${formatNaira(opts.revenueKobo)} for ${opts.businessName}.`,
      badge: { text: 'Performance Report', tone: 'green', icon: '📊' },
      businessName: opts.businessName,
      businessLogo: opts.businessLogo,
      businessTagline: opts.businessTagline,
      body: `<p style="margin-top:0;">Here is how <strong>${escapeHtml(opts.businessName)}</strong> performed during this period:</p>
      
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="stat-table" style="margin:16px -6px;">
        <tr>
          ${statBox('Total Revenue', formatNaira(opts.revenueKobo), BRAND.ink, 'Collected payments')}
          ${statBox('Gross Profit', formatNaira(opts.profitKobo), opts.profitKobo >= 0 ? BRAND.success : BRAND.danger, 'Revenue minus COGS')}
        </tr>
        <tr>
          ${statBox('Expenses', formatNaira(opts.expensesKobo), BRAND.ink, 'Logged store costs')}
          ${statBox('New Debts', formatNaira(opts.newDebtsKobo), opts.newDebtsKobo > 0 ? BRAND.gold : BRAND.muted, 'Customer credit issued')}
        </tr>
      </table>

      <div style="background-color:${BRAND.forestSoft};border:1px solid ${BRAND.forestBorder};border-radius:14px;padding:14px 16px;margin:18px 0;font-size:13px;color:${BRAND.forest};line-height:1.5;">
        ${opts.topProduct ? `<div>🌟 <strong>Top seller:</strong> ${escapeHtml(opts.topProduct)}</div>` : ''}
        <div style="margin-top:${opts.topProduct ? '6px' : '0'};">
          ${opts.lowStockCount > 0 ? `⚠️ <strong>${opts.lowStockCount} item${opts.lowStockCount === 1 ? '' : 's'}</strong> require restocking.` : '✅ All inventory levels are healthy.'}
        </div>
      </div>`,
      button: { label: 'Explore detailed reports', url: opts.dashboardUrl },
      footerNote: 'Manage daily or weekly frequency and delivery time in Settings &rarr; Summaries.',
    }),
  };
}

export function storefrontMessageEmail(opts: {
  businessName: string;
  customerName: string;
  customerPhone: string;
  message: string;
  dashboardUrl: string;
  businessLogo?: string | null;
  businessTagline?: string | null;
}): { subject: string; html: string } {
  return {
    subject: `💬 New website inquiry from ${opts.customerName}`,
    html: emailLayout({
      title: 'New customer message',
      preheader: `${opts.customerName} (${opts.customerPhone}) sent an inquiry via ${opts.businessName}'s website.`,
      badge: { text: 'Customer Inquiry', tone: 'orange', icon: '💬' },
      businessName: opts.businessName,
      businessLogo: opts.businessLogo,
      businessTagline: opts.businessTagline,
      body: `<p style="margin-top:0;">A shopper sent an inquiry through your online storefront for <strong>${escapeHtml(opts.businessName)}</strong>:</p>
      
      <div style="background-color:${BRAND.cream};border-left:4px solid ${BRAND.orange};border-radius:0 14px 14px 0;padding:16px 18px;margin:18px 0;font-size:15px;color:${BRAND.ink};border-top:1px solid ${BRAND.border};border-right:1px solid ${BRAND.border};border-bottom:1px solid ${BRAND.border};">
        <div style="font-size:12px;font-weight:800;color:${BRAND.muted};text-transform:uppercase;margin-bottom:8px;">
          ${escapeHtml(opts.customerName)} &middot; <span style="color:${BRAND.ink};">${escapeHtml(opts.customerPhone)}</span>
        </div>
        <div style="font-style:italic;line-height:1.6;">&ldquo;${escapeHtml(opts.message)}&rdquo;</div>
      </div>
      <p style="font-size:13px;color:${BRAND.muted};">Fast replies convert 3x more shoppers into repeat buyers. Tap below to respond immediately.</p>`,
      button: { label: 'View in notification center', url: opts.dashboardUrl },
      footerNote: 'Tip: You can enable instant WhatsApp alerts in Settings &rarr; Notifications.',
    }),
  };
}

export function paymentFailedEmail(
  businessName: string,
  planName: string,
  url: string,
  businessLogo?: string | null,
): { subject: string; html: string } {
  return {
    subject: `Subscription renewal notice for ${businessName}`,
    html: emailLayout({
      title: 'Subscription payment needed',
      preheader: `We were unable to process your payment for ${planName} at ${businessName}.`,
      badge: { text: 'Billing Notice', tone: 'danger', icon: '⚡' },
      businessName,
      businessLogo,
      body: `<p style="margin-top:0;">We were unable to process your recent renewal payment for <strong>${escapeHtml(businessName)}</strong> (${escapeHtml(planName)}).</p>
      
      <div style="background-color:${BRAND.dangerSoft};border:1px solid ${BRAND.dangerBorder};border-radius:14px;padding:16px 18px;margin:18px 0;font-size:13px;color:#991B1B;line-height:1.5;">
        🔒 Don't worry &mdash; your business catalogue, storefront, and sales history remain completely secure and safe.
      </div>
      <p>Please update your card or retry the transaction to continue enjoying all premium features.</p>`,
      button: { label: 'Retry payment now', url },
      footerNote: 'If funds were debited from your bank account, reply directly with your payment reference.',
    }),
  };
}

export function orderNotificationSellerEmail(opts: {
  businessName: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  totalKobo: number;
  itemCount: number;
  orderUrl: string;
  businessLogo?: string | null;
  businessTagline?: string | null;
}): { subject: string; html: string } {
  return {
    subject: `🛍️ New online order #${opts.orderNumber} (${formatNaira(opts.totalKobo)})`,
    html: emailLayout({
      title: 'New customer order received!',
      preheader: `${opts.customerName} placed order #${opts.orderNumber} for ${formatNaira(opts.totalKobo)}.`,
      badge: { text: 'New Order', tone: 'green', icon: '🛍️' },
      businessName: opts.businessName,
      businessLogo: opts.businessLogo,
      businessTagline: opts.businessTagline,
      body: `<p style="margin-top:0;">You just received a new online order on <strong>${escapeHtml(opts.businessName)}</strong>!</p>
      
      <div style="background-color:${BRAND.cream};border-radius:18px;padding:22px;margin:20px 0;border:1px solid ${BRAND.border};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:${BRAND.muted};font-weight:700;">Order #${escapeHtml(opts.orderNumber)}</td>
            <td align="right" style="font-size:16px;font-weight:800;color:${BRAND.orange};font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk','DM Sans',Arial,sans-serif;">${formatNaira(opts.totalKobo)}</td>
          </tr>
        </table>
        <div style="margin-top:14px;font-size:14px;color:${BRAND.ink};line-height:1.6;">
          <div>👤 <strong>Customer:</strong> ${escapeHtml(opts.customerName)} (${escapeHtml(opts.customerPhone)})</div>
          <div style="margin-top:4px;">📦 <strong>Items:</strong> ${opts.itemCount} item(s) ordered</div>
        </div>
      </div>
      <p style="font-size:14px;color:${BRAND.muted};">Open your dashboard to confirm delivery, print receipt, or contact the customer on WhatsApp.</p>`,
      button: { label: 'View & fulfill order', url: opts.orderUrl },
      footerNote: 'Keep inventory up-to-date and fulfill orders promptly for 5-star customer ratings.',
    }),
  };
}

export interface WaitlistOpeningEmailInput {
  customerName: string;
  businessName: string;
  businessLogo?: string | null;
  businessTagline?: string | null;
  businessSlug?: string;
  serviceName: string;
  windowLabel: string;
  bookingUrl: string;
}

export function waitlistOpeningEmail(input: WaitlistOpeningEmailInput): { subject: string; html: string } {
  const firstName = input.customerName.split(' ')[0] || 'there';
  return {
    subject: `A spot may be open for ${input.serviceName}`,
    html: emailLayout({
      title: 'A spot may have opened',
      preheader: `${input.serviceName} at ${input.businessName} · ${input.windowLabel}`,
      badge: { text: 'Waitlist update', tone: 'orange', icon: '◷' },
      headerType: 'business',
      businessName: input.businessName,
      businessLogo: input.businessLogo,
      businessTagline: input.businessTagline,
      businessSlug: input.businessSlug,
      body: `<p style="margin-top:0;">Hi <strong>${escapeHtml(firstName)}</strong>,</p>
        <p>A slot may have opened for <strong>${escapeHtml(input.serviceName)}</strong> at <strong>${escapeHtml(input.businessName)}</strong> in your preferred window.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background-color:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:14px;">
          <tr><td style="padding:16px 18px;"><p style="margin:0 0 3px;color:${BRAND.muted};font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">Preferred window</p><p style="margin:0;color:${BRAND.ink};font-size:16px;font-weight:800;">${escapeHtml(input.windowLabel)}</p><p style="margin:4px 0 0;color:${BRAND.muted};font-size:12px;">${escapeHtml(input.serviceName)}</p></td></tr>
        </table>
        <p style="margin:0;color:${BRAND.muted};font-size:12px;line-height:1.6;">Availability moves quickly. If the slot is gone, you can join the waitlist again.</p>`,
      button: { label: 'Check availability', url: input.bookingUrl },
      footerNote: 'You are receiving this because you joined the waitlist for this service.',
    }),
  };
}

export interface BookingReminderEmailInput {
  customerName: string;
  businessName: string;
  businessLogo?: string | null;
  businessTagline?: string | null;
  businessSlug?: string;
  serviceName: string;
  providerName: string;
  dateLabel: string;
  timeLabel: string;
  reference: string;
  location?: string | null;
  manageUrl: string;
  calendarUrl: string;
}

export function bookingReminderEmail(input: BookingReminderEmailInput): { subject: string; html: string } {
  const firstName = input.customerName.split(' ')[0] || 'there';
  return {
    subject: `Reminder: ${input.serviceName} at ${input.businessName}`,
    html: emailLayout({
      title: 'See you soon',
      preheader: `${input.serviceName} · ${input.dateLabel} at ${input.timeLabel}`,
      badge: { text: 'Appointment reminder', tone: 'orange', icon: '◷' },
      headerType: 'business',
      businessName: input.businessName,
      businessLogo: input.businessLogo,
      businessTagline: input.businessTagline,
      businessSlug: input.businessSlug,
      body: `<p style="margin-top:0;">Hi <strong>${escapeHtml(firstName)}</strong>,</p>
        <p>This is a reminder that your <strong>${escapeHtml(input.serviceName)}</strong> with <strong>${escapeHtml(input.providerName)}</strong> is coming up.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background-color:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:14px;">
          <tr><td style="padding:16px 18px;"><p style="margin:0;color:${BRAND.ink};font-size:19px;font-weight:800;">${escapeHtml(input.dateLabel)} · ${escapeHtml(input.timeLabel)}</p><p style="margin:4px 0 0;color:${BRAND.muted};font-size:12px;">${escapeHtml(input.serviceName)} · ${escapeHtml(input.providerName)} · ${escapeHtml(input.reference)}</p></td></tr>
        </table>
        <p style="margin:0;color:${BRAND.muted};font-size:12px;line-height:1.6;">Need to move it? Manage your booking below.</p>`,
      button: { label: 'Manage booking', url: input.manageUrl },
      secondaryButton: { label: 'Add to calendar', url: input.calendarUrl },
      footerNote: 'Arrive a few minutes early so the appointment can start on time.',
    }),
  };
}

export function phoneCodeEmail(name: string, code: string): { subject: string; html: string } {
  const firstName = (name || 'there').split(' ')[0];
  return {
    subject: `Your Ojaly code: ${code}`,
    html: emailLayout({
      title: 'Your sign-in code',
      preheader: `Use code ${code} to continue. It expires in 10 minutes.`,
      badge: { text: 'Secure sign in', tone: 'green', icon: '✓' },
      body: `<p style="margin-top:0;">Hi <strong>${escapeHtml(firstName)}</strong>,</p>
        <p>Use this one-time code to continue:</p>
        <p style="margin:18px 0 8px;color:${BRAND.ink};font-size:32px;font-weight:800;letter-spacing:6px;font-family:-apple-system,BlinkMacSystemFont,'Space Grotesk',Arial,sans-serif;">${escapeHtml(code)}</p>
        <p style="margin:0;color:${BRAND.muted};font-size:12px;line-height:1.6;">The code expires in 10 minutes. If you did not request it, ignore this email and keep your account secure.</p>`,
      footerNote: 'Ojaly will never ask you for this code by phone, WhatsApp or social media.',
    }),
  };
}

export function campusApplicationEmail(application: { name: string; phone: string; email?: string | null; year?: string; socials?: string; why?: string }, campusName: string): { subject: string; html: string } {
  return {
    subject: `Campus ambassador application · ${campusName}`,
    html: emailLayout({
      title: 'New campus ambassador application',
      preheader: `${application.name} applied for ${campusName}.`,
      badge: { text: 'Internal application', tone: 'neutral', icon: '●' },
      body: `<p style="margin-top:0;"><strong>${escapeHtml(application.name)}</strong> applied to represent <strong>${escapeHtml(campusName)}</strong>.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:${BRAND.cream};border:1px solid ${BRAND.border};border-radius:12px;">
          <tr><td style="padding:8px 14px;color:${BRAND.muted};font-size:12px;">Phone</td><td align="right" style="padding:8px 14px;color:${BRAND.ink};font-size:12px;font-weight:700;">${escapeHtml(application.phone)}</td></tr>
          <tr><td style="padding:8px 14px;color:${BRAND.muted};font-size:12px;">Email</td><td align="right" style="padding:8px 14px;color:${BRAND.ink};font-size:12px;font-weight:700;">${escapeHtml(application.email || '—')}</td></tr>
          <tr><td style="padding:8px 14px;color:${BRAND.muted};font-size:12px;">Year</td><td align="right" style="padding:8px 14px;color:${BRAND.ink};font-size:12px;font-weight:700;">${escapeHtml(application.year || '—')}</td></tr>
          <tr><td style="padding:8px 14px;color:${BRAND.muted};font-size:12px;">Socials</td><td align="right" style="padding:8px 14px;color:${BRAND.ink};font-size:12px;font-weight:700;">${escapeHtml(application.socials || '—')}</td></tr>
        </table>
        <p style="margin:0;color:${BRAND.muted};font-size:13px;line-height:1.6;">${escapeHtml(application.why || 'No additional note.')}</p>`,
      footerNote: 'Review this application in Ojaly Ops → Campus applications.',
    }),
  };
}
