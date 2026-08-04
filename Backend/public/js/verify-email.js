const params = new URLSearchParams(window.location.search);
const status = params.get('status');
const content = document.getElementById('content');

const pages = {
  success: {
    icon: '✅',
    title: 'Email verified!',
    body: 'Your email address has been successfully verified. You can close this tab and return to AutoBooks.',
    statusClass: 'status-success',
  },
  expired: {
    icon: '⏰',
    title: 'Verification link expired',
    body: 'This verification link has expired. Request a new one from your AutoBooks settings page.',
    statusClass: 'status-warning',
  },
  invalid: {
    icon: '❌',
    title: 'Invalid verification link',
    body: 'This link is not valid. Request a new verification email from your AutoBooks settings page.',
    statusClass: 'status-error',
  },
};

const page = pages[status] || pages.invalid;
content.innerHTML = `
  <div class="icon">${page.icon}</div>
  <h2 class="${page.statusClass}">${page.title}</h2>
  <p>${page.body}</p>
`;