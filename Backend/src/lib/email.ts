import { Resend } from 'resend';

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export async function sendApprovalEmail(
  toEmail: string,
  name: string | null,
  type: 'SIGNUP' | 'RESET',
  link: string
): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.warn('[Email] RESEND_API_KEY not set. Skipping email.');
    return false;
  }
  const greeting = name ? `Hi ${name}` : 'Hello';
  const subject = type === 'SIGNUP'
    ? 'Nest — Your Access Request Has Been Approved'
    : 'Nest — Your Password Reset Has Been Approved';
  const actionText = type === 'SIGNUP' ? 'set up your password' : 'reset your password';
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
<h2 style="color:#1a1a2e;margin-bottom:16px">${subject}</h2>
<p style="color:#374151;line-height:1.6;margin-bottom:24px">${greeting},<br/><br/>Your request to ${actionText} for Nest has been approved. Click the button below to proceed. This link expires in 24 hours.</p>
<div style="text-align:center;margin-bottom:24px"><a href="${link}" style="display:inline-block;padding:12px 32px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">${type === 'SIGNUP' ? 'Set Up Password' : 'Reset Password'}</a></div>
<p style="color:#9ca3af;font-size:13px;line-height:1.5">If you didn't request this, you can safely ignore this email.<br/>Do not share this link with anyone.</p>
</div>`;
  try {
    const { error } = await resend.emails.send({
      from: 'Nest <onboarding@resend.dev>',
      to: toEmail,
      subject,
      html,
    });
    if (error) {
      console.error('[Email] Resend error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Email] Resend send failed:', err);
    return false;
  }
}
