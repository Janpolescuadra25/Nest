import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

const router = Router();

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderFormPage(title: string, subtitle: string, buttonText: string, actionPath: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${escapeHtml(title)} — Nest</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f9fa;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);padding:40px;max-width:420px;width:90%}h1{font-size:22px;margin-bottom:8px;color:#1a1a2e}.subtitle{color:#6b7280;font-size:14px;margin-bottom:24px}label{display:block;font-size:14px;font-weight:500;color:#374151;margin-bottom:6px}input[type=password]{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:16px;outline:none}input[type=password]:focus{border-color:#4f46e5}button[type=submit]{width:100%;padding:12px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}button[type=submit]:hover{background:#4338ca}button[type=submit]:disabled{opacity:.5;cursor:not-allowed}.error{color:#dc2626;font-size:13px;margin-top:-10px;margin-bottom:12px;display:none}.success{color:#16a34a;font-size:14px;text-align:center;margin-top:16px;display:none}</style>
</head><body><div class="card">
<h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(subtitle)}</p>
<form id="pwd-form" data-action="${escapeHtml(actionPath)}">
<label for="password">New Password</label>
<input type="password" id="password" name="password" required minlength="8" placeholder="Minimum 8 characters"/>
<label for="confirm">Confirm Password</label>
<input type="password" id="confirm" name="confirm" required minlength="8" placeholder="Re-enter your password"/>
<p class="error" id="error-msg"></p>
<button type="submit">${escapeHtml(buttonText)}</button>
<p class="success" id="success-msg">Password set successfully! You can now log in via the Nest extension.</p>
</form></div>
<script>
var form=document.getElementById('pwd-form'),errorEl=document.getElementById('error-msg'),successEl=document.getElementById('success-msg'),params=new URLSearchParams(window.location.search),token=params.get('token'),actionPath=form.getAttribute('data-action');
if(!token){errorEl.textContent='No token provided. Please use the link from your approval email.';errorEl.style.display='block';form.querySelector('button').disabled=true}
form.addEventListener('submit',function(e){e.preventDefault();errorEl.style.display='none';successEl.style.display='none';var pw=document.getElementById('password').value,cnf=document.getElementById('confirm').value;
if(pw.length<8){errorEl.textContent='Password must be at least 8 characters.';errorEl.style.display='block';return}
if(pw!==cnf){errorEl.textContent='Passwords do not match.';errorEl.style.display='block';return}
fetch(actionPath,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token,password:pw})}).then(function(r){return r.json()}).then(function(d){if(d.error){errorEl.textContent=d.error;errorEl.style.display='block';return}form.style.display='none';successEl.style.display='block'}).catch(function(){errorEl.textContent='Network error. Please try again.';errorEl.style.display='block'})});
</script></body></html>`;
}

// GET /auth/setup-password
router.get('/setup-password', (req: Request, res: Response) => {
  res.type('html').send(renderFormPage('Set Your Password', 'Create a password for your Nest account.', 'Set Password', '/auth/setup-password'));
});

// POST /auth/setup-password
router.post('/setup-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token) return res.status(400).json({ error: 'No token provided.' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const request = await prisma.accessRequest.findUnique({ where: { token } });
    if (!request) return res.status(404).json({ error: 'Invalid or expired token.' });
    if (request.status !== 'APPROVED') return res.status(410).json({ error: 'This link has already been used or is no longer valid.' });
    if (request.type !== 'SIGNUP') return res.status(400).json({ error: 'This link is for account creation, not password reset.' });
    if (request.tokenExpiresAt && request.tokenExpiresAt < new Date()) {
      return res.status(410).json({ error: 'This link has expired. Please submit a new request.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: { email: request.email, name: request.name, password: hashedPassword, role: 'user' },
      });
      await tx.accessRequest.update({
        where: { id: request.id },
        data: { status: 'USED' },
      });
    });

    return res.json({ message: 'Password set successfully!' });
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'An account with this email already exists.' });
    console.error('[Password] Setup error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /auth/reset-password
router.get('/reset-password', (req: Request, res: Response) => {
  res.type('html').send(renderFormPage('Reset Your Password', 'Enter a new password for your Nest account.', 'Reset Password', '/auth/reset-password'));
});

// POST /auth/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token) return res.status(400).json({ error: 'No token provided.' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const request = await prisma.accessRequest.findUnique({ where: { token } });
    if (!request) return res.status(404).json({ error: 'Invalid or expired token.' });
    if (request.status !== 'APPROVED') return res.status(410).json({ error: 'This link has already been used or is no longer valid.' });
    if (request.type !== 'RESET') return res.status(400).json({ error: 'This link is for password reset, not account creation.' });
    if (request.tokenExpiresAt && request.tokenExpiresAt < new Date()) {
      return res.status(410).json({ error: 'This link has expired. Please submit a new request.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { email: request.email } });
      if (!user) throw new Error('USER_NOT_FOUND');
      await tx.user.update({ where: { id: user.id }, data: { password: hashedPassword } });
      await tx.accessRequest.update({ where: { id: request.id }, data: { status: 'USED' } });
    });

    return res.json({ message: 'Password reset successfully!' });
  } catch (err: any) {
    if (err.message === 'USER_NOT_FOUND') return res.status(404).json({ error: 'Account not found.' });
    console.error('[Password] Reset error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
