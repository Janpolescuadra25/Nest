import { Resend } from 'resend';

// ── Singleton ─────────────────────────────────────────────────────────────────

let resendClient: Resend | null = null;

export function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY is not set');
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return 'unknown';
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function emailWrapper(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f8fafc;margin:0;padding:40px 20px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
    <div style="background:#0f172a;padding:24px 32px;">
      <span style="color:#22d3ee;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Nest</span>
    </div>
    <div style="padding:32px;">
      ${body}
    </div>
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:12px;margin:0;">This message was sent automatically by Nest. If you didn't expect this email, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>`;
}

function customMessageBlock(customExpiryMessage: string | null | undefined): string {
  if (!customExpiryMessage || !customExpiryMessage.trim()) return '';
  return `
    <div style="border-left:4px solid #22d3ee;background:#f0fdff;border-radius:0 8px 8px 0;padding:16px;margin:20px 0;">
      <p style="color:#0e7490;font-size:14px;margin:0;line-height:1.6;">${customExpiryMessage.trim()}</p>
    </div>`;
}

// ── sendWelcomeEmail ──────────────────────────────────────────────────────────

export async function sendWelcomeEmail({
  to,
  name,
  tempPassword,
}: {
  to: string;
  name: string | null | undefined;
  tempPassword: string;
}): Promise<void> {
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${displayName},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Your Nest account has been created. You can log in with the email address this was sent to.
      </p>
      <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:16px;">
        <p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;font-weight:600;">Temporary Password</p>
        <p style="font-family:'Courier New',Courier,monospace;font-size:22px;color:#0f172a;font-weight:700;letter-spacing:0.12em;margin:0;">${tempPassword}</p>
      </div>
      <p style="color:#64748b;font-size:13px;line-height:1.5;margin:0;">
        You'll be asked to change this password after your first login.
      </p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@nestapp.io',
      to,
      subject: 'Welcome to Nest',
      html,
    });
    console.log(`[Email] Welcome email sent to ${to}`);
  } catch (err) {
    console.error('[Email] sendWelcomeEmail failed:', err);
  }
}

// ── sendTrialWarning ──────────────────────────────────────────────────────────

export async function sendTrialWarning({
  to,
  name,
  trialExpiresAt,
  daysRemaining,
  customExpiryMessage,
}: {
  to: string;
  name: string | null | undefined;
  trialExpiresAt: Date | string | null;
  daysRemaining: number;
  customExpiryMessage: string | null | undefined;
}): Promise<void> {
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;
    const formattedDate = formatDate(trialExpiresAt);
    const dayLabel = daysRemaining === 1 ? 'day' : 'days';

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${displayName},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Your Nest trial access will expire on <strong style="color:#0f172a;">${formattedDate}</strong>.
        After expiry, your permissions will be revoked — scan, map, sync, and location management.
      </p>
      ${customMessageBlock(customExpiryMessage)}
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:16px 0 0;">
        Contact your account administrator if you'd like to extend your access.
      </p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@nestapp.io',
      to,
      subject: `Your Nest trial expires in ${daysRemaining} ${dayLabel}`,
      html,
    });
    console.log(`[Email] Trial warning (${daysRemaining}d) sent to ${to}`);
  } catch (err) {
    console.error('[Email] sendTrialWarning failed:', err);
  }
}

// ── sendTrialExpired ──────────────────────────────────────────────────────────

export async function sendTrialExpired({
  to,
  name,
  trialExpiresAt,
  customExpiryMessage,
}: {
  to: string;
  name: string | null | undefined;
  trialExpiresAt: Date | string | null;
  customExpiryMessage: string | null | undefined;
}): Promise<void> {
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;
    const formattedDate = formatDate(trialExpiresAt);

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${displayName},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Your Nest trial access expired on <strong style="color:#0f172a;">${formattedDate}</strong>.
        Your permissions have been revoked. Your role is unchanged — contact your administrator to regain access.
      </p>
      ${customMessageBlock(customExpiryMessage)}
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:16px 0 0;">
        Contact your account administrator if you'd like to restore your access.
      </p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@nestapp.io',
      to,
      subject: 'Your Nest trial has expired',
      html,
    });
    console.log(`[Email] Trial expired email sent to ${to}`);
  } catch (err) {
    console.error('[Email] sendTrialExpired failed:', err);
  }
}

// ── sendTrialRenewed ─────────────────────────────────────────────────────────

export async function sendTrialRenewed({
  to,
  name,
  newExpiryDate,
  customExpiryMessage,
}: {
  to: string;
  name: string | null | undefined;
  newExpiryDate: Date;
  customExpiryMessage: string | null | undefined;
}): Promise<void> {
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;
    const formattedDate = formatDate(newExpiryDate);

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${displayName},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Your Nest trial has been renewed by your administrator.
        Your new access expiry date is <strong style="color:#0f172a;">${formattedDate}</strong>.
      </p>
      ${customMessageBlock(customExpiryMessage)}
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:16px 0 0;">
        If you have any questions, contact your administrator.
      </p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@nestapp.io',
      to,
      subject: 'Your Nest trial has been renewed',
      html,
    });
    console.log(`[Email] Trial renewed email sent to ${to}`);
  } catch (err) {
    console.error('[Email] sendTrialRenewed failed:', err);
  }
}
