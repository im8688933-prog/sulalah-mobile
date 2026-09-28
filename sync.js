(() => {
  'use strict';

  const CONFIG_KEY = 'sulalah.sync.config.v1';
  const SESSION_KEY = 'sulalah.sync.session.v1';
  const SYNC_INTERVAL_MS = 7000;
  const DEFAULT_CONFIG = {
    url: 'https://ijujeenvzgrjrmjruzmj.supabase.co',
    key: 'sb_publishable_aqIPgf8LaqlnN08aqRndtA_vtmv2LZA'
  };
  const app = window.SulalahApp;
  if (!app) return;

  let config = readStored(CONFIG_KEY, DEFAULT_CONFIG);
  let session = readStored(SESSION_KEY, null);
  let canEdit = false;
  let lastRemoteUpdatedAt = '';
  let pollTimer = null;
  let pushTimer = null;
  let pushBusy = false;
  let pendingSnapshot = null;
  let connectionBusy = false;
  let pollBusy = false;
  let pollingStarted = false;
  let previousFocus = null;
  let lastPairCode = '';
  let lastPairCodeExpiresAt = 0;
  let viewerScanner = null;
  let codeScanHandled = false;

  const ui = mountUi();
  setStatus('idle', app.isForcedReadOnly ? 'عرض فقط · أدخل رمز الكمبيوتر' : 'المزامنة غير مهيّأة');

  function readStored(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }

  function mountUi() {
    const topActions = document.querySelector('.top-actions');
    const statusButton = document.createElement('button');
    statusButton.type = 'button';
    statusButton.id = 'sync-open';
    statusButton.className = 'sync-status';
    statusButton.setAttribute('aria-haspopup', 'dialog');
    statusButton.setAttribute('aria-label', 'حالة مزامنة سجل العائلة');
    statusButton.innerHTML = '<span class="sync-indicator" aria-hidden="true"></span><span id="sync-label"></span>';
    topActions.prepend(statusButton);

    const readerMode = app.isForcedReadOnly;
    const fields = readerMode
      ? '<label class="sync-field"><span>أو أدخل رمز الربط يدويًا</span><input id="sync-code" type="text" inputmode="numeric" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" dir="ltr" maxlength="10" placeholder="١٢٣٤٥٦٧٨٩" aria-label="رمز الربط من الكمبيوتر"></label>'
      : '<label class="sync-field"><span>البريد الإلكتروني للحساب</span><input id="sync-email" type="email" autocomplete="username" required></label><label class="sync-field"><span>كلمة المرور</span><input id="sync-password" type="password" autocomplete="current-password" required></label>';
    const scanPanel = readerMode
      ? '<button type="button" class="btn btn-outline sync-scan-button" id="sync-scan-code">مسح QR بالكاميرا</button><div id="sync-qr-reader" class="sync-qr-reader hidden"></div><p class="sync-scan-hint">وجّه الكاميرا نحو الرمز الظاهر على الكمبيوتر.</p>'
      : '';
    const pairingPanel = readerMode ? '' :
      '<div id="sync-pair-panel" class="sync-pair-panel hidden"><span class="section-kicker">ربط الجوال</span><strong>امسح الرمز من تطبيق الهاتف</strong><p>رمز مؤقت لمرة واحدة، صالح لخمس دقائق.</p><div id="sync-pair-qr" class="sync-pair-qr" aria-label="رمز ربط الجوال"></div><div class="sync-pair-code" id="sync-pair-code" dir="ltr"></div><small id="sync-pair-expiry"></small><button type="button" class="btn btn-outline" id="sync-create-code">إنشاء رمز للجوال</button></div>';

    const overlay = document.createElement('section');
    overlay.id = 'sync-dialog';
    overlay.className = 'sync-dialog-backdrop hidden';
    overlay.setAttribute('role', 'presentation');
    overlay.innerHTML =
      '<div class="sync-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-title" dir="rtl">' +
        '<div class="sync-dialog-heading"><div><span class="section-kicker">حفظ ومزامنة</span><h2 id="sync-title">مزامنة سجل العائلة</h2></div><button type="button" class="icon-button" id="sync-close" aria-label="إغلاق">×</button></div>' +
        '<p class="sync-description">' + (readerMode
          ? 'الخطوة الوحيدة: امسح QR الظاهر على الكمبيوتر. لا تحتاج إلى حساب أو كلمة مرور، وهذا الجهاز للقراءة فقط.'
          : 'سجّل الدخول بحساب الكمبيوتر لمزامنة سجل العائلة. يمكنك إنشاء رمز مؤقت لربط الجوال.') + '</p>' +
        '<form id="sync-form" autocomplete="on">' + scanPanel + fields +
          '<div class="sync-error hidden" id="sync-error" role="alert"></div>' +
          '<div class="sync-dialog-actions"><button type="submit" class="btn btn-primary" id="sync-connect">' + (readerMode ? 'ربط الجوال' : 'اتصال آمن') + '</button><button type="button" class="btn btn-quiet hidden" id="sync-signout">تسجيل الخروج</button></div>' +
        '</form>' + pairingPanel +
        '<p class="sync-footnote">' + (readerMode
          ? 'لا يحتاج الجوال إلى بريد إلكتروني أو كلمة مرور. يُحفظ ربط هذا الجهاز محليًا؛ إعادة التثبيت تتطلب رمزًا جديدًا.'
          : 'رابط المشروع ومفتاحه العام مُعدّان مسبقًا. لا يُحفظ نص كلمة المرور.') + '</p>' +
      '</div>';
    document.body.appendChild(overlay);

    statusButton.addEventListener('click', openDialog);
    overlay.querySelector('#sync-close').addEventListener('click', closeDialog);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeDialog(); });
    document.addEventListener('keydown', event => {
      if (overlay.classList.contains('hidden')) return;
      if (event.key === 'Escape') { closeDialog(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled])')]
        .filter(element => !element.closest('.hidden') && element.getClientRects().length);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    if (!readerMode) {
      overlay.querySelector('#sync-email').value = session?.user?.email || '';
      overlay.querySelector('#sync-create-code').addEventListener('click', createViewerCode);
    } else {
      overlay.querySelector('#sync-scan-code').addEventListener('click', startCodeScanner);
    }
    overlay.querySelector('#sync-signout').addEventListener('click', signOut);
    overlay.querySelector('#sync-form').addEventListener('submit', signIn);
    return {
      statusButton,
      overlay,
      label: statusButton.querySelector('#sync-label'),
      indicator: statusButton.querySelector('.sync-indicator'),
      pairPanel: overlay.querySelector('#sync-pair-panel'),
      pairCode: overlay.querySelector('#sync-pair-code'),
      pairExpiry: overlay.querySelector('#sync-pair-expiry')
    };
  }

  function openDialog() {
    previousFocus = document.activeElement;
    ui.overlay.classList.remove('hidden');
    ui.overlay.querySelector('#sync-error').classList.add('hidden');
    ui.overlay.querySelector('#sync-signout').classList.toggle('hidden', !session);
    ui.overlay.querySelector('#sync-connect').textContent = app.isForcedReadOnly
      ? (session ? 'إعادة الاتصال' : 'ربط الجوال')
      : (session ? 'حساب الكمبيوتر متصل' : 'اتصال آمن');
    if (app.isForcedReadOnly) {
      const codeInput = ui.overlay.querySelector('#sync-code');
      if (codeInput) codeInput.value = '';
      if (!session) (ui.overlay.querySelector('#sync-scan-code') || codeInput)?.focus();
    } else {
      ui.overlay.querySelector('#sync-password').value = '';
      ui.overlay.querySelector('#sync-email').focus();
      if (ui.pairPanel) ui.pairPanel.classList.toggle('hidden', !canEdit);
      if (lastPairCode && Date.now() < lastPairCodeExpiresAt && ui.pairCode) {
        ui.pairCode.textContent = lastPairCode;
        renderPairQr(lastPairCode);
        ui.pairExpiry.textContent = 'صالح لعدة دقائق';
      }
    }
  }

  function closeDialog() {
    stopCodeScanner();
    ui.overlay.classList.add('hidden');
    if (previousFocus?.focus) previousFocus.focus();
    previousFocus = null;
  }

  function setStatus(state, label) {
    ui.statusButton.dataset.state = state;
    ui.label.textContent = label;
    ui.statusButton.title = label;
    ui.statusButton.setAttribute('aria-label', label);
  }

  function showError(message) {
    const error = ui.overlay.querySelector('#sync-error');
    const text = String(message || 'تعذر إكمال الربط. حاول مرة أخرى.');
    const lower = text.toLowerCase();
    if (lower.includes('invalid login credentials')) message = 'بيانات دخول الكمبيوتر غير صحيحة. راجع البريد وكلمة المرور.';
    else if (lower.includes('anonymous sign') && (lower.includes('disabled') || lower.includes('not enabled'))) message = 'ربط الجوال لم يُفعّل بعد في Supabase. أكمل خطوة تفعيل الربط ثم جرّب مجددًا.';
    else if (lower.includes('too many requests') || lower.includes('rate limit')) message = 'محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم جرّب مجددًا.';
    else if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) message = 'تعذر الاتصال بالإنترنت. تحقق من الاتصال ثم حاول مجددًا.';
    error.textContent = message || text;
    error.classList.remove('hidden');
  }

  function ensureConfig() {
    if (!config?.url || !config?.key) config = {...DEFAULT_CONFIG};
    const parsed = new URL(config.url);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co'))
      throw new Error('تعذر قراءة إعداد مشروع المزامنة.');
    if (!store(CONFIG_KEY, config)) throw new Error('تعذر حفظ إعداد المزامنة على هذا الجهاز.');
  }

  async function authRequest(parameters, body) {
    const response = await fetch(config.url + '/auth/v1/token?grant_type=' + encodeURIComponent(parameters), {
      method: 'POST',
      headers: {apikey: config.key, 'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.message || result.error_description || result.error || 'تعذر التحقق من بيانات الدخول.');
    return result;
  }

  async function anonymousSignUp() {
    const response = await fetch(config.url + '/auth/v1/signup', {
      method: 'POST',
      headers: {apikey: config.key, 'Content-Type': 'application/json'},
      body: JSON.stringify({data: {sulalah_device: 'viewer'}}),
      cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.message || result.error_description || result.error || 'تعذر بدء ربط الجوال.');
    if (!result.access_token || !result.refresh_token || !result.user)
      throw new Error('لم يبدأ تسجيل الجوال المجهول. تحقق من تفعيل ربط الجوال في المشروع.');
    return result;
  }

  function saveSession(result) {
    session = {...result, expires_at: result.expires_at || Math.floor(Date.now() / 1000) + (result.expires_in || 3600)};
    if (!store(SESSION_KEY, session)) throw new Error('تعذر حفظ جلسة الربط على هذا الجهاز.');
  }

  async function ensureSession() {
    if (!session?.access_token || !session?.refresh_token) throw new Error('انتهت الجلسة. أعد ربط الجهاز.');
    if (Number(session.expires_at || 0) > Math.floor(Date.now() / 1000) + 90) return session;
    const refreshed = await authRequest('refresh_token', {refresh_token: session.refresh_token});
    saveSession({...refreshed, user: refreshed.user || session.user});
    return session;
  }

  async function apiRequest(path, options = {}) {
    const activeSession = await ensureSession();
    const headers = {
      apikey: config.key,
      Authorization: 'Bearer ' + activeSession.access_token,
      Accept: 'application/json',
      ...options.headers
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(config.url + '/rest/v1/' + path, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store'
    });
    const raw = await response.text();
    let result = null;
    try { result = raw ? JSON.parse(raw) : null; } catch { result = raw; }
    if (!response.ok) {
      const message = result?.message || result?.hint || result?.error || ('تعذر الوصول إلى سجل العائلة (HTTP ' + response.status + ').');
      throw new Error(message);
    }
    return result;
  }

  async function rpcRequest(name, body) {
    return apiRequest('rpc/' + name, {method: 'POST', body});
  }

  async function getRole() {
    const userId = encodeURIComponent(session.user.id);
    const rows = await apiRequest('family_access?select=can_edit&user_id=eq.' + userId + '&limit=1');
    if (!Array.isArray(rows) || !rows.length) throw new Error('لم يُربط هذا الجوال بعد. أدخل رمزًا صالحًا من الكمبيوتر.');
    return rows[0].can_edit === true;
  }

  async function readFamilyState(metadataOnly = false) {
    const columns = metadataOnly ? 'updated_at' : 'data,updated_at';
    const rows = await apiRequest('family_state?select=' + columns + '&id=eq.family&limit=1');
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function pushFamilyState(snapshot) {
    const row = {id: 'family', data: snapshot};
    const result = await apiRequest('family_state?on_conflict=id', {
      method: 'POST',
      headers: {Prefer: 'resolution=merge-duplicates,return=representation'},
      body: row
    });
    const saved = Array.isArray(result) ? result[0] : null;
    if (saved?.updated_at) lastRemoteUpdatedAt = saved.updated_at;
    setStatus('online', 'متصل · الكمبيوتر يزامن التغييرات');
  }

  function applyFamilyState(row) {
    if (!row?.data || !Array.isArray(row.data.people)) throw new Error('بيانات سجل العائلة السحابي غير مكتملة.');
    if (row.updated_at && row.updated_at === lastRemoteUpdatedAt) return false;
    if (!app.replacePeople(row.data.people)) throw new Error('تعذر تحديث النسخة المحلية من سجل العائلة.');
    lastRemoteUpdatedAt = row.updated_at || new Date().toISOString();
    setStatus('online', 'متصل · السجل محدّث');
    return true;
  }

  async function initialSync() {
    const row = await readFamilyState(false);
    if (canEdit) {
      if (!row) await pushFamilyState(app.getSnapshot());
      else if (app.hasSavedLocalData()) await pushFamilyState(app.getSnapshot());
      else applyFamilyState(row);
    } else if (row) {
      applyFamilyState(row);
    } else {
      setStatus('waiting', 'متصل · بانتظار مزامنة الكمبيوتر');
    }
    startPolling();
  }

  async function pollFamilyState() {
    if (connectionBusy || pollBusy || document.visibilityState === 'hidden' || !session) return;
    pollBusy = true;
    try {
      const meta = await readFamilyState(true);
      if (!meta) {
        setStatus('waiting', canEdit ? 'متصل · لا يوجد سجل سحابي بعد' : 'متصل · بانتظار مزامنة الكمبيوتر');
        return;
      }
      if (meta.updated_at && meta.updated_at !== lastRemoteUpdatedAt) {
        const row = await readFamilyState(false);
        if (row && applyFamilyState(row) && !canEdit) {
          const toast = document.getElementById('toast');
          toast.textContent = 'تم استلام تحديث من الكمبيوتر.';
          toast.classList.remove('hidden');
          window.setTimeout(() => toast.classList.add('hidden'), 2600);
        }
      } else {
        setStatus('online', canEdit ? 'متصل · الكمبيوتر يزامن التغييرات' : 'متصل · يتحدث تلقائيًا');
      }
    } catch (error) {
      setStatus('offline', 'غير متصل · ستتم إعادة المحاولة');
      if (/انتهت الجلسة|refresh/i.test(error.message)) recoverSession(error);
    } finally {
      pollBusy = false;
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') pollFamilyState();
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollFamilyState, SYNC_INTERVAL_MS);
    if (!pollingStarted) {
      window.addEventListener('online', pollFamilyState);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      pollingStarted = true;
    }
  }

  async function flushPendingPush() {
    if (pushBusy || !pendingSnapshot || !session || !canEdit) return;
    pushBusy = true;
    const current = pendingSnapshot;
    pendingSnapshot = null;
    try {
      await pushFamilyState(current);
    } catch (error) {
      pendingSnapshot = current;
      setStatus('offline', 'تعذر الإرسال · ستتم إعادة المحاولة');
      window.setTimeout(flushPendingPush, 10000);
    } finally {
      pushBusy = false;
      if (pendingSnapshot) window.setTimeout(flushPendingPush, 100);
    }
  }

  function schedulePush(snapshot) {
    pendingSnapshot = snapshot;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flushPendingPush, 350);
  }

  async function activateSession() {
    canEdit = await getRole();
    if (app.isForcedReadOnly && canEdit) {
      session = null;
      localStorage.removeItem(SESSION_KEY);
      canEdit = false;
      throw new Error('هذا الجهاز مخصص للقراءة فقط.');
    }
    app.setCanEdit(canEdit);
    ui.overlay.querySelector('#sync-signout').classList.remove('hidden');
    ui.overlay.querySelector('#sync-connect').textContent = canEdit ? 'حساب الكمبيوتر متصل' : 'الجوال مرتبط للقراءة فقط';
    if (ui.pairPanel) ui.pairPanel.classList.toggle('hidden', !canEdit);
    await initialSync();
    if (!app.isForcedReadOnly) ui.overlay.querySelector('#sync-email').value = session.user.email || '';
  }

  async function createViewerCode() {
    if (connectionBusy || !canEdit || !ui.pairCode) return;
    const button = ui.overlay.querySelector('#sync-create-code');
    button.disabled = true;
    ui.overlay.querySelector('#sync-error').classList.add('hidden');
    try {
      ensureConfig();
      const result = await rpcRequest('create_sulalah_viewer_code', {});
      const payload = Array.isArray(result) ? result[0] : result;
      if (!payload?.code) throw new Error(payload?.message || 'تعذر إنشاء رمز الجوال.');
      lastPairCode = String(payload.code);
      lastPairCodeExpiresAt = new Date(payload.expires_at).getTime();
      ui.pairCode.textContent = lastPairCode;
      renderPairQr(lastPairCode);
      ui.pairExpiry.textContent = 'صالح لمدة ٥ دقائق ويستخدم مرة واحدة.';
      ui.pairPanel.classList.remove('hidden');
    } catch (error) {
      showError(error.message || 'تعذر إنشاء رمز الربط.');
    } finally {
      button.disabled = false;
    }
  }

  function renderPairQr(code) {
    const target = ui.overlay.querySelector('#sync-pair-qr');
    if (!target) return;
    target.replaceChildren();
    if (typeof window.QRCode !== 'function') {
      target.textContent = 'تعذر عرض QR. استخدم الرمز الرقمي أدناه.';
      return;
    }
    new window.QRCode(target, {
      text: code,
      width: 192,
      height: 192,
      colorDark: '#153e35',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }

  async function startCodeScanner() {
    const button = ui.overlay.querySelector('#sync-scan-code');
    const reader = ui.overlay.querySelector('#sync-qr-reader');
    if (viewerScanner) {
      await stopCodeScanner();
      return;
    }
    if (typeof window.Html5Qrcode !== 'function') {
      showError('تعذر تحميل ماسح QR. تحقق من الإنترنت أو أدخل الرمز يدويًا.');
      return;
    }

    codeScanHandled = false;
    button.disabled = true;
    reader.classList.remove('hidden');
    ui.overlay.querySelector('#sync-error').classList.add('hidden');
    try {
      const cameras = await window.Html5Qrcode.getCameras();
      if (!cameras.length) throw new Error('لم يتم العثور على كاميرا في هذا الجهاز.');
      const camera = cameras.find(item => /back|rear|environment/i.test(item.label)) || cameras[0];
      viewerScanner = new window.Html5Qrcode('sync-qr-reader', {verbose: false});
      button.textContent = 'إيقاف المسح';
      await viewerScanner.start(camera.id, {fps: 10, qrbox: {width: 220, height: 220}, aspectRatio: 1}, async value => {
        if (codeScanHandled) return;
        const code = normalizePairCode(value);
        if (code.length !== 10) {
          showError('هذا QR ليس رمز ربط سلالة. امسح الرمز المعروض على الكمبيوتر.');
          return;
        }
        codeScanHandled = true;
        ui.overlay.querySelector('#sync-code').value = code;
        await stopCodeScanner();
        ui.overlay.querySelector('#sync-form').requestSubmit();
      }, () => {});
    } catch (error) {
      showError(error.message || 'تعذر فتح الكاميرا. تحقق من إذن الكاميرا أو أدخل الرمز يدويًا.');
      await stopCodeScanner();
    } finally {
      button.disabled = false;
    }
  }

  async function stopCodeScanner() {
    const scanner = viewerScanner;
    viewerScanner = null;
    codeScanHandled = false;
    if (scanner) {
      try {
        if (scanner.isScanning) await scanner.stop();
        scanner.clear();
      } catch {}
    }
    const reader = ui.overlay.querySelector('#sync-qr-reader');
    if (reader) {
      reader.classList.add('hidden');
      reader.replaceChildren();
    }
    const button = ui.overlay.querySelector('#sync-scan-code');
    if (button) button.textContent = 'مسح QR بالكاميرا';
  }

  function normalizePairCode(value) {
    const arabic = '٠١٢٣٤٥٦٧٨٩';
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    return String(value || '')
      .replace(/[٠-٩]/g, digit => String(arabic.indexOf(digit)))
      .replace(/[۰-۹]/g, digit => String(persian.indexOf(digit)))
      .replace(/\D/g, '');
  }

  async function connectViewer(code) {
    ensureConfig();
    if (!session?.refresh_token) {
      if (!code) throw new Error('أدخل الرمز الذي يظهر في تطبيق الكمبيوتر.');
      saveSession(await anonymousSignUp());
    } else {
      await ensureSession();
    }
    if (session.user?.is_anonymous && code) {
      let alreadyPaired = false;
      try { await getRole(); alreadyPaired = true; }
      catch (error) {
        if (!String(error.message || '').includes('لم يُربط هذا الجوال بعد')) throw error;
      }
      if (!alreadyPaired) {
        const result = await rpcRequest('claim_sulalah_viewer_code', {p_code: code});
        if (!result?.success) throw new Error(result?.message || 'الرمز غير صالح أو انتهت صلاحيته.');
      }
    }
    await activateSession();
  }

  async function connectEditor() {
    ensureConfig();
    const email = ui.overlay.querySelector('#sync-email').value.trim();
    const password = ui.overlay.querySelector('#sync-password').value;
    if (!email || !password) throw new Error('أدخل البريد الإلكتروني وكلمة المرور.');
    const result = await authRequest('password', {email, password});
    saveSession(result);
    await activateSession();
    ui.overlay.querySelector('#sync-password').value = '';
  }

  async function signIn(event) {
    event.preventDefault();
    if (connectionBusy) return;
    connectionBusy = true;
    const button = ui.overlay.querySelector('#sync-connect');
    button.disabled = true;
    ui.overlay.querySelector('#sync-error').classList.add('hidden');
    try {
      if (app.isForcedReadOnly) {
        const code = normalizePairCode(ui.overlay.querySelector('#sync-code').value);
        await connectViewer(code);
      } else {
        await connectEditor();
      }
      closeDialog();
    } catch (error) {
      canEdit = app.isForcedReadOnly ? false : !session;
      app.setCanEdit(canEdit);
      setStatus('offline', app.isForcedReadOnly ? 'عرض فقط · تعذر الربط' : 'محليًا · تعذرت المزامنة');
      showError(error.message || 'تعذر الاتصال. تحقق من الإنترنت وإعدادات المزامنة.');
    } finally {
      connectionBusy = false;
      button.disabled = false;
    }
  }

  async function resumeSession() {
    if (!config || !session?.refresh_token) return;
    connectionBusy = true;
    try {
      ensureConfig();
      await ensureSession();
      await activateSession();
    } catch (error) {
      localStorage.removeItem(SESSION_KEY);
      session = null;
      canEdit = false;
      app.setCanEdit(false);
      setStatus('offline', app.isForcedReadOnly ? 'عرض فقط · أدخل رمز الكمبيوتر' : 'محليًا · سجّل الدخول للمزامنة');
      if (!app.isForcedReadOnly) app.setCanEdit(true);
    } finally {
      connectionBusy = false;
    }
  }

  function recoverSession(error) {
    session = null;
    localStorage.removeItem(SESSION_KEY);
    app.setCanEdit(app.isForcedReadOnly ? false : true);
    setStatus('offline', 'انتهت الجلسة · أعد ربط الجهاز');
    showError(error.message || 'أعد ربط الجهاز.');
  }

  function signOut() {
    session = null;
    canEdit = false;
    lastRemoteUpdatedAt = '';
    localStorage.removeItem(SESSION_KEY);
    if (pollTimer) clearInterval(pollTimer);
    app.setCanEdit(app.isForcedReadOnly ? false : true);
    setStatus('idle', app.isForcedReadOnly ? 'عرض فقط · أدخل رمز الكمبيوتر' : 'محليًا · سجّل الدخول للمزامنة');
    if (ui.pairPanel) ui.pairPanel.classList.add('hidden');
    closeDialog();
  }

  window.addEventListener('sulalah:local-change', event => {
    if (canEdit && session) schedulePush(event.detail || app.getSnapshot());
  });

  if (config && session?.refresh_token) resumeSession();
})();
