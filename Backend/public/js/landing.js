const mobileButton = document.getElementById('mobile-menu-button');
const mobileMenu = document.getElementById('mobile-menu');

mobileButton.addEventListener('click', () => {
  mobileMenu.classList.toggle('hidden');
});

document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', (event) => {
    const targetId = link.getAttribute('href').slice(1);
    const target = document.getElementById(targetId) || document.body;
    if (target) {
      event.preventDefault();
      const offset = 90;
      const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: 'smooth' });
      if (!mobileMenu.classList.contains('hidden')) {
        mobileMenu.classList.add('hidden');
      }
    }
  });
});

function setMessage(container, message, type) {
  container.textContent = message;
  container.className = type === 'error' ? 'mt-4 text-sm text-red-600' : 'mt-4 text-sm text-emerald-600';
}

const signupForm = document.getElementById('signup-form');
const signupMessage = document.getElementById('signup-message');
const signupSubmit = document.getElementById('signup-submit');

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  signupMessage.textContent = '';
  signupSubmit.disabled = true;
  signupSubmit.textContent = 'Creating...';

  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await response.json();

    if (response.ok) {
      signupForm.reset();
      setMessage(signupMessage, 'Account created! Check your email to verify your account, then install the Qyra extension to get started.', 'success');
    } else {
      setMessage(signupMessage, data.error || 'Something went wrong. Please try again.', 'error');
    }
  } catch (error) {
    setMessage(signupMessage, 'Something went wrong. Please try again.', 'error');
  } finally {
    signupSubmit.disabled = false;
    signupSubmit.textContent = 'Create Account';
  }
});

