import { auth, groups, escapeHtml } from './api.js?v=55';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 3-3"/><path d="M9.9 5.1A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4.1"/><path d="M6.1 6.1C4 7.8 2 12 2 12s3.5 7 10 7a10.5 10.5 0 0 0 4.2-.9"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
const LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
const UNLOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-1.9"/></svg>`;
const WIND_UP = 'cubic-bezier(.15, .88, .22, 1)';
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function formatMemberCount(n) {
  const count = Number(n) || 0;
  return `${count} membre${count > 1 ? 's' : ''}`;
}

export function renderPublicGroupOptions(publicGroups) {
  if (!publicGroups.length) {
    return `<div class="auth-empty-groups">Aucun groupe public pour l'instant</div>`;
  }
  return `<select id="public-group" class="auth-select">
    ${publicGroups.map(g => `<option value="${g.id}">${escapeHtml(g.name)} (${formatMemberCount(g.memberCount)})</option>`).join('')}
  </select>`;
}

function setFieldValid(wrap, on) {
  wrap?.classList.toggle('is-valid', !!on);
}

function wirePasswordToggle(input, btn) {
  btn.innerHTML = EYE;
  btn.onclick = () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF : EYE;
    btn.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  };
}

function markStep(items, index, state) {
  items.forEach((el, i) => {
    el.classList.toggle('active', state === 'active' && i === index);
    el.classList.toggle('done', i < index || (state === 'done' && i === index));
  });
}

async function playSecureSteps(secureEl, runner, submitBtn) {
  secureEl.classList.remove('hidden');
  secureEl.classList.add('is-on');
  secureEl.closest('form')?.classList.add('is-scanning');
  const items = [...secureEl.querySelectorAll('[data-step]')];
  const shield = secureEl.querySelector('.auth-scan-shield');
  const core = secureEl.querySelector('.auth-scan-core');
  items.forEach(el => el.classList.remove('done', 'active'));
  shield?.classList.remove('is-s1', 'is-s2', 'is-s3', 'is-ok');
  if (core) core.innerHTML = LOCK;
  if (submitBtn) {
    submitBtn.classList.add('is-busy');
    submitBtn.innerHTML = `${LOCK}<span>Authentification…</span>`;
  }

  const wait = reduceMotion() ? 80 : 480;
  markStep(items, 0, 'active');
  shield?.classList.add('is-s1');
  await sleep(wait);
  markStep(items, 0, 'done');
  markStep(items, 1, 'active');
  shield?.classList.add('is-s2');
  await sleep(wait);
  markStep(items, 1, 'done');
  markStep(items, 2, 'active');
  shield?.classList.add('is-s3');
  try {
    const result = await runner();
    markStep(items, 2, 'done');
    shield?.classList.add('is-ok');
    if (core) {
      core.innerHTML = UNLOCK;
      core.animate(
        [
          { transform: 'rotate(-18deg) scale(.86)', opacity: 0.5 },
          { transform: 'rotate(0deg) scale(1.08)', opacity: 1 },
          { transform: 'rotate(0deg) scale(1)', opacity: 1 },
        ],
        { duration: reduceMotion() ? 1 : 520, easing: WIND_UP, fill: 'forwards' }
      );
    }
    await sleep(reduceMotion() ? 40 : 280);
    return result;
  } catch (err) {
    shield?.classList.remove('is-s3');
    secureEl.closest('form')?.classList.remove('is-scanning');
    throw err;
  }
}

function showSuccessThen(root, { title, sub, onContinue }) {
  root.innerHTML = `
    <div class="auth-success">
      <div class="auth-success-orbit">
        <svg class="auth-success-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 8"/>
        </svg>
        <div class="auth-success-mark">${CHECK}</div>
      </div>
      <h2>${title}</h2>
      <p>${sub}</p>
      <ul class="auth-secure-list">
        <li class="done" data-step="credentials">Identifiants</li>
        <li class="done" data-step="security">Contrôle de sécurité</li>
        <li class="done" data-step="auth">Authentification</li>
      </ul>
      <button type="button" class="auth-submit" id="auth-continue">Continuer →</button>
    </div>`;
  requestAnimationFrame(() => root.querySelector('.auth-success')?.classList.add('is-in'));
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    onContinue();
  };
  document.getElementById('auth-continue').onclick = go;
  setTimeout(go, 1700);
}

const OTP_LEN = 6;

function otpDigitsFrom(value) {
  return String(value || '').replace(/\D/g, '').slice(0, OTP_LEN);
}

function paintOtpSlots(slots, value) {
  const digits = otpDigitsFrom(value).split('');
  slots.forEach((slot, i) => {
    slot.textContent = digits[i] || '';
    slot.classList.toggle('is-filled', !!digits[i]);
    slot.classList.toggle('is-active', i === Math.min(digits.length, OTP_LEN - 1));
  });
}

function moveOtpRing(ring, slot) {
  if (!ring || !slot) return;
  const spin = () => {
    if (reduceMotion()) return;
    ring.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(450deg)' }],
      { duration: 800, easing: WIND_UP }
    );
  };
  if (ring.parentElement === slot) {
    spin();
    return;
  }
  const first = ring.getBoundingClientRect();
  slot.appendChild(ring);
  if (reduceMotion()) return;
  const last = ring.getBoundingClientRect();
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  ring.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) rotate(0deg)` },
      { transform: 'translate(0px, 0px) rotate(450deg)' },
    ],
    { duration: 800, easing: WIND_UP, fill: 'forwards' }
  );
}

function createOrbit(stage) {
  const path = stage.querySelector('.otp-orbit-path');
  const slots = [...stage.querySelectorAll('.otp-slot')];
  if (reduceMotion()) return { windUp: async () => {}, burst: async () => {} };
  return {
    async windUp() {
      const spins = [];
      if (path?.animate) {
        spins.push(path.animate(
          [{ transform: 'rotate(0deg)' }, { transform: 'rotate(450deg)' }],
          { duration: 800, easing: WIND_UP }
        ).finished.catch(() => {}));
      }
      slots.forEach(slot => {
        spins.push(slot.animate(
          [
            { filter: 'none' },
            { filter: 'drop-shadow(0 0 10px #2ee6a8)' },
            { filter: 'none' },
          ],
          { duration: 800, easing: WIND_UP }
        ).finished.catch(() => {}));
      });
      await Promise.all(spins);
    },
    async burst() {
      await Promise.all(slots.map(slot => slot.animate(
        [
          { transform: getComputedStyle(slot).transform, filter: 'none' },
          { transform: `${getComputedStyle(slot).transform} scale(1.12)`, filter: 'drop-shadow(0 0 16px #2ee6a8)' },
        ],
        { duration: 420, easing: WIND_UP, fill: 'forwards' }
      ).finished.catch(() => {})));
    },
  };
}

function renderOtpView(wrap, ctx) {
  const { otp, onVerified, onBack } = ctx;
  wrap.innerHTML = `
    <button type="button" class="auth-back" id="otp-back">← Retour</button>
    <h1 class="auth-title">Vérifie ton accès</h1>
    <p class="auth-ok-msg" id="otp-sent">Code envoyé</p>
    <p class="auth-sub">Entre le code à 6 chiffres envoyé par mail à <strong>${escapeHtml(otp.emailMasked)}</strong></p>
    <form id="otp-form" class="auth-form" autocomplete="one-time-code">
      <div class="otp-stage" id="otp-stage">
        <input id="otp-hidden" class="otp-hidden" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="${OTP_LEN}" aria-label="Code à 6 chiffres">
        <div class="otp-board" id="otp-board">
          <svg class="otp-orbit-path" viewBox="0 0 220 220" aria-hidden="true">
            <circle cx="110" cy="110" r="78" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 8"/>
          </svg>
          <div class="otp-hub" aria-hidden="true"></div>
          <svg class="otp-ring" id="otp-ring" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="2 8"/>
          </svg>
          <div class="otp-wheel">
            ${[0, 1, 2, 3, 4, 5].map(i => `
              <div class="otp-arm" style="--a:${i * 60}deg">
                <button type="button" class="otp-slot otp-slot-6" data-i="${i}" aria-label="Chiffre ${i + 1}"></button>
              </div>`).join('')}
          </div>
        </div>
      </div>
      ${otp.channel === 'sms' && otp.devOtp ? `
        <div class="auth-otp-fill" id="otp-fill">
          <div>
            <div class="auth-otp-fill-kicker">MATCHDAY · SMS</div>
            <div><strong>${escapeHtml(otp.devOtp)}</strong> est ton code de vérification.</div>
          </div>
          <button type="button" id="otp-fill-btn">Remplir</button>
        </div>` : ''}
      <p class="auth-otp-resend">Pas reçu ? <button type="button" id="otp-resend">Renvoyer</button></p>
      <div class="error-msg hidden" id="otp-error"></div>
    </form>`;

  const hidden = document.getElementById('otp-hidden');
  const board = document.getElementById('otp-board');
  const ring = document.getElementById('otp-ring');
  const stage = document.getElementById('otp-stage');
  const slots = [...stage.querySelectorAll('.otp-slot')];
  const errEl = document.getElementById('otp-error');
  const orbit = createOrbit(stage);

  const syncRing = () => {
    const idx = Math.min(otpDigitsFrom(hidden.value).length, OTP_LEN - 1);
    moveOtpRing(ring, slots[idx]);
  };

  document.getElementById('otp-back').onclick = onBack;
  slots.forEach(slot => slot.addEventListener('click', () => hidden.focus()));
  board.addEventListener('click', () => hidden.focus());

  hidden.addEventListener('input', () => {
    hidden.value = otpDigitsFrom(hidden.value);
    paintOtpSlots(slots, hidden.value);
    syncRing();
    if (hidden.value.length === OTP_LEN) submitOtp();
  });

  let busy = false;
  async function submitOtp() {
    const code = otpDigitsFrom(hidden.value);
    if (code.length !== OTP_LEN || busy) return;
    busy = true;
    errEl.classList.add('hidden');
    stage.classList.remove('is-bad');
    try {
      await orbit.windUp();
      const data = otp.email
        ? await auth.verifyOtp({ email: otp.email, otp: code })
        : await auth.verifyOtp({ otpToken: otp.otpToken, code });
      stage.classList.add('is-ok');
      await orbit.burst();
      await sleep(220);
      onVerified(data);
    } catch (e) {
      errEl.textContent = e.message || 'Code incorrect';
      errEl.classList.remove('hidden');
      stage.classList.add('is-bad');
      board.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(0)' }],
        { duration: 360, easing: 'ease-in-out' }
      );
    } finally {
      busy = false;
    }
  }

  document.getElementById('otp-fill-btn')?.addEventListener('click', () => {
    hidden.value = otpDigitsFrom(otp.devOtp);
    paintOtpSlots(slots, hidden.value);
    syncRing();
    submitOtp();
  });

  document.getElementById('otp-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitOtp();
  });

  paintOtpSlots(slots, '');
  hidden.focus();
  requestAnimationFrame(syncRing);

  let resendLeft = 30;
  const resendBtn = document.getElementById('otp-resend');
  const tick = () => {
    if (resendLeft <= 0) {
      resendBtn.disabled = false;
      resendBtn.textContent = 'Renvoyer';
      return;
    }
    resendBtn.disabled = true;
    resendBtn.textContent = `Renvoyer dans ${resendLeft}s`;
    resendLeft -= 1;
    setTimeout(tick, 1000);
  };
  tick();

  resendBtn.onclick = async () => {
    if (resendBtn.disabled) return;
    try {
      const next = otp.email
        ? await auth.sendOtp({ email: otp.email })
        : await auth.resendOtp({ otpToken: otp.otpToken });
      if (next.otpToken) otp.otpToken = next.otpToken;
      otp.devOtp = next.devOtp;
      otp.channel = next.channel;
      const banner = document.getElementById('otp-fill');
      if (banner && next.channel === 'sms' && next.devOtp) {
        banner.querySelector('strong').textContent = next.devOtp;
      }
      const sentEl = document.getElementById('otp-sent');
      if (sentEl) sentEl.textContent = 'Nouveau code envoyé';
      hidden.value = '';
      paintOtpSlots(slots, '');
      syncRing();
      hidden.focus();
      resendLeft = 30;
      tick();
    } catch (e) {
      errEl.textContent = e.message || 'Impossible de renvoyer';
      errEl.classList.remove('hidden');
    }
  };
}

export async function renderAuthScreen({ setAuthPage, onLoggedIn }) {
  setAuthPage(true);

  let publicGroups = [];
  try {
    publicGroups = await groups.publicList();
  } catch { /* liste vide si API indisponible */ }

  const authUi = { mode: 'login', joinMode: 'pick' };
  const pendingJoin = (
    new URLSearchParams(window.location.search).get('join')
    || new URLSearchParams(window.location.search).get('invite')
    || sessionStorage.getItem('matchday_pending_join')
    || ''
  ).trim().toUpperCase();
  if (pendingJoin) {
    authUi.mode = 'register';
    authUi.joinMode = 'code';
    sessionStorage.setItem('matchday_pending_join', pendingJoin);
    history.replaceState({}, '', window.location.pathname);
  }

  const root = document.getElementById('app');

  async function finishLogin(data) {
    auth.setToken(data.token);
    if (authUi.pendingJoin) {
      try {
        if (authUi.pendingJoin.joinMode === 'pick' && authUi.pendingJoin.groupId) {
          await groups.join({ groupId: Number(authUi.pendingJoin.groupId) });
        } else if (authUi.pendingJoin.inviteCode) {
          await groups.join({ inviteCode: authUi.pendingJoin.inviteCode });
        }
      } catch { /* onboarding si le join échoue */ }
    }
    showSuccessThen(root.querySelector('.auth-wrap') || root, {
      title: authUi.mode === 'register' ? 'C’est vérifié' : 'Bon retour !',
      sub: authUi.mode === 'register' ? 'Ton compte est sécurisé.' : 'Tu es bien connecté.',
      onContinue: () => onLoggedIn(data),
    });
  }

  function paintForm() {
    root.innerHTML = `
      <div class="auth-screen">
        <div class="auth-wrap" id="auth-wrap">
          <div class="auth-hero">🏆</div>
          <h1 class="auth-title">Matchday</h1>
          <p class="auth-sub" id="auth-sub">Connecte-toi pour jouer</p>

          <div class="auth-tabs" id="auth-tabs">
            <button type="button" class="auth-tab" data-mode="login">Connexion</button>
            <button type="button" class="auth-tab" data-mode="register">Inscription</button>
          </div>

          <form id="auth-form" class="auth-form" novalidate>
            <label class="auth-field" id="username-field">
              <span class="auth-label">Pseudo</span>
              <div class="auth-input-wrap">
                <input id="username" class="auth-input" name="username" autocomplete="username" placeholder="ton pseudo" required>
                <span class="auth-input-icon auth-check">${CHECK}</span>
              </div>
            </label>
            <label class="auth-field" id="email-field">
              <span class="auth-label">Adresse mail</span>
              <div class="auth-input-wrap">
                <input id="email" class="auth-input" name="email" type="email" autocomplete="email" placeholder="toi@email.com">
                <span class="auth-input-icon auth-check">${CHECK}</span>
              </div>
            </label>
            <label class="auth-field" id="password-field">
              <span class="auth-label">Mot de passe</span>
              <div class="auth-input-wrap">
                <input id="password" class="auth-input" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required>
                <button type="button" class="auth-eye" id="password-toggle" aria-label="Afficher le mot de passe">${EYE}</button>
                <span class="auth-input-icon auth-check">${CHECK}</span>
              </div>
            </label>
            <button type="button" id="forgot-link" class="auth-forgot-link">Mot de passe oublié ?</button>
            <p id="forgot-hint" class="auth-forgot-link hidden">Pas de reset public : demande à un admin du serveur.</p>

            <div id="join-section" class="auth-join-block hidden">
              <div class="auth-section-label">Rejoindre un groupe</div>
              <div class="auth-subtabs">
                <button type="button" class="auth-subtab active" data-join="pick">Choisir un groupe</button>
                <button type="button" class="auth-subtab" data-join="code">Code d'accès</button>
              </div>
              <div id="join-pick">${renderPublicGroupOptions(publicGroups)}</div>
              <div id="join-code" class="hidden">
                <input id="invite-code" class="auth-input" placeholder="EX. CDM7X2K" autocomplete="off" style="text-transform:uppercase">
              </div>
            </div>

            <div class="auth-secure hidden" id="auth-secure">
              <div class="auth-scan-shield">
                <svg class="auth-scan-svg" viewBox="0 0 140 140" aria-hidden="true">
                  <circle class="auth-scan-ticks" cx="70" cy="70" r="58"/>
                  <circle class="auth-scan-progress" cx="70" cy="70" r="50"/>
                </svg>
                <div class="auth-scan-core">${LOCK}</div>
              </div>
              <ul class="auth-secure-list">
                <li data-step="credentials">Identifiants</li>
                <li data-step="security">Contrôle de sécurité</li>
                <li data-step="auth">Authentification</li>
              </ul>
            </div>

            <button type="submit" class="auth-submit" id="auth-submit">Se connecter</button>
            <div class="error-msg hidden" id="auth-error"></div>
          </form>
        </div>
      </div>`;

    const form = document.getElementById('auth-form');
    const errEl = document.getElementById('auth-error');
    const passwordEl = document.getElementById('password');
    const usernameEl = document.getElementById('username');
    const emailEl = document.getElementById('email');
    const forgotLink = document.getElementById('forgot-link');
    const forgotHint = document.getElementById('forgot-hint');
    const joinSection = document.getElementById('join-section');
    const joinPick = document.getElementById('join-pick');
    const joinCode = document.getElementById('join-code');
    const submitBtn = document.getElementById('auth-submit');
    const emailField = document.getElementById('email-field');
    const subEl = document.getElementById('auth-sub');
    const secureEl = document.getElementById('auth-secure');

    wirePasswordToggle(passwordEl, document.getElementById('password-toggle'));

    const clearError = () => {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    };

    const syncAuthUi = () => {
      const isRegister = authUi.mode === 'register';
      document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === authUi.mode);
      });
      document.querySelectorAll('.auth-subtab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.join === authUi.joinMode);
      });
      joinSection.classList.toggle('hidden', !isRegister);
      joinPick.classList.toggle('hidden', !isRegister || authUi.joinMode !== 'pick');
      joinCode.classList.toggle('hidden', !isRegister || authUi.joinMode !== 'code');
      forgotLink.classList.toggle('hidden', authUi.mode !== 'login');
      if (authUi.mode !== 'login') forgotHint.classList.add('hidden');
      emailField.classList.toggle('hidden', !isRegister);
      submitBtn.textContent = isRegister ? "S'inscrire" : 'Se connecter';
      subEl.textContent = isRegister ? 'Crée ton compte pour jouer' : 'Connecte-toi pour jouer';
      usernameEl.placeholder = isRegister ? 'ton pseudo' : 'pseudo ou email';
      document.querySelector('#username')?.closest('.auth-field')
        ?.querySelector('.auth-label')?.replaceChildren(isRegister ? 'Pseudo' : 'Pseudo ou email');
      passwordEl.autocomplete = isRegister ? 'new-password' : 'current-password';
      emailEl.required = isRegister;
      const inviteEl = document.getElementById('invite-code');
      if (inviteEl && pendingJoin && isRegister && authUi.joinMode === 'code') {
        inviteEl.value = pendingJoin;
      }
      refreshValidity();
    };

    const refreshValidity = () => {
      const isRegister = authUi.mode === 'register';
      setFieldValid(usernameEl.parentElement, usernameEl.value.trim().length >= 2);
      setFieldValid(emailEl.parentElement, isRegister && EMAIL_RE.test(emailEl.value.trim()));
      setFieldValid(
        passwordEl.closest('.auth-input-wrap'),
        isRegister ? passwordEl.value.length >= 6 : passwordEl.value.length > 0
      );
    };

    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.onclick = () => {
        authUi.mode = tab.dataset.mode;
        clearError();
        syncAuthUi();
      };
    });
    forgotLink.onclick = () => forgotHint.classList.toggle('hidden');
    document.querySelectorAll('.auth-subtab').forEach(tab => {
      tab.onclick = () => {
        authUi.joinMode = tab.dataset.join;
        clearError();
        syncAuthUi();
      };
    });

    usernameEl.addEventListener('input', () => { clearError(); refreshValidity(); });
    emailEl.addEventListener('input', () => { clearError(); refreshValidity(); });
    passwordEl.addEventListener('input', () => { clearError(); refreshValidity(); });
    document.getElementById('invite-code')?.addEventListener('input', clearError);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const isRegister = authUi.mode === 'register';
      const username = usernameEl.value.trim();
      const password = passwordEl.value;
      const email = emailEl.value.trim();

      if (!username) {
        errEl.textContent = isRegister ? 'Choisis un pseudo' : 'Entre ton pseudo ou ton email';
        errEl.classList.remove('hidden');
        return;
      }
      if (isRegister && !EMAIL_RE.test(email)) {
        errEl.textContent = 'Entre une adresse mail valide';
        errEl.classList.remove('hidden');
        return;
      }
      if (!password) {
        errEl.textContent = 'Entre un mot de passe';
        errEl.classList.remove('hidden');
        return;
      }
      if (isRegister && password.length < 6) {
        errEl.textContent = 'Mot de passe trop court — 6 caractères minimum';
        errEl.classList.remove('hidden');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Authentification…';
      errEl.classList.add('hidden');

      try {
        const data = await playSecureSteps(secureEl, () => (
          isRegister
            ? auth.register({ username, password, email, displayName: username })
            : auth.login({ username, password })
        ), submitBtn);

        if (data.needsOtp) {
          if (isRegister) {
            authUi.pendingJoin = {
              joinMode: authUi.joinMode,
              groupId: document.getElementById('public-group')?.value,
              inviteCode: document.getElementById('invite-code')?.value.trim(),
            };
          }
          const wrap = document.getElementById('auth-wrap');
          renderOtpView(wrap, {
            otp: data,
            onBack: paintForm,
            onVerified: finishLogin,
          });
          return;
        }

        if (isRegister) {
          authUi.pendingJoin = {
            joinMode: authUi.joinMode,
            groupId: document.getElementById('public-group')?.value,
            inviteCode: document.getElementById('invite-code')?.value.trim(),
          };
        }
        await finishLogin(data);
      } catch (err) {
        errEl.textContent = err.message || 'Une erreur est survenue';
        errEl.classList.remove('hidden');
        submitBtn.classList.remove('is-busy');
        submitBtn.textContent = isRegister ? "S'inscrire" : 'Se connecter';
      } finally {
        submitBtn.disabled = false;
      }
    });

    syncAuthUi();
  }

  paintForm();
}
