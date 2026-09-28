(() => {
  const STORAGE_KEY = 'sulalah.people.v1';
  const data = { app: 'سلالة', version: 1, exportedAt: '', people: [] };
  const FORCE_READ_ONLY = window.SULALAH_FORCE_READ_ONLY === true;
  let canEdit = !FORCE_READ_ONLY;
  let hasSavedLocalData = false;
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const digits = (value) => String(value).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
  const stamp = () => new Date().toISOString();
  const makeId = () => (globalThis.crypto?.randomUUID ? `p_${crypto.randomUUID()}` : `p_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  let toastTimer;
  let installPrompt = null;
  document.documentElement.dataset.access = canEdit ? 'editor' : 'viewer';

  function loadPeople() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.people)) { hasSavedLocalData = true; return parsed.people; }
      }
    } catch (error) {
      console.error('تعذر قراءة السجل المحلي', error);
      showToast('تعذر قراءة البيانات المحفوظة. أعد استيراد نسخة احتياطية.');
    }
    const initial = window.SULALAH_INITIAL_DATA;
    return Array.isArray(initial?.people) ? initial.people.map(person => ({...person})) : [];
  }
  data.people = loadPeople();

  function persist(skipCloudSync = false) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({...data, exportedAt: stamp()}));
      hasSavedLocalData = true;
      renderAll();
      if (!skipCloudSync && canEdit) window.dispatchEvent(new CustomEvent('sulalah:local-change', {detail:{...data, exportedAt:stamp()}}));
      return true;
    } catch (error) {
      console.error('تعذر حفظ السجل المحلي', error);
      showToast('تعذر الحفظ. صدّر نسخة احتياطية وأفرغ مساحة في المتصفح.');
      return false;
    }
  }
  function byId(personId) { return data.people.find(p => p.id === personId); }
  function childrenOf(personId) { return data.people.filter(p => p.fatherId === personId || p.motherId === personId); }
  function personLabel(personId) { return byId(personId)?.name || 'غير مسجل'; }
  function initials(name) { return [...(name || '?')].find(ch => /[ء-يA-Za-z0-9]/.test(ch)) || '؟'; }
  function showToast(message) {
    const node = $('toast'); node.textContent = message; node.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.add('hidden'), 2800);
  }
  function formatDate(dateValue) {
    if (!dateValue) return '—';
    const date = new Date(dateValue);
    if (Number.isNaN(date.valueOf())) return '—';
    return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {day:'numeric', month:'short', year:'numeric'}).format(date);
  }
  function updatedSort(a,b) { return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''); }
  function renderStats() {
    const linked = data.people.filter(p => p.fatherId || p.motherId).length;
    const branches = new Set(data.people.map(p => (p.branch || '').trim()).filter(Boolean));
    const latest = [...data.people].sort(updatedSort)[0];
    $('stat-people').textContent = digits(data.people.length);
    $('stat-linked').textContent = digits(linked);
    $('stat-branches').textContent = digits(branches.size);
    $('stat-updated').textContent = latest ? formatDate(latest.updatedAt || latest.createdAt) : '—';
    $('nav-count').textContent = digits(data.people.length);
    $('backup-count').textContent = `${digits(data.people.length)} فرد`;
  }
  function renderRecent() {
    const host = $('recent-list');
    const recent = [...data.people].sort(updatedSort).slice(0, 5);
    if (!recent.length) { host.innerHTML = '<div class="tree-empty">لا يوجد أفراد بعد. ابدأ بإضافة أول اسم إلى السجل.</div>'; return; }
    host.innerHTML = recent.map(p => `<div class="recent-row" data-open-person="${escapeHtml(p.id)}"><div class="recent-ident"><span class="person-avatar">${escapeHtml(initials(p.name))}</span><strong class="recent-name">${escapeHtml(p.name)}</strong></div><span class="recent-meta">${escapeHtml(p.branch || 'دون فرع محدد')}</span><span class="tag">${escapeHtml(p.gender || 'غير محدد')}</span></div>`).join('');
  }
  function renderPeople() {
    const query = $('people-search').value.trim().toLocaleLowerCase('ar');
    const gender = $('gender-filter').value;
    const list = data.people.filter(p => (!gender || (p.gender || 'غير محدد') === gender) && (!query || [p.name,p.branch,p.residence,personLabel(p.fatherId),personLabel(p.motherId)].some(v => String(v || '').toLocaleLowerCase('ar').includes(query))));
    $('result-count').textContent = `${digits(list.length)} من ${digits(data.people.length)} فرد`;
    $('people-empty').classList.toggle('hidden', list.length > 0);
    $('people-rows').innerHTML = list.map(p => `<tr><td><div class="person-cell"><span class="person-avatar">${escapeHtml(initials(p.name))}</span><div><div class="person-name">${escapeHtml(p.name)}</div><div class="person-sub">${escapeHtml(p.gender || 'غير محدد')}${p.birthYear ? ` · ${escapeHtml(p.birthYear)}` : ''}</div></div></div></td><td>${p.branch ? `<span class="tag">${escapeHtml(p.branch)}</span>` : '<span class="person-sub">—</span>'}</td><td><div class="truncate">${escapeHtml(p.fatherId && p.fatherId !== p.id ? personLabel(p.fatherId) : '—')}</div></td><td><div class="truncate">${escapeHtml(p.residence || '—')}</div></td><td><div class="row-actions"><button class="small-action" data-edit="${escapeHtml(p.id)}" aria-label="تعديل ${escapeHtml(p.name)}">تعديل</button><button class="small-action" data-open-person="${escapeHtml(p.id)}" aria-label="فتح شجرة ${escapeHtml(p.name)}">الشجرة</button></div></td></tr>`).join('');
  }
  function updatePersonChoices() {
    const ordered = [...data.people].sort((a,b) => a.name.localeCompare(b.name, 'ar'));
    for (const field of ['field-father','field-mother']) {
      const select = $(field); const previous = select.value;
      select.innerHTML = '<option value="">غير محدد</option>' + ordered.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
      if (ordered.some(p => p.id === previous)) select.value = previous;
    }
    const treeSelect = $('tree-person');
    const selected = treeSelect.value;
    treeSelect.innerHTML = ordered.length ? ordered.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('') : '<option value="">أضف فرداً لعرض الشجرة</option>';
    if (ordered.some(p => p.id === selected)) treeSelect.value = selected;
    else if (ordered.length) treeSelect.value = ordered.find(p => !p.fatherId && !p.motherId)?.id || ordered[0].id;
  }
  function renderTree() {
    const selectedId = $('tree-person').value;
    const current = byId(selectedId);
    const host = $('tree-content');
    if (!current) { host.innerHTML = '<div class="tree-empty">أضف فرداً إلى السجل لتبدأ ببناء شجرة العائلة.</div>'; return; }
    const ancestors = []; let cursor = current; const seen = new Set();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id); ancestors.unshift(cursor); cursor = byId(cursor.fatherId);
    }
    const parentCard = (parentId, role) => {
      const person = byId(parentId);
      if (!person) return '<div class="unknown-card">لم يُسجّل بعد</div>';
      return `<button class="parent-card" data-select-tree="${escapeHtml(person.id)}"><small>${role}</small><strong>${escapeHtml(person.name)}</strong></button>`;
    };
    const kids = childrenOf(current.id);
    host.innerHTML = `<div class="tree-person-card"><span class="person-avatar">${escapeHtml(initials(current.name))}</span><div><strong>${escapeHtml(current.name)}</strong><small>${escapeHtml(current.branch || 'دون فرع محدد')} · ${escapeHtml(current.gender || 'غير محدد')}</small></div></div><div class="tree-columns"><section class="tree-column"><h3><span>↑</span> تسلسل النسب من جهة الأب</h3><div class="tree-lineage">${ancestors.map((p,i) => `<button class="lineage-item ${p.id === current.id ? 'current' : ''}" data-select-tree="${escapeHtml(p.id)}"><span class="lineage-kicker">${i === 0 ? (p.id === current.id ? 'الفرد المختار' : 'الأصل المسجل') : 'ابن'}${i === ancestors.length-1 && p.id !== current.id ? ' · الفرد المختار' : ''}</span>${escapeHtml(p.name)}</button>`).join('')}</div></section><section class="tree-column"><h3><span>◇</span> الوالدان</h3><div class="parent-box">${parentCard(current.fatherId,'الأب')}${parentCard(current.motherId,'الأم')}</div><h3 style="margin-top:18px"><span>↓</span> الأبناء <small style="font-weight:400;color:#a0aaa4">${digits(kids.length)}</small></h3><div class="children-list">${kids.length ? kids.map(child => `<button class="child-item" data-select-tree="${escapeHtml(child.id)}"><span><strong>${escapeHtml(child.name)}</strong><small>${escapeHtml(child.branch || child.gender || '')}</small></span><span>←</span></button>`).join('') : '<div class="tree-empty">لا توجد أبناء مسجلون لهذا الفرد بعد.</div>'}</div></section></div>`;
  }
  function renderAll() {
    renderStats(); renderRecent(); renderPeople(); updatePersonChoices(); renderTree();
    $('today-label').textContent = new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{weekday:'short',day:'numeric',month:'long'}).format(new Date());
  }
  const viewNames = {overview:'الرئيسية',people:'الأفراد',tree:'شجرة العائلة',backup:'النسخ الاحتياطي'};
  function setView(name) {
    if (!viewNames[name]) return;
    document.querySelectorAll('.page-view').forEach(el => el.classList.toggle('active', el.id === `view-${name}`));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.view === name));
    $('crumb-current').textContent = viewNames[name];
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function openModal(person = null) {
    if (!canEdit) return;
    $('person-form').reset(); $('form-error').classList.add('hidden');
    $('person-id').value = person?.id || '';
    $('modal-title').textContent = person ? 'تعديل بيانات الفرد' : 'إضافة فرد جديد';
    $('modal-kicker').textContent = person ? 'تحديث الملف' : 'ملف العائلة';
    $('delete-person').classList.toggle('hidden', !person);
    updatePersonChoices();
    if (person) {
      $('field-name').value = person.name || ''; $('field-gender').value = ['ذكر','أنثى','غير محدد'].includes(person.gender) ? person.gender : 'غير محدد';
      $('field-branch').value = person.branch || ''; $('field-father').value = person.fatherId || ''; $('field-mother').value = person.motherId || '';
      $('field-birth').value = person.birthYear || ''; $('field-residence').value = person.residence || ''; $('field-notes').value = person.notes || '';
    }
    $('person-modal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; $('field-name').focus();
  }
  function closeModal() { $('person-modal').classList.add('hidden'); document.body.style.overflow = ''; }
  function createsCycle(childId, parentId) {
    if (!parentId) return false;
    const stack = [parentId], seen = new Set();
    while (stack.length) {
      const nextId = stack.pop();
      if (!nextId || seen.has(nextId)) continue;
      if (nextId === childId) return true;
      seen.add(nextId); const p = byId(nextId);
      if (p) { if (p.fatherId) stack.push(p.fatherId); if (p.motherId) stack.push(p.motherId); }
    }
    return false;
  }
  $('person-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!canEdit) return;
    const personId = $('person-id').value || makeId();
    const fatherId = $('field-father').value; const motherId = $('field-mother').value;
    let error = '';
    if (!$('field-name').value.trim()) error = 'يرجى كتابة الاسم الكامل.';
    else if (fatherId && fatherId === motherId) error = 'اختر شخصين مختلفين للأب والأم.';
    else if (fatherId === personId || motherId === personId) error = 'لا يمكن ربط الفرد بنفسه كأب أو أم.';
    else if (createsCycle(personId, fatherId) || createsCycle(personId, motherId)) error = 'هذه الصلة ستنشئ حلقة في النسب. اختر أباً أو أماً أخرى.';
    if (error) { $('form-error').textContent = error; $('form-error').classList.remove('hidden'); return; }
    const existing = byId(personId); const now = stamp();
    const record = { id: personId, name: $('field-name').value.trim(), branch: $('field-branch').value.trim(), gender: $('field-gender').value, fatherId, motherId, birthYear: $('field-birth').value.trim(), residence: $('field-residence').value.trim(), notes: $('field-notes').value.trim(), createdAt: existing?.createdAt || now, updatedAt: now };
    if (existing) Object.assign(existing, record); else data.people.push(record);
    closeModal(); if (persist()) showToast(existing ? 'تم تحديث بيانات الفرد.' : 'تمت إضافة الفرد إلى السجل.');
  });
  $('delete-person').addEventListener('click', () => {
    if (!canEdit) return;
    const person = byId($('person-id').value); if (!person) return;
    const dependents = childrenOf(person.id);
    const detail = dependents.length ? ` ستُزال صلة الأبوة أو الأمومة بهذا الفرد من ${dependents.length} من الأبناء.` : '';
    if (!confirm(`هل تريد حذف «${person.name}»؟${detail} لا يمكن التراجع بعد الحفظ.`)) return;
    data.people = data.people.filter(p => p.id !== person.id);
    data.people.forEach(p => { if (p.fatherId === person.id) p.fatherId = ''; if (p.motherId === person.id) p.motherId = ''; });
    closeModal(); if (persist()) showToast('تم حذف الفرد وتحديث صلات القرابة.');
  });
  function downloadBackup() {
    const backup = {...data, exportedAt: stamp()};
    const contents = JSON.stringify(backup, null, 2);
    if (window.SulalahAndroid && typeof window.SulalahAndroid.saveBackup === 'function') {
      const date = new Date().toISOString().slice(0,10);
      window.SulalahAndroid.saveBackup(`سلالة-نسخة-احتياطية-${date}.json`, contents);
      showToast('اختر مكان حفظ النسخة الاحتياطية.');
      return;
    }
    const blob = new Blob([contents], {type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    const date = new Date().toISOString().slice(0,10); a.href = url; a.download = `سلالة-نسخة-احتياطية-${date}.json`; a.click(); URL.revokeObjectURL(url);
    showToast('تم تنزيل النسخة الاحتياطية.');
  }
  function importBackup(file) {
    if (!canEdit) { showToast('هذا الجهاز مخصص للاطلاع فقط.'); return; }
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.people) || parsed.people.some(p => !p || typeof p.id !== 'string' || typeof p.name !== 'string')) throw new Error('invalid');
        if (!confirm(`سيحل هذا الملف محل السجل الحالي (${data.people.length} فرد). يتضمن الملف ${parsed.people.length} فرد. هل تريد المتابعة؟`)) { $('import-file').value = ''; return; }
        data.people = parsed.people.map(p => ({ id:p.id, name:p.name, branch:p.branch || '', gender:p.gender || 'غير محدد', fatherId:p.fatherId || '', motherId:p.motherId || '', birthYear:p.birthYear || '', residence:p.residence || '', notes:p.notes || '', createdAt:p.createdAt || stamp(), updatedAt:p.updatedAt || stamp() }));
        if (persist()) showToast(`تم استيراد ${digits(data.people.length)} فرد.`);
      } catch (error) { showToast('تعذر استيراد الملف. تحقق من أنه نسخة JSON صالحة من سلالة.'); }
      $('import-file').value = '';
    };
    reader.onerror = () => showToast('تعذر قراءة الملف المحدد.');
    reader.readAsText(file, 'UTF-8');
  }

  document.addEventListener('click', event => {
    const view = event.target.closest('[data-view]'); if (view) { setView(view.dataset.view); return; }
    const add = event.target.closest('[data-action="add"]'); if (add) { if (canEdit) openModal(); return; }
    const edit = event.target.closest('[data-edit]'); if (edit) { if (canEdit) openModal(byId(edit.dataset.edit)); return; }
    const person = event.target.closest('[data-open-person]'); if (person) { $('tree-person').value = person.dataset.openPerson; renderTree(); setView('tree'); return; }
    const treePerson = event.target.closest('[data-select-tree]'); if (treePerson) { $('tree-person').value = treePerson.dataset.selectTree; renderTree(); }
  });
  $('modal-close').addEventListener('click', closeModal); $('cancel-modal').addEventListener('click', closeModal);
  $('person-modal').addEventListener('click', event => { if (event.target === $('person-modal')) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('person-modal').classList.contains('hidden')) closeModal(); });
  $('people-search').addEventListener('input', renderPeople); $('gender-filter').addEventListener('change', renderPeople);
  $('home-search').addEventListener('keydown', event => { if (event.key === 'Enter') { $('people-search').value = $('home-search').value; renderPeople(); setView('people'); $('people-search').focus(); } });
  $('tree-person').addEventListener('change', renderTree); $('export-btn').addEventListener('click', downloadBackup);
  $('import-file').addEventListener('change', event => importBackup(event.target.files[0]));
  const drop = $('file-drop');
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.style.background = '#edf5ee'; });
  drop.addEventListener('dragleave', () => { drop.style.background = ''; });
  drop.addEventListener('drop', event => { event.preventDefault(); drop.style.background = ''; const file = [...event.dataTransfer.files].find(f => f.name.toLowerCase().endsWith('.json')); if (file) importBackup(file); else showToast('اختر ملفاً بصيغة JSON.'); });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; $('install-app').textContent = 'تثبيت سلالة الآن';
  });
  $('install-app').addEventListener('click', async () => {
    if (!installPrompt) { $('install-details').open = true; $('install-details').scrollIntoView({behavior:'smooth', block:'nearest'}); return; }
    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === 'accepted') showToast('تم تثبيت سلالة على جهازك.');
    installPrompt = null;
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; $('install-app').textContent = 'تم تثبيت سلالة'; });
  if ('serviceWorker' in navigator && location.protocol === 'https:' && location.hostname !== 'sulalah.local') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.warn('تعذر تفعيل العمل دون اتصال', error)));
  }
  renderAll();
  window.SulalahApp = {
    getSnapshot: () => JSON.parse(JSON.stringify({...data, exportedAt:stamp()})),
    getLocalPeople: () => data.people.map(person => ({...person})),
    hasSavedLocalData: () => hasSavedLocalData,
    replacePeople: people => {
      if (!Array.isArray(people)) return false;
      data.people = people.map(person => ({...person}));
      return persist(true);
    },
    setCanEdit: value => {
      canEdit = Boolean(value) && !FORCE_READ_ONLY;
      document.documentElement.dataset.access = canEdit ? 'editor' : 'viewer';
      window.dispatchEvent(new CustomEvent('sulalah:access-changed', {detail:{canEdit}}));
      return canEdit;
    },
    isForcedReadOnly: FORCE_READ_ONLY,
    canEdit: () => canEdit
  };
})();
