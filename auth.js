(() => {
  const config = window.FILMAX_SUPABASE_CONFIG;
  const setupMessage = document.getElementById('auth-setup');
  const authForm = document.getElementById('auth-form');
  const authMessage = document.getElementById('auth-message');
  const submitButton = document.getElementById('submit-auth');
  const sessionMessage = document.getElementById('auth-session');
  const params = new URLSearchParams(window.location.search);
  let mode = params.get('mode') === 'signup' ? 'signup' : 'login';
  let client = null;

  const setMessage = (message, isError = false) => {
    authMessage.textContent = message;
    authMessage.className = isError ? 'text-sm text-rose-300' : 'text-sm text-slate-300';
  };

  const loginRedirectUrl = () => new URL('auth.html?mode=login', window.location.href).toString();

  const updateMode = () => {
    const signingUp = mode === 'signup';
    document.title = `${signingUp ? 'Sign in' : 'Log in'} | FILMAX`;
    document.getElementById('auth-title').textContent = signingUp ? 'Create your account' : 'Welcome back';
    document.getElementById('auth-subtitle').textContent = signingUp
      ? 'Create an account to get started.'
      : 'Log in to your FILMAX account.';
    document.getElementById('password').autocomplete = signingUp ? 'new-password' : 'current-password';
    submitButton.textContent = signingUp ? 'Create account' : 'Log in';
    document.getElementById('mode-prompt').textContent = signingUp ? 'Already have an account? ' : 'New to FILMAX? ';
    const modeLink = document.getElementById('mode-link');
    modeLink.textContent = signingUp ? 'Log in' : 'Create an account';
    modeLink.href = `auth.html?mode=${signingUp ? 'login' : 'signup'}`;
  };

  updateMode();

  const configured = Boolean(config?.url && config?.anonKey && window.supabase?.createClient);
  if (!configured) {
    setupMessage.hidden = false;
    authForm.querySelectorAll('input, button').forEach(element => { element.disabled = true; });
    document.querySelectorAll('.provider-button').forEach(button => { button.disabled = true; });
    setMessage('Complete the Supabase setup to enable account access.');
    return;
  }

  try {
    client = window.supabase.createClient(config.url, config.anonKey);
  } catch (error) {
    setupMessage.hidden = false;
    setMessage(`Supabase configuration is invalid: ${error.message}`, true);
    authForm.querySelectorAll('input, button').forEach(element => { element.disabled = true; });
    document.querySelectorAll('.provider-button').forEach(button => { button.disabled = true; });
    return;
  }

  client.auth.getSession().then(({ data, error }) => {
    if (error) {
      setMessage(error.message, true);
      return;
    }

    if (data.session) {
      sessionMessage.textContent = `You are logged in as ${data.session.user.email || 'your account'}.`;
      sessionMessage.hidden = false;
    }
  }).catch(error => {
    setMessage(`Could not check your session: ${error.message}`, true);
  });

  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    setMessage('');
    submitButton.disabled = true;

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    try {
      const result = mode === 'signup'
        ? await client.auth.signUp({ email, password, options: { emailRedirectTo: loginRedirectUrl() } })
        : await client.auth.signInWithPassword({ email, password });

      if (result.error) {
        setMessage(result.error.message, true);
        return;
      }

      if (mode === 'signup' && result.data.user && !result.data.session) {
        setMessage('Account created. Check your email to confirm your address before logging in.');
        return;
      }

      if (result.data.session) {
        sessionMessage.textContent = `You are logged in as ${result.data.user.email || email}.`;
        sessionMessage.hidden = false;
        setMessage('You are now logged in.');
      }
    } catch (error) {
      setMessage(`Could not complete authentication: ${error.message}`, true);
    } finally {
      submitButton.disabled = false;
    }
  });

  document.querySelectorAll('.provider-button').forEach(button => {
    button.addEventListener('click', async () => {
      setMessage('');
      document.querySelectorAll('.provider-button').forEach(providerButton => { providerButton.disabled = true; });

      try {
        const { error } = await client.auth.signInWithOAuth({
          provider: button.dataset.provider,
          options: { redirectTo: loginRedirectUrl() }
        });

        if (error) {
          setMessage(error.message, true);
          document.querySelectorAll('.provider-button').forEach(providerButton => { providerButton.disabled = false; });
        }
      } catch (error) {
        setMessage(`Could not start provider sign-in: ${error.message}`, true);
        document.querySelectorAll('.provider-button').forEach(providerButton => { providerButton.disabled = false; });
      }
    });
  });
})();
