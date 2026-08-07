import type { OutgoingMail } from './mailer.service';

/** Where the emailed links point — the web app, not the API. */
function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

const SIGNATURE = '— CommunityHub';

/**
 * Text-first, with a minimal HTML twin. No images, no tracking pixels, no
 * external stylesheet: mail clients strip most of it anyway, and a link that
 * survives plain text survives everywhere.
 */
function wrap(heading: string, lines: string[], url: string, cta: string) {
  const text = [...lines, '', url, '', SIGNATURE].join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#18181b">
      <h1 style="font-size:18px;margin:0 0 12px">${heading}</h1>
      ${lines.map((l) => `<p style="margin:0 0 12px">${l}</p>`).join('')}
      <p style="margin:20px 0">
        <a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${cta}</a>
      </p>
      <p style="margin:0 0 12px;font-size:13px;color:#71717a">
        If the button does not work, paste this into your browser:<br>
        <a href="${url}">${url}</a>
      </p>
      <p style="margin:20px 0 0;font-size:13px;color:#71717a">${SIGNATURE}</p>
    </div>
  `.trim();

  return { text, html };
}

export function passwordResetMail(to: string, token: string): OutgoingMail {
  const url = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const { text, html } = wrap(
    'Reset your password',
    [
      'Someone asked to reset the password for this CommunityHub account.',
      'The link works once and expires in 1 hour.',
      // stated because the request endpoint answers identically for unknown
      // addresses — a stranger who receives this needs to know to ignore it
      'If that was not you, ignore this email. Your password stays as it is.',
    ],
    url,
    'Reset password',
  );

  return { to, subject: 'Reset your CommunityHub password', text, html };
}

export function verifyEmailMail(to: string, token: string): OutgoingMail {
  const url = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const { text, html } = wrap(
    'Confirm your email',
    [
      'Confirm this address so you can recover your CommunityHub account if you ever forget your password.',
      'The link works once and expires in 24 hours.',
      'If you did not create this account, ignore this email.',
    ],
    url,
    'Confirm email',
  );

  return { to, subject: 'Confirm your CommunityHub email', text, html };
}
