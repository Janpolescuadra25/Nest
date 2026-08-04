(function () {
  const token = new URLSearchParams(window.location.search).get('token');
  const content = document.getElementById('content');

  function statusPage(icon, title, body) {
    content.innerHTML = `
          <div class="status-msg">
            <div class="icon">${icon}</div>
            <h2>${title}</h2>
            <p>${body}</p>
          </div>`;
  }

  if (!token) {
    statusPage('❌', 'Invalid reset link', 'This password reset link is missing its token. Please use the link from your email exactly as sent.');
  } else {
    content.innerHTML = `
          <h2 class="form-title">Reset your password</h2>
          <p class="form-sub">Enter a new password for your AutoBooks account.</p>
          <div id="err" class="error-box"></div>
          <div id="success" class="success-box"></div>
          <form id="reset-form">
            <div class="field">
              <label for="password">New Password</label>
              <input type="password" id="password" name="password" required minlength="8" placeholder="At least 8 characters" autocomplete="new-password">
            </div>
            <div class="field">
              <label for="confirm">Confirm New Password</label>
              <input type="password" id="confirm" name="confirm" required minlength="8" placeholder="Repeat new password" autocomplete="new-password">
            </div>
            <button type="submit" id="submit-btn">Update Password</button>
          </form>`;

    document.getElementById('reset-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const errBox = document.getElementById('err');
      const successBox = document.getElementById('success');
      const submitBtn = document.getElementById('submit-btn');
      errBox.classList.remove('visible');
      successBox.classList.remove('visible');

      const newPassword = document.getElementById('password').value;
      const confirm = document.getElementById('confirm').value;

      if (newPassword !== confirm) {
        errBox.textContent = 'Passwords do not match.';
        errBox.classList.add('visible');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating…';

      try {
        const res = await fetch('/api/password-reset/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ token, newPassword }),
        });
        const data = await res.json();

        if (res.ok) {
          document.getElementById('reset-form').style.display = 'none';
          successBox.innerHTML = '<strong>Password updated successfully!</strong>You can now log in from the Chrome extension.';
          successBox.classList.add('visible');
        } else {
          errBox.textContent = data.error || 'Something went wrong. Please try again.';
          errBox.classList.add('visible');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Update Password';
        }
      } catch (err) {
        errBox.textContent = 'Network error. Please check your connection and try again.';
        errBox.classList.add('visible');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update Password';
      }
    });
  }
})();