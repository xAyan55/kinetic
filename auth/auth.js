document.addEventListener('DOMContentLoaded', async () => {
  // 1. Auto Check Authentication State
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.authenticated) {
      window.location.href = '/dashboard';
      return;
    }
  } catch (err) {
    console.warn('Auth state check error:', err);
  }

  // 2. Setup Password Visibility Toggles
  const toggleButtons = document.querySelectorAll('.toggle-password');
  toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const icon = btn.querySelector('i');
      if (input && icon) {
        if (input.type === 'password') {
          input.type = 'text';
          icon.className = 'bi bi-eye-slash';
        } else {
          input.type = 'password';
          icon.className = 'bi bi-eye';
        }
      }
    });
  });

  // 3. Password Strength Indicator for Register Page
  const passwordInput = document.getElementById('reg-password');
  const strengthBar = document.getElementById('strength-bar');
  const strengthText = document.getElementById('strength-text');

  if (passwordInput && strengthBar && strengthText) {
    passwordInput.addEventListener('input', () => {
      const val = passwordInput.value;
      let score = 0;
      if (val.length >= 8) score++;
      if (/[A-Z]/.test(val)) score++;
      if (/[0-9]/.test(val)) score++;
      if (/[^A-Za-z0-9]/.test(val)) score++;

      if (val.length === 0) {
        strengthBar.style.width = '0%';
        strengthBar.style.backgroundColor = 'transparent';
        strengthText.textContent = '';
      } else if (score <= 1) {
        strengthBar.style.width = '25%';
        strengthBar.style.backgroundColor = '#ef4444';
        strengthText.textContent = 'Weak';
        strengthText.style.color = '#ef4444';
      } else if (score === 2) {
        strengthBar.style.width = '50%';
        strengthBar.style.backgroundColor = '#f59e0b';
        strengthText.textContent = 'Fair';
        strengthText.style.color = '#f59e0b';
      } else if (score === 3) {
        strengthBar.style.width = '75%';
        strengthBar.style.backgroundColor = '#3b82f6';
        strengthText.textContent = 'Good';
        strengthText.style.color = '#3b82f6';
      } else {
        strengthBar.style.width = '100%';
        strengthBar.style.backgroundColor = '#10b981';
        strengthText.textContent = 'Strong';
        strengthText.style.color = '#10b981';
      }
    });
  }

  // Helper: Display Inline Error Message
  function showError(containerId, message) {
    const el = document.getElementById(containerId);
    if (el) {
      const msgSpan = el.querySelector('span');
      if (msgSpan) {
        msgSpan.textContent = message;
      } else {
        el.textContent = message;
      }
      el.style.display = 'flex';
    }
  }

  function hideError(containerId) {
    const el = document.getElementById(containerId);
    if (el) {
      el.style.display = 'none';
    }
  }

  // Helper: Toggle Loading Spinner on Button
  function setLoading(btn, isLoading, originalText) {
    if (!btn) return;
    if (isLoading) {
      btn.disabled = true;
      btn.innerHTML = `<span style="display:inline-block;animation:spin 1s linear infinite;margin-right:0.5rem;"><i class="bi bi-arrow-repeat"></i></span> Processing...`;
    } else {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  // 4. Handle Login Form Submit
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError('login-error');

      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const btn = document.getElementById('login-btn');
      const origText = btn.innerHTML;

      if (!email || !password) {
        showError('login-error', 'Please fill in all fields.');
        return;
      }

      setLoading(btn, true, origText);

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await response.json();
        if (data.success) {
          window.location.href = '/dashboard';
        } else {
          showError('login-error', data.error || 'Failed to login.');
          setLoading(btn, false, origText);
        }
      } catch (err) {
        showError('login-error', 'Network error. Please try again.');
        setLoading(btn, false, origText);
      }
    });
  }

  // 5. Handle Register Form Submit
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError('register-error');

      const name = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const confirmPassword = document.getElementById('reg-confirm-password').value;
      const terms = document.getElementById('reg-terms').checked;
      const btn = document.getElementById('register-btn');
      const origText = btn.innerHTML;

      if (!name || !email || !password || !confirmPassword) {
        showError('register-error', 'Please complete all required fields.');
        return;
      }

      if (password.length < 8) {
        showError('register-error', 'Password must be at least 8 characters long.');
        return;
      }

      if (password !== confirmPassword) {
        showError('register-error', 'Passwords do not match.');
        return;
      }

      if (!terms) {
        showError('register-error', 'You must accept the terms of service.');
        return;
      }

      setLoading(btn, true, origText);

      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, confirmPassword, terms })
        });

        const data = await response.json();
        if (data.success) {
          window.location.href = '/dashboard';
        } else {
          showError('register-error', data.error || 'Registration failed.');
          setLoading(btn, false, origText);
        }
      } catch (err) {
        showError('register-error', 'Network error. Please try again.');
        setLoading(btn, false, origText);
      }
    });
  }
});
