/**
 * KineticHost — Vanilla JS BlurText Entrance Animation Engine
 * Reusable scroll-triggered word-staggered blur animation inspired by React Bits
 */
function initBlurText() {
  // 1. Accessibility: Check for prefers-reduced-motion
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 2. Discover all [data-blur-text] and .kh-blur-text elements
  const elements = document.querySelectorAll('[data-blur-text], .kh-blur-text');
  if (!elements || elements.length === 0) return;

  // 3. Setup IntersectionObserver if supported and motion is not reduced
  let observer = null;
  if (!prefersReducedMotion && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const target = entry.target;
          obs.unobserve(target); // Animate ONLY ONCE
          target.classList.add('kh-blur-visible');

          // Calculate total animation duration for will-change cleanup
          const words = target.querySelectorAll('.kh-blur-word');
          const staggerDelay = parseFloat(target.dataset.delay || 70);
          const totalDuration = (words.length * staggerDelay) + 750;

          setTimeout(() => {
            words.forEach(w => {
              w.style.willChange = 'auto';
            });
          }, totalDuration);
        }
      });
    }, {
      threshold: 0.15,
      rootMargin: '0px 0px -5% 0px'
    });
  }

  // 4. Process each element
  elements.forEach(el => {
    // Avoid double initialization
    if (el.dataset.blurInitialized === 'true') return;
    el.dataset.blurInitialized = 'true';

    const rawText = el.textContent.trim();
    if (!rawText) return;

    // Preserve accessibility: Keep semantic full text for screen readers
    el.setAttribute('aria-label', rawText);

    const staggerMs = el.dataset.delay || '70';
    el.style.setProperty('--blur-stagger', `${staggerMs}ms`);

    const animateBy = el.dataset.animateBy || 'word';

    // Clear existing inner content and construct word spans
    el.innerHTML = '';

    if (animateBy === 'letter') {
      const chars = Array.from(rawText);
      chars.forEach((char, idx) => {
        if (char === ' ') {
          const space = document.createElement('span');
          space.className = 'kh-blur-space';
          space.setAttribute('aria-hidden', 'true');
          space.innerHTML = '&nbsp;';
          el.appendChild(space);
        } else {
          const span = document.createElement('span');
          span.className = 'kh-blur-word';
          span.setAttribute('aria-hidden', 'true');
          span.style.setProperty('--word-index', idx);
          span.textContent = char;
          el.appendChild(span);
        }
      });
    } else {
      // Default: word-by-word splitting
      const words = rawText.split(/\s+/);
      words.forEach((word, idx) => {
        const span = document.createElement('span');
        span.className = 'kh-blur-word';
        span.setAttribute('aria-hidden', 'true');
        span.style.setProperty('--word-index', idx);
        span.textContent = word;
        el.appendChild(span);

        if (idx < words.length - 1) {
          const space = document.createTextNode(' ');
          el.appendChild(space);
        }
      });
    }

    if (prefersReducedMotion || !observer) {
      // Fallback / Reduced motion: display immediately with no transitions
      el.classList.add('kh-blur-visible');
      el.querySelectorAll('.kh-blur-word').forEach(w => {
        w.style.willChange = 'auto';
      });
    } else {
      observer.observe(el);
    }
  });
}

// Auto-initialize on DOM ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBlurText);
  } else {
    initBlurText();
  }
}

// Expose globally for modular usage
if (typeof window !== 'undefined') {
  window.initBlurText = initBlurText;
}
