(() => {
  const FIREBASE_CONFIG = {
    projectId: 'consumables-tracker-18580',
    appId: '1:472484220221:web:4e6c8a89618cc0dc0e8954',
    storageBucket: 'consumables-tracker-18580.firebasestorage.app',
    apiKey: 'AIzaSyBwV7QyoljasWRQ9y8SMogLLUAbkEKIzhs',
    authDomain: 'consumables-tracker-18580.firebaseapp.com',
    messagingSenderId: '472484220221',
  };
  const HOUSEHOLD_KEY = 'household-code-v1';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  /** @typedef {{id:string, name:string, note:string, records:string[]}} Item */

  let items = [];
  let editingId = null;
  let modalRecords = [];
  let householdCode = localStorage.getItem(HOUSEHOLD_KEY);
  let db = null;
  let unsubscribeItems = null;

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

  // ---- 記録から統計を計算 ----
  function computeStats(records) {
    if (!records || records.length === 0) {
      return { lastDate: null, avgCycle: null, nextDate: null };
    }
    const sorted = [...records].sort();
    const lastDateStr = sorted[sorted.length - 1];
    if (sorted.length < 2) {
      return { lastDate: lastDateStr, avgCycle: null, nextDate: null };
    }
    let total = 0;
    for (let i = 1; i < sorted.length; i++) {
      total += diffDays(parseISODate(sorted[i]), parseISODate(sorted[i - 1]));
    }
    const avgCycle = Math.max(1, Math.round(total / (sorted.length - 1)));
    const nextDate = addDays(parseISODate(lastDateStr), avgCycle);
    return { lastDate: lastDateStr, avgCycle, nextDate };
  }

  function statusOf(stats) {
    if (!stats.nextDate) return 'unknown';
    const remain = diffDays(stats.nextDate, todayDateOnly());
    if (remain < 0) return 'overdue';
    if (remain <= 3) return 'soon';
    return 'ok';
  }

  function statusLabel(stats) {
    if (!stats.nextDate) {
      return stats.lastDate ? '記録を増やすと次回予測が表示されます' : '記録がありません';
    }
    const remain = diffDays(stats.nextDate, todayDateOnly());
    if (remain < 0) return `目安を${Math.abs(remain)}日超過`;
    if (remain === 0) return '本日が目安日';
    return `あと${remain}日`;
  }

  function recordsSummary(stats, count) {
    let s = `記録${count}件`;
    if (stats.avgCycle) s += `・平均${stats.avgCycle}日ごと`;
    return s;
  }

  // ---- 共有コード(Firestore同期) ----
  const setupOverlay = document.getElementById('setup-overlay');
  const btnCreateCode = document.getElementById('btn-create-code');
  const joinCodeForm = document.getElementById('join-code-form');
  const fJoinCode = document.getElementById('f-join-code');
  const householdBadge = document.getElementById('btn-household');
  const householdOverlay = document.getElementById('household-overlay');
  const householdCodeDisplay = document.getElementById('household-code-display');
  const btnCloseHousehold = document.getElementById('btn-close-household');
  const btnChangeCode = document.getElementById('btn-change-code');

  function generateCode(len = 6) {
    let s = '';
    for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  function normalizeCode(v) {
    return v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function startWithCode(code) {
    householdCode = code;
    localStorage.setItem(HOUSEHOLD_KEY, code);
    setupOverlay.classList.add('hidden');
    householdBadge.classList.remove('hidden');
    householdBadge.textContent = `コード: ${code}`;
    initFirestore();
  }

  btnCreateCode.addEventListener('click', () => {
    startWithCode(generateCode());
  });

  joinCodeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normalizeCode(fJoinCode.value);
    if (!code) return;
    startWithCode(code);
  });

  householdBadge.addEventListener('click', () => {
    householdCodeDisplay.textContent = householdCode;
    householdOverlay.classList.remove('hidden');
  });

  btnCloseHousehold.addEventListener('click', () => {
    householdOverlay.classList.add('hidden');
  });

  btnChangeCode.addEventListener('click', () => {
    if (!confirm('コードを変更すると、今表示しているデータは見えなくなります。よろしいですか？')) return;
    localStorage.removeItem(HOUSEHOLD_KEY);
    location.reload();
  });

  function itemsCollection() {
    return db.collection('households').doc(householdCode).collection('items');
  }

  function initFirestore() {
    if (!db) {
      firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    }
    subscribeItems();
  }

  function subscribeItems() {
    if (unsubscribeItems) unsubscribeItems();
    unsubscribeItems = itemsCollection().onSnapshot(
      (snap) => {
        items = snap.docs.map((d) => {
          const data = d.data();
          return { id: d.id, name: data.name || '', note: data.note || '', records: data.records || [] };
        });
        renderList();
        if (document.getElementById('tab-calendar').classList.contains('active')) renderCalendar();
      },
      (err) => {
        console.error(err);
        showToast('同期エラーが発生しました');
      }
    );
  }

  function persistItem(item) {
    return itemsCollection().doc(item.id).set({ name: item.name, note: item.note, records: item.records });
  }

  function removeItemRemote(id) {
    return itemsCollection().doc(id).delete();
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
    const withStats = items.map(item => ({ item, stats: computeStats(item.records) }));
    withStats.sort((a, b) => {
      const an = a.stats.nextDate ? a.stats.nextDate.getTime() : Infinity;
      const bn = b.stats.nextDate ? b.stats.nextDate.getTime() : Infinity;
      if (an !== bn) return an - bn;
      const al = a.stats.lastDate ?? '';
      const bl = b.stats.lastDate ?? '';
      return bl.localeCompare(al);
    });

    listEl.innerHTML = '';
    emptyStateEl.classList.toggle('hidden', items.length > 0);

    for (const { item, stats } of withStats) {
      const status = statusOf(stats);
      const li = document.createElement('li');
      li.className = `item-card status-${status}`;

      const main = document.createElement('div');
      main.className = 'item-main';
      main.innerHTML = `
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-sub">${recordsSummary(stats, item.records.length)}${item.note ? ' ・ ' + escapeHtml(item.note) : ''}</div>
        <div class="item-status">${stats.nextDate ? '次回目安 ' + formatDisplayDate(stats.nextDate) + '（' + statusLabel(stats) + '）' : statusLabel(stats)}</div>
      `;

      const actions = document.createElement('div');
      actions.className = 'item-actions';

      const recordBtn = document.createElement('button');
      recordBtn.type = 'button';
      recordBtn.className = 'btn-replace';
      recordBtn.textContent = '今日を記録';
      recordBtn.addEventListener('click', () => {
        recordDate(item, formatISODate(todayDateOnly()));
      });

      const datePickWrapper = document.createElement('label');
      datePickWrapper.className = 'date-pick-wrapper';
      datePickWrapper.title = '日付を指定して記録';
      datePickWrapper.setAttribute('aria-label', '日付を指定して記録');
      datePickWrapper.textContent = '📅';
      const datePickInput = document.createElement('input');
      datePickInput.type = 'date';
      datePickInput.max = formatISODate(todayDateOnly());
      datePickInput.addEventListener('change', () => {
        if (!datePickInput.value) return;
        recordDate(item, datePickInput.value);
        datePickInput.value = '';
      });
      datePickWrapper.appendChild(datePickInput);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-edit';
      editBtn.textContent = '編集';
      editBtn.addEventListener('click', () => openModal(item));

      actions.append(recordBtn, datePickWrapper, editBtn);
      li.append(main, actions);
      listEl.appendChild(li);
    }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // ---- トースト通知 ----
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  function recordDate(item, dateStr) {
    if (item.records.includes(dateStr)) {
      showToast(`${formatDisplayDate(parseISODate(dateStr))}はすでに記録済みです`);
      return;
    }
    const updated = { ...item, records: [...item.records, dateStr] };
    persistItem(updated)
      .then(() => showToast(`${formatDisplayDate(parseISODate(dateStr))}を記録しました`))
      .catch(() => showToast('保存に失敗しました'));
  }

  // ---- モーダル(追加・編集) ----
  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const itemForm = document.getElementById('item-form');
  const fName = document.getElementById('f-name');
  const fNote = document.getElementById('f-note');
  const recordsListEl = document.getElementById('records-list');
  const fNewRecordDate = document.getElementById('f-new-record-date');
  const btnAddRecord = document.getElementById('btn-add-record');
  const deleteBtn = document.getElementById('btn-delete');

  function renderModalRecords() {
    recordsListEl.innerHTML = '';
    const sorted = [...modalRecords].sort().reverse();
    if (sorted.length === 0) {
      const li = document.createElement('li');
      li.className = 'records-empty';
      li.textContent = '記録がありません';
      recordsListEl.appendChild(li);
      return;
    }
    for (const dateStr of sorted) {
      const li = document.createElement('li');
      li.className = 'record-row';
      const span = document.createElement('span');
      span.textContent = formatDisplayDate(parseISODate(dateStr));
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'record-del';
      delBtn.textContent = '×';
      delBtn.setAttribute('aria-label', `${span.textContent}の記録を削除`);
      delBtn.addEventListener('click', () => {
        modalRecords = modalRecords.filter(d => d !== dateStr);
        renderModalRecords();
      });
      li.append(span, delBtn);
      recordsListEl.appendChild(li);
    }
  }

  function openModal(item) {
    editingId = item ? item.id : null;
    modalTitle.textContent = item ? '消耗品を編集' : '消耗品を追加';
    fName.value = item ? item.name : '';
    fNote.value = item ? item.note || '' : '';
    modalRecords = item ? [...item.records] : [formatISODate(todayDateOnly())];
    fNewRecordDate.value = formatISODate(todayDateOnly());
    deleteBtn.classList.toggle('hidden', !item);
    renderModalRecords();
    modalOverlay.classList.remove('hidden');
    fName.focus();
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    itemForm.reset();
    modalRecords = [];
    editingId = null;
  }

  document.getElementById('fab-add').addEventListener('click', () => openModal(null));
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  btnAddRecord.addEventListener('click', () => {
    const val = fNewRecordDate.value || formatISODate(todayDateOnly());
    if (!modalRecords.includes(val)) {
      modalRecords.push(val);
      renderModalRecords();
    }
  });

  itemForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!fName.value.trim()) return;

    const item = {
      id: editingId || crypto.randomUUID(),
      name: fName.value.trim(),
      note: fNote.value.trim(),
      records: [...modalRecords],
    };
    persistItem(item).catch(() => showToast('保存に失敗しました'));
    closeModal();
  });

  deleteBtn.addEventListener('click', () => {
    if (!editingId) return;
    if (!confirm('この消耗品を削除しますか？')) return;
    removeItemRemote(editingId).catch(() => showToast('削除に失敗しました'));
    closeModal();
  });

  // ---- カレンダー描画 ----
  let calYear = todayDateOnly().getFullYear();
  let calMonth = todayDateOnly().getMonth();
  let selectedDateStr = null;
  let calPredictedIndex = {};
  let calRecordedIndex = {};

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

  function buildCalendarIndex() {
    const predicted = {};
    const recorded = {};
    for (const item of items) {
      const stats = computeStats(item.records);
      if (stats.nextDate) {
        const key = formatISODate(stats.nextDate);
        (predicted[key] ??= []).push(item);
      }
      for (const r of item.records) {
        (recorded[r] ??= []).push(item);
      }
    }
    return { predicted, recorded };
  }

  function renderCalendar() {
    calTitle.textContent = `${calYear}年${calMonth + 1}月`;
    calGrid.innerHTML = '';

    const { predicted, recorded } = buildCalendarIndex();
    calPredictedIndex = predicted;
    calRecordedIndex = recorded;

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

      cell.innerHTML = `<span>${day}</span>`;
      if (predicted[dateStr]) {
        const dot = document.createElement('div');
        dot.className = 'cal-dot cal-dot-predicted';
        cell.appendChild(dot);
      }
      if (recorded[dateStr]) {
        const dot = document.createElement('div');
        dot.className = 'cal-dot cal-dot-history';
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
    const predictedItems = calPredictedIndex[dateStr] || [];
    const recordedItems = calRecordedIndex[dateStr] || [];
    if (predictedItems.length === 0 && recordedItems.length === 0) {
      calDetail.classList.add('hidden');
      return;
    }
    calDetail.classList.remove('hidden');
    const d = parseISODate(dateStr);
    let html = `<h3>${formatDisplayDate(d)}</h3>`;
    if (predictedItems.length > 0) {
      html += `<p class="cal-detail-label">次回目安</p><ul>${predictedItems.map(i => `<li>${escapeHtml(i.name)}</li>`).join('')}</ul>`;
    }
    if (recordedItems.length > 0) {
      html += `<p class="cal-detail-label">この日に記録</p><ul>${recordedItems.map(i => `<li>${escapeHtml(i.name)}</li>`).join('')}</ul>`;
    }
    calDetail.innerHTML = html;
  }

  // ---- Service Worker登録 ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }

  // ---- 初期化 ----
  if (householdCode) {
    setupOverlay.classList.add('hidden');
    householdBadge.classList.remove('hidden');
    householdBadge.textContent = `コード: ${householdCode}`;
    initFirestore();
  }
  renderList();
})();
