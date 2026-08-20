// ===========================================
// Qyra Landing Page — All JS (CSP-safe external file)
// ===========================================

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
      var response = await fetch('/api/auth/register', {
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

// ── 6. Particle + Line Constellation Animation ──
(function () {
  var canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var particles = [];
  var isVisible = true;
  var resizeTimer = null;
  var animationFrame = null;
  var colorPalette = [
    'rgba(16, 185, 129, 0.6)',
    'rgba(52, 211, 153, 0.4)',
    'rgba(5, 150, 105, 0.5)',
  ];
  var connectionDistance = 120;
  var dpr = window.devicePixelRatio || 1;

  function createParticle(width, height) {
    var radius = 1.5 + Math.random() * 1;
    var speed = 0.2 + Math.random() * 0.3;
    var angle = Math.random() * Math.PI * 2;
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      radius: radius,
      speed: speed,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: colorPalette[Math.floor(Math.random() * colorPalette.length)],
    };
  }

  function setCanvasSize() {
    var parent = canvas.parentElement;
    if (!parent) return;
    var width = parent.clientWidth;
    var height = parent.clientHeight;
    if (width === 0 || height === 0) return;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initializeParticles(width, height);
  }

  function initializeParticles(width, height) {
    var count = width < 640 ? 30 : 60;
    if (particles.length === count && particles[0] && particles[0].width === width && particles[0].height === height) {
      return;
    }
    particles = [];
    for (var i = 0; i < count; i += 1) {
      var p = createParticle(width, height);
      p.width = width;
      p.height = height;
      particles.push(p);
    }
  }

  function wrapParticle(p, width, height) {
    if (p.x < 0) p.x = width;
    if (p.x > width) p.x = 0;
    if (p.y < 0) p.y = height;
    if (p.y > height) p.y = 0;
  }

  function draw() {
    try {
      if (!isVisible || document.hidden) return;
      var width = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
      var height = canvas.parentElement ? canvas.parentElement.clientHeight : 0;
      if (width === 0 || height === 0) return;
      ctx.clearRect(0, 0, width, height);

      for (var i = 0; i < particles.length; i += 1) {
        var p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        wrapParticle(p, width, height);
        ctx.beginPath();
        ctx.fillStyle = p.color;
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      for (var j = 0; j < particles.length; j += 1) {
        for (var k = j + 1; k < particles.length; k += 1) {
          var a = particles[j];
          var b = particles[k];
          var dx = a.x - b.x;
          var dy = a.y - b.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= connectionDistance) {
            var opacity = 0.15 * (1 - dist / connectionDistance);
            ctx.strokeStyle = 'rgba(16, 185, 129, ' + opacity.toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    } catch (error) {
      console.error('Particle animation error:', error);
    }
  }

  function animate() {
    draw();
    animationFrame = requestAnimationFrame(animate);
  }

  function handleResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      setCanvasSize();
    }, 250);
  }

  function handleVisibilityChange() {
    isVisible = !document.hidden;
  }

  var heroSection = canvas.parentElement;
  if (heroSection) {
    var visibilityObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        isVisible = entry.isIntersecting;
      });
    }, { threshold: 0.1 });
    visibilityObserver.observe(heroSection);
  }

  window.addEventListener('resize', handleResize);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  setCanvasSize();
  animate();
})();
