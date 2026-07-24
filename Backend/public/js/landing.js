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
      setMessage(signupMessage, 'Account created! Check your email to verify your account, then install the Nest extension to get started.', 'success');
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

const partnerForm = document.getElementById('partner-form');
const partnerMessageBox = document.getElementById('partner-message-box');
const partnerSubmit = document.getElementById('partner-submit');

partnerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  partnerMessageBox.textContent = '';
  partnerSubmit.disabled = true;
  partnerSubmit.textContent = 'Submitting...';

  const name = document.getElementById('partner-name').value.trim();
  const email = document.getElementById('partner-email').value.trim();
  const company = document.getElementById('partner-company').value.trim();
  const description = document.getElementById('partner-message').value.trim();

  if (description.length < 10) {
    setMessage(partnerMessageBox, 'Please provide at least 10 characters describing your business.', 'error');
    partnerSubmit.disabled = false;
    partnerSubmit.textContent = 'Submit Application';
    return;
  }

  try {
    const response = await fetch('/api/admin-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, company, description }),
    });
    const data = await response.json();

    if (response.ok) {
      partnerForm.reset();
      setMessage(partnerMessageBox, 'Application submitted! Our team will review your request and get back to you within 24 hours.', 'success');
    } else {
      setMessage(partnerMessageBox, data.error || 'Something went wrong. Please try again.', 'error');
    }
  } catch (error) {
    setMessage(partnerMessageBox, 'Something went wrong. Please try again.', 'error');
  } finally {
    partnerSubmit.disabled = false;
    partnerSubmit.textContent = 'Submit Application';
  }
});