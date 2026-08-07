(function () {
  const token = window.location.pathname.split('/').pop();
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');

  function showContent(html) {
    loading.style.display = 'none';
    content.style.display = 'block';
    content.innerHTML = html;
  }

  function statusPage(icon, title, body) {
    showContent(`
          <div class="status-msg">
            <div class="icon">${icon}</div>
            <h2>${title}</h2>
            <p>${body}</p>
          </div>`);
  }

  function showForm(invite) {
    const role = invite.roleHint || 'member';
    const creator = invite.creatorName ? `Invited by <strong>${invite.creatorName}</strong>` : 'You have been invited';
    const expiresAt = new Date(invite.expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    showContent(`
          <h2 class="form-title">Create your account</h2>
          <p class="form-sub">You've been invited to join Qyra.</p>
          <div class="invite-meta">
            <p>${creator} &nbsp;·&nbsp; Role: <strong>${role}</strong> &nbsp;·&nbsp; Expires: <strong>${expiresAt}</strong></p>
          </div>
          <div id="err" class="error-box"></div>
          <div id="success" class="success-box"></div>
          <form id="signup-form">
            <div class="field">
              <label for="name">Full Name</label>
              <input type="text" id="name" name="name" required minlength="2" placeholder="Jane Smith" autocomplete="name">
            </div>
            <div class="field">
              <label for="email">Email</label>
              <input type="email" id="email" name="email" required placeholder="jane@example.com" autocomplete="email">
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" required minlength="8" placeholder="At least 8 characters" autocomplete="new-password">
            </div>
            <div class="field">
              <label for="confirm">Confirm Password</label>
              <input type="password" id="confirm" name="confirm" required minlength="8" placeholder="Repeat password" autocomplete="new-password">
            </div>
            <button type="submit" id="submit-btn">Create Account</button>
          </form>`);

    document.getElementById('signup-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errBox = document.getElementById('err');
      const successBox = document.getElementById('success');
      const submitBtn = document.getElementById('submit-btn');
      errBox.classList.remove('visible');
      successBox.classList.remove('visible');

      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm').value;

      if (password !== confirm) {
        errBox.textContent = 'Passwords do not match.';
        errBox.classList.add('visible');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating account…';

      try {
        const res = await fetch('/api/invite/signup/' + token, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json();

        if (res.ok) {
          document.getElementById('signup-form').style.display = 'none';
          successBox.innerHTML = '<strong>Account created!</strong>You can now log in from the Chrome extension.';
          successBox.classList.add('visible');
        } else {
          if (res.status === 409) {
            errBox.textContent = 'An account with this email already exists.';
          } else {
            errBox.textContent = data.error || 'Something went wrong. Please try again.';
          }
          errBox.classList.add('visible');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create Account';
        }
      } catch (err) {
        errBox.textContent = 'Network error. Please check your connection and try again.';
        errBox.classList.add('visible');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';
      }
    });
  }

  async function init() {
    if (!token) {
      statusPage('❌', 'Invalid invite link', 'This link does not look right. Please request a new invite.');
      return;
    }
    try {
      const res = await fetch('/api/invite/' + token, {
        headers: { 'Accept': 'application/json' },
      });
      const data = await res.json();

      if (res.status === 404) {
        statusPage('🔍', 'Invalid invite link', 'This invite link could not be found. It may have been revoked or never existed.');
        return;
      }
      if (res.status === 410) {
        const msg = (data.error || '').toLowerCase();
        if (msg.includes('expired')) {
          statusPage('⏰', 'This invite has expired', 'The invite link is no longer valid. Please contact your administrator for a new one.');
        } else {
          statusPage('✋', 'This invite has already been used', 'This invite link has reached its usage limit. Please contact your administrator for a new one.');
        }
        return;
      }
      if (!res.ok) {
        statusPage('⚠️', 'Something went wrong', data.error || 'Unable to load invite. Please try again later.');
        return;
      }

      showForm(data.invite);
    } catch (err) {
      statusPage('⚠️', 'Connection error', 'Could not reach the server. Please check your connection and try again.');
    }
  }

  init();
})();
