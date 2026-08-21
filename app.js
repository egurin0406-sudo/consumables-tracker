(() => {
  const STORAGE_KEY = 'consumables-v1';

  /** @typedef {{id:string, name:string, cycleDays:number, lastReplacedDate:string, note:string}} Item */

  /** @returns {Item[]} */
  function loadItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveItems(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  let items = loadItems();
  let editingId = null;

  // ---- 日付ユーティリティ ----
  function toDateOnly(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function todayDateOnly() {
    return toDateOnly(new Date());
  }
  function parseISODate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function formatISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function formatDisplayDate(d) {
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  function addDays(d, days) {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + days);
    return nd;
  }
  function diffDays(a, b) {
    return Math.round((toDateOnly(a) - toDateOnly(b)) / 86400000);
  }

  function nextDateOf(item) {
    return addDays(parseISODate(item.lastReplacedDate), item.cycleDays);
  }

  function statusOf(item) {
    const remain = diffDays(nextDateOf(item), todayDateOnly());
    if (remain < 0) return 'overdue';
    if (remain <= 3) return 'soon';
    return 'ok';
  }

  function statusLabel(item) {
    const remain = diffDays(nextDateOf(item), todayDateOnly());
    if (remain < 0) return `期限切れ (${Math.abs(remain)}日超過)`;
    if (remain === 0) return '本日が交換日';
    return `あと${remain}日`;
  }

  // ---- タブ切り替え ----
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'calendar') renderCalendar();
    });
  });

  // ---- 一覧描画 ----
  const listEl = document.getElementById('item-list');
  const emptyStateEl = document.getElementById('empty-state');

  function renderList() {
    const sorted = [...items].sort((a, b) => nextDateOf(a) - nextDateOf(b));
    listEl.innerHTML = '';
    emptyStateEl.classList.toggle('hidden', items.length > 0);

    for (const item of sorted) {
      const status = statusOf(item);
      const li = document.createElement('li');
      li.className = `item-card status-${status}`;

      const main = document.createElement('div');
      main.className = 'item-main';
      main.innerHTML = `
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-sub">${item.cycleDays}日ごと・前回 ${formatDisplayDate(parseISODate(item.lastReplacedDate))}${item.note ? ' ・ ' + escapeHtml(item.note) : ''}</div>
        <div class="item-status">次回 ${formatDisplayDate(nextDateOf(item))}（${statusLabel(item)}）</div>
      `;

      const actions = document.createElement('div');
      actions.className = 'item-actions';

      const replaceBtn = document.createElement('button');
      replaceBtn.className = 'btn-replace';
      replaceBtn.textContent = '交換した';
      replaceBtn.addEventListener('click', () => {
        item.lastReplacedDate = formatISODate(todayDateOnly());
        saveItems(items);
        renderList();
      });

      const editBtn = document.createElement('button');
      editBtn.className = 'btn-edit';
      editBtn.textContent = '編集';
      editBtn.addEventListener('click', () => openModal(item));

      actions.append(replaceBtn, editBtn);
      li.append(main, actions);
      listEl.appendChild(li);
    }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // ---- モーダル(追加・編集) ----
  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const itemForm = document.getElementById('item-form');
  const fName = document.getElementById('f-name');
  const fCycle = document.getElementById('f-cycle');
  const fLastDate = document.getElementById('f-last-date');
  const fNote = document.getElementById('f-note');
  const presetBtns = document.querySelectorAll('.preset-btn');
  const deleteBtn = document.getElementById('btn-delete');

  function openModal(item) {
    editingId = item ? item.id : null;
    modalTitle.textContent = item ? '消耗品を編集' : '消耗品を追加';
    fName.value = item ? item.name : '';
    fCycle.value = item ? item.cycleDays : '';
    fLastDate.value = item ? item.lastReplacedDate : formatISODate(todayDateOnly());
    fNote.value = item ? item.note || '' : '';
    deleteBtn.classList.toggle('hidden', !item);
    presetBtns.forEach(b => b.classList.toggle('selected', item && Number(b.dataset.days) === item.cycleDays));
    modalOverlay.classList.remove('hidden');
    fName.focus();
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    itemForm.reset();
    presetBtns.forEach(b => b.classList.remove('selected'));
    editingId = null;
  }

  document.getElementById('fab-add').addEventListener('click', () => openModal(null));
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      fCycle.value = btn.dataset.days;
    });
  });

  fCycle.addEventListener('input', () => {
    presetBtns.forEach(b => b.classList.toggle('selected', Number(b.dataset.days) === Number(fCycle.value)));
  });

  itemForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const cycleDays = Number(fCycle.value);
    if (!fName.value.trim() || !cycleDays || cycleDays < 1 || !fLastDate.value) return;

    if (editingId) {
      const item = items.find(i => i.id === editingId);
      item.name = fName.value.trim();
      item.cycleDays = cycleDays;
      item.lastReplacedDate = fLastDate.value;
      item.note = fNote.value.trim();
    } else {
      items.push({
        id: crypto.randomUUID(),
        name: fName.value.trim(),
        cycleDays,
        lastReplacedDate: fLastDate.value,
        note: fNote.value.trim(),
      });
    }
    saveItems(items);
    closeModal();
    renderList();
    renderCalendar();
  });

  deleteBtn.addEventListener('click', () => {
    if (!editingId) return;
    if (!confirm('この消耗品を削除しますか？')) return;
    items = items.filter(i => i.id !== editingId);
    saveItems(items);
    closeModal();
    renderList();
    renderCalendar();
  });

  // ---- カレンダー描画 ----
  let calYear = todayDateOnly().getFullYear();
  let calMonth = todayDateOnly().getMonth();
  let selectedDateStr = null;

  const calTitle = document.getElementById('cal-title');
  const calGrid = document.getElementById('calendar-grid');
  const calDetail = document.getElementById('cal-day-detail');

  document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  function itemsDueOn(dateStr) {
    return items.filter(i => formatISODate(nextDateOf(i)) === dateStr);
  }

  function renderCalendar() {
    calTitle.textContent = `${calYear}年${calMonth + 1}月`;
    calGrid.innerHTML = '';

    const firstDay = new Date(calYear, calMonth, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const todayStr = formatISODate(todayDateOnly());

    for (let i = 0; i < startWeekday; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-cell empty';
      calGrid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = formatISODate(new Date(calYear, calMonth, day));
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      if (dateStr === todayStr) cell.classList.add('today');
      if (dateStr === selectedDateStr) cell.classList.add('selected');

      const dueItems = itemsDueOn(dateStr);
      cell.innerHTML = `<span>${day}</span>`;
      if (dueItems.length > 0) {
        const dot = document.createElement('div');
        dot.className = 'cal-dot';
        cell.appendChild(dot);
      }

      cell.addEventListener('click', () => {
        selectedDateStr = dateStr;
        renderCalendar();
        showDayDetail(dateStr);
      });

      calGrid.appendChild(cell);
    }

    if (selectedDateStr) showDayDetail(selectedDateStr);
  }

  function showDayDetail(dateStr) {
    const dueItems = itemsDueOn(dateStr);
    const d = parseISODate(dateStr);
    if (dueItems.length === 0) {
      calDetail.classList.add('hidden');
      return;
    }
    calDetail.classList.remove('hidden');
    calDetail.innerHTML = `
      <h3>${formatDisplayDate(d)}の交換予定</h3>
      <ul>${dueItems.map(i => `<li>${escapeHtml(i.name)}</li>`).join('')}</ul>
    `;
  }

  // ---- Service Worker登録 ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }

  renderList();
})();
