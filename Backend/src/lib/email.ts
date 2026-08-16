import { Resend } from 'resend';
import { logger } from './logger';
import { formatBytes } from './utils';

const log = logger.child({ module: 'Email' });

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

function escapeHtml(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
      <span style="color:#22d3ee;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Qyra</span>
    </div>
    <div style="padding:32px;">
      ${body}
    </div>
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="color:#94a3b8;font-size:12px;margin:0;">This message was sent automatically by Qyra. If you didn't expect this email, you can safely ignore it.</p>
    </div>
  </div>
</body>
</html>`;
}

function customMessageBlock(customExpiryMessage: string | null | undefined): string {
  if (!customExpiryMessage || !customExpiryMessage.trim()) return '';
  return `
    <div style="border-left:4px solid #22d3ee;background:#f0fdff;border-radius:0 8px 8px 0;padding:16px;margin:20px 0;">
      <p style="color:#0e7490;font-size:14px;margin:0;line-height:1.6;">${escapeHtml(customExpiryMessage.trim())}</p>
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
}): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(displayName)},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Your Qyra account has been created. You can log in with the email address this was sent to.
      </p>
      <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:16px;">
        <p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;font-weight:600;">Temporary Password</p>
        <p style="font-family:'Courier New',Courier,monospace;font-size:22px;color:#0f172a;font-weight:700;letter-spacing:0.12em;margin:0;">${tempPassword}</p>
      </div>
      <p style="color:#64748b;font-size:13px;line-height:1.5;margin:0 0 24px;">
        You'll be asked to change this password after your first login.
      </p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Your partner application has been approved. You now have admin access to manage your team and sync financial data to QuickBooks.
      </p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 12px;">To get started:</p>
      <ol style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;padding-left:20px;">
        <li>Install the Qyra extension from the Chrome Web Store</li>
        <li>Log in with your email and the password above</li>
        <li>Connect your QuickBooks Online account</li>
        <li>Invite your team members</li>
      </ol>
      <p style="margin:0 0 24px;"><a href="https://chromewebstore.google.com/detail/nest-restaurant-financial/ccghhfmkjbcakhnoamgihifonfiammoc" style="color:#22d3ee;text-decoration:none;">Install Qyra from the Chrome Web Store</a></p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@qyra.space',
      to,
      subject: 'Welcome to Qyra',
      html,
    });
    if (process.env.NODE_ENV !== 'production') {
      log.info({ to }, `Welcome email sent to ${to}`);
    }
    return { success: true };
  } catch (err) {
    log.error({ err }, 'sendWelcomeEmail failed');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── sendVerificationEmail ───────────────────────────────────────────────────

export async function sendVerificationEmail({
  to,
  name,
  verificationLink,
}: {
  to: string;
  name: string | null | undefined;
  verificationLink: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!process.env.APP_URL) {
    log.warn('APP_URL not configured — verification links will be broken');
  }
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(displayName)},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Thanks for signing up for Qyra. Please verify your email address by clicking the button below.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${verificationLink}"
           style="display:inline-block;background:#22d3ee;color:#0f172a;font-size:16px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.02em;">
          Verify Email
        </a>
      </div>
      <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
        If you did not sign up for Qyra, you can safely ignore this email.
      </p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@qyra.space',
      to,
      subject: 'Verify your Qyra email',
      html,
    });
    if (process.env.NODE_ENV !== 'production') {
      log.info({ to }, `Verification email sent to ${to}`);
    }
    return { success: true };
  } catch (err) {
    log.error({ err }, 'sendVerificationEmail failed');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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
}): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;
    const formattedDate = formatDate(trialExpiresAt);
    const dayLabel = daysRemaining === 1 ? 'day' : 'days';

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(displayName)},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Your Qyra trial access will expire on <strong style="color:#0f172a;">${formattedDate}</strong>.
        After expiry, your permissions will be revoked — scan, map, sync, and location management.
      </p>
      ${customMessageBlock(customExpiryMessage)}
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:16px 0 0;">
        Contact your account administrator if you'd like to extend your access.
      </p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@qyra.space',
      to,
      subject: `Your Qyra trial expires in ${daysRemaining} ${dayLabel}`,
      html,
    });
    if (process.env.NODE_ENV !== 'production') {
      log.info({ to, daysRemaining }, `Trial warning (${daysRemaining}d) sent to ${to}`);
    }
    return { success: true };
  } catch (err) {
    log.error({ err }, 'sendTrialWarning failed');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendSyncFailureAlert({
  to,
  name,
  staleCount,
  maxRetriedCount,
  oldFailureCount,
  dashboardLink,
}: {
  to: string;
  name: string | null | undefined;
  staleCount: number;
  maxRetriedCount: number;
  oldFailureCount: number;
  dashboardLink: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;
    const total = staleCount + maxRetriedCount + oldFailureCount;

    if (!process.env.APP_URL) {
      log.warn('APP_URL not set, using fallback dashboard link');
    }

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(displayName)},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        There are <strong style="color:#0f172a;">${total}</strong> scan${total !== 1 ? 's' : ''} that need attention in Qyra.
        This includes data that is stale or sync failures requiring a manual review.
      </p>
      <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:16px;">
        <p style="color:#0f172a;font-size:14px;font-weight:700;margin:0 0 12px;">Attention summary</p>
        <ul style="color:#475569;font-size:14px;line-height:1.8;margin:0;padding-left:18px;">
          ${staleCount > 0 ? `<li>⏰ ${staleCount} stale scan${staleCount !== 1 ? 's' : ''}</li>` : ''}
          ${maxRetriedCount > 0 ? `<li>⛔ ${maxRetriedCount} max-retried scan${maxRetriedCount !== 1 ? 's' : ''}</li>` : ''}
          ${oldFailureCount > 0 ? `<li>⚠️ ${oldFailureCount} old failed scan${oldFailureCount !== 1 ? 's' : ''}</li>` : ''}
        </ul>
      </div>
      ${maxRetriedCount > 0 ? `<div style="border-left:4px solid #22d3ee;background:#f0fdff;border-radius:0 8px 8px 0;padding:12px 16px;margin:0 0 16px;"><p style="color:#0f172a;font-size:14px;line-height:1.6;margin:0;"><strong>Action required:</strong> Scans with maximum retry attempts require a manual re-sync from the Preview tab.</p></div>` : ''}
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${escapeHtml(dashboardLink)}"
           style="display:inline-block;background:#22d3ee;color:#0f172a;font-size:16px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.02em;">
          View dashboard
        </a>
      </div>
      <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
        These alerts are sent once every 24 hours for your team. If new attention items appear after that window, a new alert will be sent.
      </p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@qyra.space',
      to,
      subject: `Action needed: ${total} scan${total !== 1 ? 's' : ''} need${total === 1 ? 's' : ''} attention`,
      html,
    });
    if (process.env.NODE_ENV !== 'production') {
      log.info({ to, total }, `Sync failure alert sent to ${to}`);
    }
    return { success: true };
  } catch (err) {
    log.error({ err }, 'sendSyncFailureAlert failed');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendQuotaWarning({
  to,
  name,
  currentUsage,
  maxStorage,
  percentage,
}: {
  to: string;
  name: string;
  currentUsage: number;
  maxStorage: number;
  percentage: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResendClient();
    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Your team is using <strong style="color:#0f172a;">${percentage.toFixed(0)}%</strong> of your configured storage limit.
      </p>
      <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:16px;">
        <p style="color:#0f172a;font-size:14px;font-weight:700;margin:0 0 12px;">Storage usage</p>
        <p style="color:#475569;font-size:14px;line-height:1.6;margin:0;">${escapeHtml(formatBytes(currentUsage))} of ${escapeHtml(formatBytes(maxStorage))} used.</p>
      </div>
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 16px;">
        You are approaching your storage limit. Upgrade your plan or remove old attachments to avoid sync interruptions.
      </p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@qyra.space',
      to,
      subject: 'Storage quota warning — Qyra',
      html,
    });
    if (process.env.NODE_ENV !== 'production') {
      log.info({ to, percentage }, `Quota warning sent to ${to}`);
    }
    return { success: true };
  } catch (err) {
    log.error({ err }, 'sendQuotaWarning failed');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendTeamChangeAlert({
  to,
  name,
  memberName,
  memberEmail,
  action,
}: {
  to: string;
  name: string;
  memberName: string;
  memberEmail: string;
  action: 'joined' | 'removed';
}): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResendClient();
    const verb = action === 'joined' ? 'joined your team' : 'was removed from your team';
    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        <strong style="color:#0f172a;">${escapeHtml(memberName)}</strong> (${escapeHtml(memberEmail)}) ${verb}.
      </p>
      <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:16px;">
        <p style="color:#0f172a;font-size:14px;font-weight:700;margin:0 0 12px;">Team change details</p>
        <p style="color:#475569;font-size:14px;line-height:1.6;margin:0;">Member: ${escapeHtml(memberName)}</p>
        <p style="color:#475569;font-size:14px;line-height:1.6;margin:0;">Email: ${escapeHtml(memberEmail)}</p>
        <p style="color:#475569;font-size:14px;line-height:1.6;margin:0;">Action: ${escapeHtml(action)}</p>
      </div>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@qyra.space',
      to,
      subject: `Team member ${action} — Qyra`,
      html,
    });
    if (process.env.NODE_ENV !== 'production') {
      log.info({ to, action }, `Team change alert sent to ${to}`);
    }
    return { success: true };
  } catch (err) {
    log.error({ err }, 'sendTeamChangeAlert failed');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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
}): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;
    const formattedDate = formatDate(trialExpiresAt);

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(displayName)},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Your Qyra trial access expired on <strong style="color:#0f172a;">${formattedDate}</strong>.
        Your permissions have been revoked. Your role is unchanged — contact your administrator to regain access.
      </p>
      ${customMessageBlock(customExpiryMessage)}
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:16px 0 0;">
        Contact your account administrator if you'd like to restore your access.
      </p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@qyra.space',
      to,
      subject: 'Your Qyra trial has expired',
      html,
    });
    if (process.env.NODE_ENV !== 'production') {
      log.info({ to }, `Trial expired email sent to ${to}`);
    }
    return { success: true };
  } catch (err) {
    log.error({ err }, 'sendTrialExpired failed');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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
}): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;
    const formattedDate = formatDate(newExpiryDate);

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(displayName)},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
        Your Qyra trial has been renewed by your administrator.
        Your new access expiry date is <strong style="color:#0f172a;">${formattedDate}</strong>.
      </p>
      ${customMessageBlock(customExpiryMessage)}
      <p style="color:#64748b;font-size:14px;line-height:1.6;margin:16px 0 0;">
        If you have any questions, contact your administrator.
      </p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@qyra.space',
      to,
      subject: 'Your Qyra trial has been renewed',
      html,
    });
    if (process.env.NODE_ENV !== 'production') {
      log.info({ to }, `Trial renewed email sent to ${to}`);
    }
    return { success: true };
  } catch (err) {
    log.error({ err }, 'sendTrialRenewed failed');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── sendPasswordResetEmail ────────────────────────────────────────────────────

export async function sendPasswordResetEmail({
  to,
  name,
  resetLink,
}: {
  to: string;
  name: string | null | undefined;
  resetLink: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!process.env.APP_URL) {
    log.warn('APP_URL not configured — password reset links will be broken');
  }
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(displayName)},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        We received a request to reset your Qyra password. Click the link below to set a new password.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${resetLink}"
           style="display:inline-block;background:#22d3ee;color:#0f172a;font-size:16px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:8px;letter-spacing:0.02em;">
          Reset Password
        </a>
      </div>
      <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0;">
        This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
      </p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@qyra.space',
      to,
      subject: 'Reset your Qyra password',
      html,
    });
    if (process.env.NODE_ENV !== 'production') {
      log.info({ to }, `Password reset email sent to ${to}`);
    }
    return { success: true };
  } catch (err) {
    log.error({ err }, 'sendPasswordResetEmail failed');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── sendRejectionEmail ───────────────────────────────────────────────────────

export async function sendRejectionEmail({
  to,
  name,
}: {
  to: string;
  name: string | null | undefined;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = getResendClient();
    const displayName = name?.trim() || to;

    const html = emailWrapper(`
      <p style="color:#1e293b;font-size:16px;margin:0 0 16px;">Hi ${escapeHtml(displayName)},</p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Thank you for your interest in becoming an Qyra partner.
      </p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        After careful review, we are unable to approve your application at this time. This decision does not reflect on your qualifications — we are currently managing capacity to ensure the best experience for our existing partners.
      </p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        You are welcome to submit a new application in the future.
      </p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        If you have questions, reach out to us at <a href="mailto:support@qyra.space" style="color:#22d3ee;text-decoration:none;">support@qyra.space</a>.
      </p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Reapply anytime by visiting the Qyra website: <a href="https://qyra.space" style="color:#22d3ee;text-decoration:none;">https://qyra.space</a>
      </p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">Best regards,<br/>The Qyra Team</p>
    `);

    await resend.emails.send({
      from: process.env.RESEND_FROM_ADDRESS ?? 'noreply@qyra.space',
      to,
      subject: 'Update on Your Qyra Partner Application',
      html,
    });
    if (process.env.NODE_ENV !== 'production') {
      log.info({ to }, `Rejection email sent to ${to}`);
    }
    return { success: true };
  } catch (err) {
    log.error({ err }, 'sendRejectionEmail failed');
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

