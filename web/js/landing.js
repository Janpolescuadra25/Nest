// ===========================================
// Qyra Landing Page — All JS (CSP-safe external file)
// ===========================================

// ── API base for cross-origin requests (Vercel → Render) ──
var API_BASE = 'https://nest-backend-mddn.onrender.com';

// ── 1. IntersectionObserver — feature card scroll reveal ──
var observer = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) {
      entry.target.classList.add('animate-fade-in-up');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.feature-card').forEach(function (el) {
    el.style.opacity = '0';
    observer.observe(el);
  });
});

// ── 2. Intro Overlay — 3-slide auto-playing intro ──
(function () {
  var o = document.getElementById('intro-overlay');
  if (!o) return;
  var s = document.querySelectorAll('.i-slide');
  var d = document.querySelectorAll('.i-dot');
  var c = 0, t = null;

  function show(n) {
    s.forEach(function (x) { x.classList.remove('i-active'); });
    d.forEach(function (x) { x.classList.remove('i-active'); });
    if (s[n]) s[n].classList.add('i-active');
    if (d[n]) d[n].classList.add('i-active');
    c = n;
  }

  function dismiss() {
    if (t) clearInterval(t);
    o.style.opacity = '0';
    setTimeout(function () {
      o.style.display = 'none';
      document.body.style.overflow = '';
    }, 700);
  }

  function next() {
    if (c < s.length - 1) { show(c + 1); } else { dismiss(); }
  }

  var skipBtn = document.getElementById('intro-skip');
  if (skipBtn) skipBtn.addEventListener('click', dismiss);

  var ctaBtn = document.getElementById('intro-cta');
  if (ctaBtn) ctaBtn.addEventListener('click', dismiss);

  document.body.style.overflow = 'hidden';
  show(0);
  t = setInterval(next, 3500);
})();

// ── 3. Mobile Menu Toggle ──
var mobileButton = document.getElementById('mobile-menu-button');
var mobileMenu = document.getElementById('mobile-menu');

if (mobileButton) {
  mobileButton.addEventListener('click', function () {
    mobileMenu.classList.toggle('hidden');
  });
}

// ── 4. Smooth Scroll for anchor links ──
document.querySelectorAll('a[href^="#"]').forEach(function (link) {
  link.addEventListener('click', function (event) {
    var targetId = link.getAttribute('href').slice(1);
    var target = document.getElementById(targetId) || document.body;
    if (target) {
      event.preventDefault();
      var offset = 90;
      var top = target.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: top, behavior: 'smooth' });
      if (mobileMenu && !mobileMenu.classList.contains('hidden')) {
        mobileMenu.classList.add('hidden');
      }
    }
  });
});

// ── 5. Signup Form ──
function setMessage(container, message, type) {
  container.textContent = message;
  container.className = type === 'error' ? 'mt-4 text-sm text-red-600' : 'mt-4 text-sm text-emerald-600';
}

var signupForm = document.getElementById('signup-form');
var signupMessage = document.getElementById('signup-message');
var signupSubmit = document.getElementById('signup-submit');

if (signupForm) {
  signupForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    signupMessage.textContent = '';
    signupSubmit.disabled = true;
    signupSubmit.textContent = 'Creating...';

    var name = document.getElementById('signup-name').value.trim();
    var email = document.getElementById('signup-email').value.trim();
    var password = document.getElementById('signup-password').value;

    try {
      var response = await fetch(API_BASE + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, email: email, password: password }),
      });
      var data = await response.json();

      if (response.ok) {
        signupForm.reset();
        signupMessage.className = 'mt-4 text-sm text-emerald-600';
        signupMessage.innerHTML =
          '<p class="text-green-700 text-sm mt-2">Account created! Check your email to verify your account.</p>' +
          '<a href="https://chromewebstore.google.com/detail/nest-restaurant-financial/ccghhfmkjbcakhnoamgihifonfiammoc" target="_blank" class="text-emerald-600 hover:text-emerald-700 text-sm underline mt-1 inline-block">Install Qyra from Chrome Web Store →</a>';
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
}
