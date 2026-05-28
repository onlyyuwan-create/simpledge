// ========== 记账本 v2.0 — 主应用逻辑（含资产账户） ==========

const APP_VERSION = 'v2.0 (2026.05) · 度支简账 Simpledge';

let currentUser = { name: '我', avatar: '👤' };
let currentTab = 'home';
let currentTxType = 'expense';
let selectedCategoryId = null;
let selectedAccountId = null;
let editingTransactionId = null;
let currentStatYear, currentStatMonth;
let currentStatView = 'expense';
let currentStatChart = 'pie';
let currentFilterType = 'all';
let currentAccountType = 'cash';
let expenseChart = null;
let trendChart = null;

// ========== 初始化 ==========
async function initApp() {
  await initDB();

  const savedName = await getSetting('userName', '我');
  currentUser.name = savedName;

  const now = new Date();
  currentStatYear = now.getFullYear();
  currentStatMonth = now.getMonth() + 1;

  registerEvents();
  await showHome();

  // 加载暗色主题状态
  const dark = await getSetting('darkMode', '0');
  if (dark === '1') {
    isDark = true;
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('dark-mode-icon').textContent = '☀️';
    document.getElementById('dark-mode-desc').textContent = '已开启夜间模式';
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      // 检测到新 SW 等待激活
      if (reg.waiting) {
        console.log('新版本等待激活');
      }
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('📦 新版本已下载，关闭重开即可更新');
          }
        });
      });
    }).catch(() => {});

    // 监听来自 SW 的消息
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data && event.data.type === 'NEW_VERSION_ACTIVATED') {
        showToast('🔄 新版本已激活');
      }
    });
  }
}

// ========== Tab 切换（带错误保护）==========
async function switchTab(tab) {
  try {
    currentTab = tab;
    document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('active'));
    const tabEl = document.querySelector(`.tab-item[data-tab="${tab}"]`);
    if (tabEl) tabEl.classList.add('active');

    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    const pageEl = document.getElementById(`page-${tab}`);
    if (pageEl) pageEl.classList.add('active');

    const titles = { home: '度支简账', bills: '账单', assets: '资产', stats: '统计', settings: '设置' };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[tab] || '记账本';

    if (tab === 'home') await showHome();
    else if (tab === 'bills') await showBills();
    else if (tab === 'assets') await showAssets();
    else if (tab === 'stats') await showStats();
    else if (tab === 'settings') showSettings();
  } catch (e) {
    console.error('switchTab error:', e);
    showToast('页面加载异常，请刷新重试');
  }
}

// ========== 首页 ==========
async function showHome() {
  const now = new Date();
  const today = formatDate(now);

  const todayTxs = await getTransactions({ startDate: today, endDate: today });
  let todayExpense = 0, todayIncome = 0;
  todayTxs.forEach(tx => {
    if (tx.type === 'expense') todayExpense += tx.amount;
    else todayIncome += tx.amount;
  });

  const todayBalance = todayIncome - todayExpense;
  document.getElementById('today-expense').textContent = todayExpense.toFixed(2);
  document.getElementById('today-income').textContent = todayIncome.toFixed(2);
  document.getElementById('today-balance').textContent = todayBalance.toFixed(2);

  const monthStats = await getMonthStats(now.getFullYear(), now.getMonth() + 1);
  document.getElementById('month-expense').textContent = monthStats.totalExpense.toFixed(2);
  document.getElementById('month-income').textContent = monthStats.totalIncome.toFixed(2);
  document.getElementById('month-count').textContent = monthStats.count;

  const recentTxs = await getTransactions({});
  renderTransactionList('recent-tx-list', recentTxs.slice(0, 5), true);
}

// ========== 资产页面 ==========
async function showAssets() {
  const accounts = await getAllAccounts();
  const grid = document.getElementById('account-grid');

  // 计算总资产
  let totalAssets = 0;
  accounts.forEach(a => { totalAssets += a.balance; });

  document.getElementById('total-assets-amount').textContent =
    totalAssets.toFixed(2);
  document.getElementById('total-assets-sub').textContent =
    `共 ${accounts.length} 个账户 · 点击查看流水`;

  if (accounts.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">🏦</div>
      <div class="empty-text">还没有账户，点击下方添加</div>
    </div>`;
    return;
  }

  const typeNames = { cash: '现金', debit: '借记卡', credit: '信用卡', digital: '电子账户', prepaid: '储值卡', investment: '投资' };

  let html = '';
  accounts.forEach(acc => {
    const isNegative = acc.balance < 0;
    html += `
      <div class="account-card" onclick="showAccountFlow('${acc.id}')">
        <div class="acc-header">
          <div class="acc-icon">${acc.icon}</div>
          <div>
            <div class="acc-name">${acc.name}</div>
            <span class="acc-type-tag">${typeNames[acc.type] || acc.type}</span>
          </div>
        </div>
        <div class="acc-balance ${isNegative ? 'negative' : ''}">
          ${acc.balance.toFixed(2)}
        </div>
      </div>
    `;
  });

  grid.innerHTML = html;

  // 债务概览
  renderDebtSummary();
  renderReimbursements();
}

// ========== 账户流水 ==========
async function showAccountFlow(accountId) {
  const account = await getAccount(accountId);
  if (!account) return;

  document.getElementById('flow-modal-title').textContent =
    `${account.icon} ${account.name} · 流水`;

  const txs = await getTransactionsByAccount(accountId, 100);

  const cats = await getAllCategories();
  const catMap = {};
  cats.forEach(c => { catMap[c.id] = c; });

  const container = document.getElementById('flow-tx-list');

  if (txs.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">该账户暂无交易记录</div>
    </div>`;
  } else {
    // 按日期分组
    const groups = {};
    txs.forEach(tx => {
      if (!groups[tx.date]) groups[tx.date] = [];
      groups[tx.date].push(tx);
    });

    let html = '';
    Object.keys(groups).forEach(date => {
      const weekDay = getWeekDay(date);
      html += `<div class="date-group-header">${date} ${weekDay}</div>`;
      groups[date].forEach(tx => {
        const cat = catMap[tx.categoryId] || { name: tx.categoryId, icon: '📄' };
        const typeClass = tx.type === 'expense' ? 'expense' : 'income';
        const sign = tx.type === 'expense' ? '-' : '+';
        html += `
          <div class="transaction-item" onclick="openEditTransaction('${tx.id}')">
            <div class="tx-cat-icon ${typeClass}">${cat.icon}</div>
            <div class="tx-info">
              <div class="tx-cat-name">${cat.name}</div>
              <div class="tx-note">${tx.note || '无备注'}</div>
            </div>
            <div style="text-align:right">
              <div class="tx-amount ${typeClass}">${sign}${tx.amount.toFixed(2)}</div>
              <div class="tx-time">${tx.date.slice(8)}</div>
            </div>
          </div>
        `;
      });
    });
    container.innerHTML = html;
  }

  document.getElementById('account-flow-modal').classList.add('open');
}

// ========== 添加账户 ==========
function openAddAccountModal() {
  currentAccountType = 'cash';
  document.getElementById('new-acc-name').value = '';
  document.getElementById('new-acc-balance').value = '';
  document.getElementById('new-acc-icon').value = '🏦';

  // 重置类型选择
  document.querySelectorAll('.acc-type-item').forEach(el => el.classList.remove('selected'));
  document.querySelector('.acc-type-item[data-acc-type="cash"]').classList.add('selected');

  document.getElementById('add-account-modal').classList.add('open');
}

function selectAccType(type) {
  currentAccountType = type;
  document.querySelectorAll('.acc-type-item').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.acc-type-item[data-acc-type="${type}"]`).classList.add('selected');

  // 根据类型推荐图标
  const icons = { cash: '💵', debit: '🏦', credit: '💳', digital: '📱' };
  document.getElementById('new-acc-icon').value = icons[type] || '🏦';
}

async function saveNewAccount() {
  const name = document.getElementById('new-acc-name').value.trim();
  const balanceStr = document.getElementById('new-acc-balance').value.trim();
  const icon = document.getElementById('new-acc-icon').value.trim() || '🏦';

  if (!name) { showToast('请输入账户名称'); return; }

  const balance = parseFloat(balanceStr) || 0;

  await addAccount({
    name,
    icon,
    type: currentAccountType,
    balance: Math.round(balance * 100) / 100,
    sortOrder: 99
  });

  showToast('账户已添加');
  closeModal();
  if (currentTab === 'assets') await showAssets();
  else if (currentTab === 'home') await showHome();
}

// ========== 账单页面 ==========
async function showBills() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  document.getElementById('bills-month-label').textContent = `${year}年${month}月`;
  await loadBillsData(year, month);
}

async function loadBillsData(year, month) {
  let txs = await getTransactionsByMonth(year, month);
  if (currentFilterType !== 'all') {
    txs = txs.filter(t => t.type === currentFilterType);
  }
  txs.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  renderTransactionList('bills-tx-list', txs, false);
}

// ========== 交易列表渲染 ==========
async function renderTransactionList(containerId, txs, showDateGroup) {
  const container = document.getElementById(containerId);
  const cats = await getAllCategories();
  const catMap = {};
  cats.forEach(c => { catMap[c.id] = c; });

  const accounts = await getAllAccounts();
  const accMap = {};
  accounts.forEach(a => { accMap[a.id] = a; });

  if (txs.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">暂无记录</div>
    </div>`;
    return;
  }

  let html = '';
  if (showDateGroup) {
    const groups = {};
    txs.forEach(tx => {
      if (!groups[tx.date]) groups[tx.date] = [];
      groups[tx.date].push(tx);
    });
    Object.keys(groups).forEach(date => {
      const weekDay = getWeekDay(date);
      html += `<div class="date-group-header">${date} ${weekDay}</div>`;
      groups[date].forEach(tx => {
        html += renderTxItem(tx, catMap, accMap);
      });
    });
  } else {
    txs.forEach(tx => { html += renderTxItem(tx, catMap, accMap); });
  }
  container.innerHTML = html;
}

function renderTxItem(tx, catMap, accMap) {
  const cat = catMap[tx.categoryId] || { name: '其他', icon: '📄' };
  const acc = accMap[tx.accountId] || null;
  const sign = tx.type === 'expense' ? '-' : (tx.type === 'transfer' ? '-' : '+');
  const typeClass = tx.type === 'expense' ? 'expense' : (tx.type === 'transfer' ? 'expense' : 'income');

  // 转账特殊显示
  if (tx.type === 'transfer') {
    const toAcc = tx.toAccountId ? accMap[tx.toAccountId] : null;
    return `\n    <div class="transaction-item" onclick="openEditTransaction('${tx.id}')">\n      <div class="tx-cat-icon" style="background:#E8F0FE">🔄</div>\n      <div class="tx-info">\n        <div class="tx-cat-name">转账</div>\n        <div class="tx-note">${acc ? acc.name : ''} → ${toAcc ? toAcc.name : ''}</div>\n      </div>\n      <div style="text-align:right">\n        <div class="tx-amount expense">${sign}${tx.amount.toFixed(2)}</div>\n        <div class="tx-time">${tx.date.slice(8)}</div>\n      </div>\n    </div>\n  `;
  }

  return `\n    <div class="transaction-item" onclick="openEditTransaction('${tx.id}')">\n      <div class="tx-cat-icon ${typeClass}">${cat.icon}</div>\n      <div class="tx-info">\n        <div class="tx-cat-name">${cat.name}</div>\n        <div class="tx-note">${tx.note || ''}</div>\n        <div class="tx-account-tag">${acc ? acc.icon + ' ' + acc.name : ''}</div>\n      </div>\n      <div style="text-align:right">\n        <div class="tx-amount ${typeClass}">${sign}${tx.amount.toFixed(2)}</div>\n        <div class="tx-time">${tx.date.slice(8)}</div>\n      </div>\n    </div>\n  `;
}

// ========== 统计页面 ==========
async function showStats() {
  document.getElementById('stat-month-label').textContent = `${currentStatYear}年${currentStatMonth}月`;
  await loadStatsData();
  await renderBudget();
}

async function loadStatsData() {
  const stats = await getMonthStats(currentStatYear, currentStatMonth);
  document.getElementById('stat-total-expense').textContent = stats.totalExpense.toFixed(2);
  document.getElementById('stat-total-income').textContent = stats.totalIncome.toFixed(2);
  document.getElementById('stat-balance').textContent = stats.balance.toFixed(2);

  await renderCategoryBreakdown(stats);

  if (currentStatChart === 'pie') {
    await renderPieChart(stats, currentStatView);
    document.getElementById('trend-chart-container').style.display = 'none';
    document.getElementById('pie-chart-container').style.display = 'block';
  } else {
    await renderTrendChart();
    document.getElementById('pie-chart-container').style.display = 'none';
    document.getElementById('trend-chart-container').style.display = 'block';
  }
}

async function renderCategoryBreakdown(stats) {
  const container = document.getElementById('cat-breakdown');
  const cats = await getAllCategories(currentStatView);
  const catAmounts = currentStatView === 'expense' ? stats.expenseByCategory : stats.incomeByCategory;
  const total = currentStatView === 'expense' ? stats.totalExpense : stats.totalIncome;

  if (total === 0 || Object.keys(catAmounts).length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-text">暂无数据</div></div>`;
    return;
  }

  const sorted = Object.entries(catAmounts).sort((a, b) => b[1] - a[1]);
  let html = '';
  sorted.forEach(([catId, amount]) => {
    const cat = cats.find(c => c.id === catId);
    const pct = ((amount / total) * 100).toFixed(1);
    html += `
      <div class="cat-breakdown-item">
        <div class="cat-icon">${cat ? cat.icon : '📄'}</div>
        <span class="cat-name">${cat ? cat.name : catId}</span>
        <span class="cat-amount">${amount.toFixed(2)}</span>
        <span class="cat-pct">${pct}%</span>
      </div>
    `;
  });
  container.innerHTML = html;
}

async function renderPieChart(stats, type) {
  const canvas = document.getElementById('expense-chart');
  const ctx = canvas.getContext('2d');
  if (expenseChart) { expenseChart.destroy(); }

  const catAmounts = type === 'expense' ? stats.expenseByCategory : stats.incomeByCategory;
  const total = type === 'expense' ? stats.totalExpense : stats.totalIncome;
  if (total === 0 || Object.keys(catAmounts).length === 0) return;

  const cats = await getAllCategories(type);
  const catMap = {};
  cats.forEach(c => { catMap[c.id] = c; });

  const sorted = Object.entries(catAmounts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([id]) => catMap[id] ? catMap[id].name : id);
  const data = sorted.map(([, v]) => v);
  const iconLabels = sorted.map(([id]) => catMap[id] ? catMap[id].icon : '📄');
  const colors = ['#4A90D9','#FF6B6B','#2ECC71','#F39C12','#9B59B6','#1ABC9C','#E74C3C','#3498DB','#E67E22','#2C3E50','#95A5A6','#16A085','#27AE60','#8E44AD'];

  expenseChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.map((l, i) => iconLabels[i] + ' ' + l),
      datasets: [{ data, backgroundColor: colors.slice(0, data.length), borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, font: { size: 12 }, usePointStyle: true } },
        tooltip: { callbacks: { label: function(ctx) {
          const pct = ((ctx.parsed / total) * 100).toFixed(1);
          return '¥' + ctx.parsed.toFixed(2) + ' (' + pct + '%)';
        }}}
      },
      cutout: '60%'
    }
  });
}

async function renderTrendChart() {
  const canvas = document.getElementById('trend-chart');
  const ctx = canvas.getContext('2d');
  if (trendChart) { trendChart.destroy(); }

  const daily = await getDailyStats(currentStatYear, currentStatMonth);
  const days = Object.keys(daily).sort();
  const dayLabels = days.map(d => parseInt(d.slice(8)) + '日');
  const expenseData = days.map(d => daily[d].expense);
  const incomeData = days.map(d => daily[d].income);

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dayLabels,
      datasets: [
        { label: '支出', data: expenseData, borderColor: '#FF6B6B', backgroundColor: 'rgba(255,107,107,0.1)', fill: true, tension: 0.3, pointRadius: 3, pointHitRadius: 10, borderWidth: 2 },
        { label: '收入', data: incomeData, borderColor: '#2ECC71', backgroundColor: 'rgba(46,204,113,0.1)', fill: true, tension: 0.3, pointRadius: 3, pointHitRadius: 10, borderWidth: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { position: 'top', labels: { font: { size: 12 }, usePointStyle: true, padding: 12 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 15 } },
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.06)' }, ticks: { font: { size: 10 }, callback: v => '¥' + v } }
      }
    }
  });
}

function statPrevMonth() {
  currentStatMonth--;
  if (currentStatMonth < 1) { currentStatMonth = 12; currentStatYear--; }
  showStats();
}

function statNextMonth() {
  const now = new Date();
  if (currentStatYear >= now.getFullYear() && currentStatMonth >= now.getMonth() + 1) return;
  currentStatMonth++;
  if (currentStatMonth > 12) { currentStatMonth = 1; currentStatYear++; }
  showStats();
}

// ========== 设置页面 ==========
function showSettings() {
  const aboutEl = document.getElementById('about-version');
  if (aboutEl) aboutEl.textContent = `度支简账 ${APP_VERSION} · 数据仅存本地`;
  const iconEl = document.getElementById('dark-mode-icon');
  const descEl = document.getElementById('dark-mode-desc');
  if (iconEl) iconEl.textContent = isDark ? '☀️' : '🌙';
  if (descEl) descEl.textContent = isDark ? '已开启夜间模式' : '点击切换夜间模式';
}

// 检查更新（刷新页面）
function checkForUpdate() {
  // 检查 Service Worker 是否有更新
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CHECK_UPDATE' });
  }
  // 尝试从网络获取最新 index.html 对比
  fetch('./index.html?' + Date.now(), { cache: 'no-store' })
    .then(r => r.text())
    .then(html => {
      showToast('已检查更新，刷新页面以应用');
    })
    .catch(() => {
      showToast('离线模式，连接网络后可检查更新');
    });
}

// ========== 搜索 ==========
let searchTimer = null;
function doSearch(query) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    if (!query || query.trim() === '') {
      await showBills();
      return;
    }
    const results = await searchTransactions(query);
    const cats = await getAllCategories();
    const catMap = {};
    cats.forEach(c => { catMap[c.id] = c; });
    const accounts = await getAllAccounts();
    const accMap = {};
    accounts.forEach(a => { accMap[a.id] = a; });

    const container = document.getElementById('bills-tx-list');
    if (results.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">没有找到匹配的记录</div></div>`;
      return;
    }
    let html = `<div class="date-group-header">找到 ${results.length} 条结果</div>`;
    results.slice(0, 50).forEach(tx => {
      html += renderTxItem(tx, catMap, accMap);
    });
    container.innerHTML = html;
  }, 300);
}

// ========== 记一笔（打开模态框）==========
async function openAddTransaction() {
  editingTransactionId = null;
  currentTxType = 'expense';
  selectedCategoryId = null;
  selectedAccountId = null;
  document.getElementById('tx-modal-title').textContent = '记一笔';
  document.getElementById('tx-delete-btn').style.display = 'none';

  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-note').value = '';
  document.getElementById('tx-date').value = formatDate(new Date());

  await setTxType('expense');
  await loadAccountSelector(null);

  document.getElementById('tx-modal').classList.add('open');
}

// 编辑交易
async function openEditTransaction(id) {
  const tx = await getTransaction(parseInt(id));
  if (!tx) return;

  editingTransactionId = tx.id;
  currentTxType = tx.type;
  selectedCategoryId = tx.categoryId;
  selectedAccountId = tx.accountId || 'cash';
  document.getElementById('tx-modal-title').textContent = '编辑记录';
  document.getElementById('tx-delete-btn').style.display = 'block';

  document.getElementById('tx-amount').value = tx.amount;
  document.getElementById('tx-note').value = tx.note || '';
  document.getElementById('tx-date').value = tx.date;

  setTxType(tx.type);
  highlightCategory(tx.categoryId);
  loadAccountSelector(tx.accountId || 'cash');

  document.getElementById('tx-modal').classList.add('open');
}

// 设置交易类型
async function setTxType(type) {
  try {
    currentTxType = type;
    const btns = document.querySelectorAll('.type-btn');
    btns.forEach(b => b.className = 'type-btn');
    if (type === 'expense') { btns[0].classList.add('active-expense'); }
    else if (type === 'income') { btns[1].classList.add('active-income'); }
    else { btns[2].classList.add('active-transfer'); }

    const catSection = document.getElementById('category-section');
    const transferSection = document.getElementById('transfer-section');
    const accountSection = document.getElementById('account-select-section');
    if (type === 'transfer') {
      if (catSection) catSection.style.display = 'none';
      if (transferSection) transferSection.style.display = 'block';
      if (accountSection) accountSection.style.display = 'none';
      selectedCategoryId = 'transfer';
      await loadTransferAccounts();
    } else {
      if (catSection) catSection.style.display = 'block';
      if (transferSection) transferSection.style.display = 'none';
      if (accountSection) accountSection.style.display = 'block';
      if (type === 'expense') selectedCategoryId = null;
      await loadCategories(type);
    }
  } catch(e) {
    console.error('setTxType error:', e);
  }
}

// 加载分类（平铺显示，父分类+子分类一起展示）
async function loadCategories(type) {
  const grid = document.getElementById('category-grid');
  const allCats = await getAllCategories(type);
  let html = '';
  allCats.forEach(cat => {
    const sel = cat.id === selectedCategoryId ? 'selected' : '';
    html += `<div class="cat-item ${sel}" data-cat-id="${cat.id}" onclick="pickCategory('${cat.id}')">
      <span class="cat-icon">${cat.icon}</span>
      <span class="cat-name">${cat.name}</span>
    </div>`;
  });
  grid.innerHTML = html;
}

// 选择分类
function pickCategory(id) {
  selectedCategoryId = id;
  document.querySelectorAll('.cat-item').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(`.cat-item[data-cat-id="${id}"]`);
  if (el) el.classList.add('selected');
}

// 兼容旧调用
function doSelectCategory(id) { pickCategory(id); }
function toggleSubCats(id) { pickCategory(id); }

// 加载转账账户选择器
async function loadTransferAccounts() {
  const fromContainer = document.getElementById('transfer-from');
  const toContainer = document.getElementById('transfer-to');
  const accounts = await getAllAccounts();
  if (accounts.length < 2) { showToast('需要至少2个账户才能转账'); return; }

  const renderOpts = (container, selectedId, onChange) => {
    let html = '';
    accounts.forEach(acc => {
      const sel = acc.id === selectedId ? 'selected' : '';
      html += '<div class="account-option ' + sel + '" data-acc-id="' + acc.id + '">' + acc.icon + ' ' + acc.name + '</div>';
    });
    container.innerHTML = html;
    container.querySelectorAll('.account-option').forEach(el => {
      el.onclick = () => {
        container.querySelectorAll('.account-option').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        onChange(el.dataset.accId);
      };
    });
  };

  if (!window._transferFrom) window._transferFrom = accounts[0].id;
  if (!window._transferTo) window._transferTo = accounts.length > 1 ? accounts[1].id : accounts[0].id;
  if (window._transferFrom === window._transferTo) {
    window._transferTo = accounts.length > 1 ? accounts[1].id : accounts[0].id;
  }

  renderOpts(fromContainer, window._transferFrom, id => { window._transferFrom = id; });
  renderOpts(toContainer, window._transferTo, id => { window._transferTo = id; });
}

// 加载账户选择器
async function loadAccountSelector(selectedId) {
  const container = document.getElementById('account-selector');
  const accounts = await getAllAccounts();

  // 默认选中第一个或上次使用的
  if (!selectedId && accounts.length > 0) {
    selectedId = accounts[0].id;
  }
  selectedAccountId = selectedId;

  let html = '';
  accounts.forEach(acc => {
    const sel = acc.id === selectedId ? 'selected' : '';
    html += `
      <div class="account-option ${sel}" data-acc-id="${acc.id}" onclick="selectAccount('${acc.id}')">
        <span class="ao-icon">${acc.icon}</span>
        ${acc.name}
      </div>
    `;
  });
  container.innerHTML = html;
}

// 选中分类（兼容旧调用）
function selectCategory(id) {
  doSelectCategory(id);
}

function highlightCategory(id) {
  const el = document.querySelector(`.cat-item[data-cat-id="${id}"]`);
  if (el) el.classList.add('selected');
}

function selectAccount(id) {
  selectedAccountId = id;
  document.querySelectorAll('.account-option').forEach(el => el.classList.remove('selected'));
  const el = document.querySelector(`.account-option[data-acc-id="${id}"]`);
  if (el) el.classList.add('selected');
}

// 保存交易
async function saveTransaction() {
  const amount = parseFloat(document.getElementById('tx-amount').value);
  const note = document.getElementById('tx-note').value.trim();
  const date = document.getElementById('tx-date').value;

  if (!amount || amount <= 0) { showToast('请输入金额'); return; }
  if (currentTxType !== 'transfer' && !selectedCategoryId) { showToast('请选择分类'); return; }

  const isReimbursable = document.getElementById('tx-reimbursable') ? document.getElementById('tx-reimbursable').checked : false;

  let txData;
  if (currentTxType === 'transfer') {
    // 转账
    const fromId = window._transferFrom;
    const toId = window._transferTo;
    if (!fromId || !toId || fromId === toId) { showToast('请选择两个不同的账户'); return; }
    txData = {
      amount: Math.round(amount * 100) / 100,
      type: 'transfer',
      categoryId: 'transfer',
      accountId: fromId,
      toAccountId: toId,
      date: date,
      note: note || ('转账'),
      currency: document.getElementById('tx-currency').value || 'CNY',
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    };
  } else {
    // 如果没有账户，默认第一个
    if (!selectedAccountId) {
      const accounts = await getAllAccounts();
      if (accounts.length === 0) { showToast('请先添加账户（设置页）'); return; }
      selectedAccountId = accounts[0].id;
    }
    txData = {
      amount: Math.round(amount * 100) / 100,
      type: currentTxType,
      categoryId: selectedCategoryId,
      accountId: selectedAccountId,
      date: date,
      note: note,
      currency: document.getElementById('tx-currency').value || 'CNY',
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    };
  }

  try {
    let newId;
    if (editingTransactionId) {
      await updateTransaction(editingTransactionId, txData);
      newId = editingTransactionId;
      showToast('已更新');
    } else {
      newId = await addTransaction(txData);
      showToast('已记录');
    }

    // 保存报销状态
    if (isReimbursable && currentTxType === 'expense') {
      const reimbs = JSON.parse(await getSetting('reimbursements', '{}'));
      if (!reimbs[newId]) {
        reimbs[newId] = { status: 'pending', txId: newId, amount: txData.amount, date: txData.date, note: txData.note || '' };
        await setSetting('reimbursements', JSON.stringify(reimbs));
      }
    }

    closeModal();
    await refreshCurrentPage();
  } catch (e) {
    showToast('保存失败: ' + e.message);
  }
}

// 删除交易
async function deleteCurrentTransaction() {
  if (!editingTransactionId) return;
  showConfirm('确认删除', '确定要删除这条记录吗？', async () => {
    await deleteTransaction(editingTransactionId);
    closeModal();
    showToast('已删除');
    await refreshCurrentPage();
  });
}

async function refreshCurrentPage() {
  if (currentTab === 'home') await showHome();
  else if (currentTab === 'bills') await showBills();
  else if (currentTab === 'assets') await showAssets();
  else if (currentTab === 'stats') await showStats();
}

// ========== 分类管理 ==========
async function openManageCategories() {
  document.getElementById('manage-cats-modal').classList.add('open');
  await renderManageCategories();
}

async function renderManageCategories() {
  const container = document.getElementById('manage-cats-grid');
  const cats = await getAllCategories();
  const expenseCats = cats.filter(c => c.type === 'expense');
  const incomeCats = cats.filter(c => c.type === 'income');

  let html = '<div style="margin-bottom:8px;font-size:13px;color:var(--text-secondary)">支出分类</div><div class="cat-mgmt-grid" style="margin-bottom:16px">';
  expenseCats.forEach(cat => {
    html += `<div class="cat-mgmt-item"><div class="cat-icon">${cat.icon}</div><div class="cat-name">${cat.name}</div><div class="cat-del" onclick="deleteCategoryConfirm('${cat.id}','${cat.name}')">✕</div></div>`;
  });
  html += '</div>';

  html += '<div style="margin-bottom:8px;font-size:13px;color:var(--text-secondary);margin-top:12px">收入分类</div><div class="cat-mgmt-grid">';
  incomeCats.forEach(cat => {
    html += `<div class="cat-mgmt-item"><div class="cat-icon">${cat.icon}</div><div class="cat-name">${cat.name}</div><div class="cat-del" onclick="deleteCategoryConfirm('${cat.id}','${cat.name}')">✕</div></div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

async function deleteCategoryConfirm(id, name) {
  showConfirm('删除分类', `确定要删除「${name}」吗？\n（仅当没有交易使用此分类时才能删除）`, async () => {
    try {
      await deleteCategory(id);
      showToast('已删除');
      await renderManageCategories();
    } catch (e) { showToast(e.message); }
  });
}

function openAddCategory() {
  const type = document.getElementById('new-cat-type').value;
  const name = document.getElementById('new-cat-name').value.trim();
  const icon = document.getElementById('new-cat-icon').value.trim();
  if (!name) { showToast('请输入分类名称'); return; }
  if (!icon) { showToast('请输入图标(emoji)'); return; }
  addCategory({ name, icon, type, sortOrder: 99 }).then(() => {
    showToast('已添加');
    document.getElementById('new-cat-name').value = '';
    document.getElementById('new-cat-icon').value = '📄';
    renderManageCategories();
  }).catch(e => showToast(e.message));
}

// ========== 数据导出 ==========
async function exportDataJSON() {
  try {
    const json = await exportData('json');
    downloadFile(json, `度支简账_${formatDate(new Date())}.json`, 'application/json');
    showToast('✅ 导出成功！请在浏览器下载记录中查看');
  } catch (e) { showToast('导出失败: ' + e.message); }
}

async function exportDataCSV() {
  try {
    const csv = await exportData('csv');
    downloadFile(csv, `度支简账_${formatDate(new Date())}.csv`, 'text/csv');
    showToast('✅ 导出成功！请在浏览器下载记录中查看');
  } catch (e) { showToast('导出失败: ' + e.message); }
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ========== 数据导入 ==========
function importDataFromFile() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = await importData(text);
      showToast(`已导入 ${result.txCount} 条记录`);
      closeModal();
      await refreshCurrentPage();
    } catch (e) { showToast('导入失败: ' + e.message); }
  };
  input.click();
}

// ========== 从钱迹CSV导入 ==========
function importFromQianjiCSV() {
  const input = document.getElementById('csv-file-input');
  if (input) { input.click(); return; }
  // 兜底：动态创建
  const el = document.createElement('input');
  el.type = 'file'; el.id = 'csv-file-input'; el.accept = '.csv,.txt';
  el.style.display = 'none';
  el.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await handleCSVFile(file);
  };
  document.body.appendChild(el);
  el.click();
}

// CSV 文件选择后的处理
async function handleCSVFile(file) {
  try {
    const text = await file.text();
    showToast('⏳ 正在导入 ' + file.name + '...');
    let result = await window.parseQianjiCSV(text);
    const msg = [
      '✅ 导入完成！',
      '📄 解析 ' + result.totalRows + ' 条记录',
      '💳 导入 ' + result.importedTxs + ' 条交易',
      (result.transfersCreated ? '(' + result.transfersCreated + ' 笔转账已拆分)' : ''),
      '🏦 新建 ' + result.newAccounts + ' 个账户'
    ].filter(s => s).join('\n');
    showConfirm('导入结果', msg, async () => {
      closeModal();
      await refreshCurrentPage();
    });
  } catch (e) {
    showToast('导入失败: ' + e.message);
  }
}

// ========== 清空数据 ==========
function clearAllData() {
  showConfirm('清空数据', '确定要清空所有记录吗？\n此操作不可撤销！', async () => {
    await db.transactions.clear();
    await db.accounts.clear();
    // 重新添加默认账户
    await db.accounts.bulkAdd([
      { id: 'cash', name: '现金', icon: '💵', type: 'cash', balance: 0, sortOrder: 1 },
      { id: 'wechat', name: '微信零钱', icon: '💚', type: 'digital', balance: 0, sortOrder: 2 },
      { id: 'alipay', name: '支付宝', icon: '💙', type: 'digital', balance: 0, sortOrder: 3 },
      { id: 'bank_card', name: '银行卡', icon: '🏦', type: 'debit', balance: 0, sortOrder: 4 },
      { id: 'credit_card', name: '信用卡', icon: '💳', type: 'credit', balance: 0, sortOrder: 5 }
    ]);
    showToast('已清空所有记录');
    closeModal();
    await refreshCurrentPage();
  });
}

// ========== 暗色主题 ==========
let isDark = false;
async function toggleDarkMode() {
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.getElementById('dark-mode-icon').textContent = isDark ? '☀️' : '🌙';
  document.getElementById('dark-mode-desc').textContent = isDark ? '已开启夜间模式' : '点击切换夜间模式';
  await setSetting('darkMode', isDark ? '1' : '0');
}

// ========== 日历视图 ==========
let calYear, calMonth, calSelDate;
function switchBillsView(view) {
  document.querySelectorAll('.cal-toggle button').forEach(b => b.classList.remove('on'));
  document.querySelector(`.cal-toggle button[data-view="${view}"]`).classList.add('on');

  if (view === 'calendar') {
    document.getElementById('bills-tx-list').style.display = 'none';
    document.getElementById('cal-bar').style.display = 'flex';
    const grid = document.getElementById('cal-grid'); grid.style.display = 'grid';
    document.getElementById('cal-foot').style.display = 'flex';
    const now = new Date();
    calYear = now.getFullYear(); calMonth = now.getMonth() + 1; calSelDate = null;
    renderCalendar(calYear, calMonth);
  } else {
    document.getElementById('bills-tx-list').style.display = 'block';
    document.getElementById('cal-bar').style.display = 'none';
    document.getElementById('cal-grid').style.display = 'none';
    document.getElementById('cal-foot').style.display = 'none';
  }
}

async function renderCalendar(year, month) {
  const grid = document.getElementById('cal-grid');
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrev = new Date(year, month - 1, 0).getDate();
  const today = formatDate(new Date());
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  // Get data for this month
  const txs = await getTransactionsByMonth(year, month);
  const dailyData = {};
  txs.forEach(tx => {
    if (!dailyData[tx.date]) dailyData[tx.date] = { expense: 0, income: 0 };
    if (tx.type === 'expense' || tx.type === 'transfer') dailyData[tx.date].expense += tx.amount;
    else dailyData[tx.date].income += tx.amount;
  });

  let html = weekDays.map(d => `<div class="cal-hdr">${d}</div>`).join('');

  // Previous month days
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-cell off">${daysInPrev - i}</div>`;
  }
  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const data = dailyData[dateStr];
    const isToday = dateStr === today;
    const isSel = dateStr === calSelDate;
    let cls = 'cal-cell';
    if (isToday) cls += ' today';
    if (isSel) cls += ' sel';
    let dots = '';
    if (data) {
      if (data.expense > 0 && data.income > 0) dots = '<span class="cdot r"></span><span class="cdot g" style="left:60%"></span>';
      else if (data.expense > 0) dots = '<span class="cdot r"></span>';
      else if (data.income > 0) dots = '<span class="cdot g"></span>';
    }
    html += `<div class="${cls}" onclick="selectCalDay('${dateStr}')"><div style="margin-top:4px">${d}</div>${dots}</div>`;
  }
  // Next month days
  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - totalCells % 7) % 7;
  for (let d = 1; d <= remaining; d++) {
    html += `<div class="cal-cell off">${d}</div>`;
  }

  grid.innerHTML = html;
  document.getElementById('cal-month-label').textContent = `${year}年${month}月`;
  document.getElementById('cal-foot').innerHTML =
    `<span>📅 总支出 ¥${Object.values(dailyData).reduce((s,d) => s + d.expense, 0).toFixed(2)}</span>` +
    `<span>${calSelDate ? '点击查看详情' : '点击日期查看'}</span>`;
}

function calPrevMonth() { calMonth--; if (calMonth < 1) { calMonth = 12; calYear--; } renderCalendar(calYear, calMonth); }
function calNextMonth() { calMonth++; if (calMonth > 12) { calMonth = 1; calYear++; } renderCalendar(calYear, calMonth); }

async function selectCalDay(dateStr) {
  calSelDate = dateStr;
  renderCalendar(calYear, calMonth);
  const txs = await getTransactions({ startDate: dateStr, endDate: dateStr });
  const cats = await getAllCategories();
  const catMap = {}; cats.forEach(c => { catMap[c.id] = c; });
  const accounts = await getAllAccounts();
  const accMap = {}; accounts.forEach(a => { accMap[a.id] = a; });

  const container = document.getElementById('bills-tx-list');
  container.style.display = 'block';
  if (txs.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📅</div><div class="empty-text">${dateStr} 没有记录</div></div>`;
  } else {
    let html = `<div class="date-group-header">${dateStr} ${getWeekDay(dateStr)} · ${txs.length}笔</div>`;
    txs.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    txs.forEach(tx => { html += renderTxItem(tx, catMap, accMap); });
    container.innerHTML = html;
  }
}

async function renderDebtSummary() {
  const debts = JSON.parse(await getSetting('debts', '[]'));
  const container = document.getElementById('debt-summary');

  if (debts.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:20px"><div class="empty-text">暂无债务记录</div></div>';
    return;
  }

  let totalLend = 0, totalBorrow = 0;
  debts.forEach(d => {
    const remain = d.amount - (d.repaid || 0);
    if (d.type === 'lend') totalLend += remain;
    else totalBorrow += remain;
  });

  let html = `<div class="d-sum">
    <div class="d-card"><div class="dl">别人欠你</div><div class="da g">¥${totalLend.toFixed(2)}</div></div>
    <div class="d-card"><div class="dl">你欠别人</div><div class="da r">¥${totalBorrow.toFixed(2)}</div></div>
  </div>`;

  debts.sort((a,b) => b.date.localeCompare(a.date)).slice(0, 10).forEach(d => {
    const remain = d.amount - (d.repaid || 0);
    const isLend = d.type === 'lend';
    const status = remain <= 0 ? '✅ 已还清' : '⌛ 未还清';
    html += `<div class="d-item" onclick="repayDebt(${d.id})">
      <div class="di ${isLend ? 'g' : 'r'}">${isLend ? '📤' : '📥'}</div>
      <div class="dx"><div class="dn">${d.person}</div><div class="dd">${d.note || d.date}</div></div>
      <div class="da2 ${isLend ? 'g' : 'r'}">¥${remain.toFixed(2)}</div>
      <div class="ds">${status}</div>
    </div>`;
  });
  container.innerHTML = html;
}

// ========== 债务管理 ==========
let debtType = 'lend';
function setDebtType(type) { debtType = type; }

async function openAddDebtModal() {
  debtType = 'lend';
  document.getElementById('debt-person').value = '';
  document.getElementById('debt-amount').value = '';
  document.getElementById('debt-note').value = '';
  document.querySelectorAll('#debt-modal .type-btn').forEach((b,i) => {
    b.className = 'type-btn';
    if (i === 0) b.classList.add('active-expense');
  });
  document.getElementById('debt-modal').classList.add('open');
}

async function saveDebt() {
  const person = document.getElementById('debt-person').value.trim();
  const amount = parseFloat(document.getElementById('debt-amount').value);
  if (!person) { showToast('请输入对方姓名'); return; }
  if (!amount || amount <= 0) { showToast('请输入金额'); return; }

  const debts = JSON.parse(await getSetting('debts', '[]'));
  debts.push({
    id: Date.now(),
    type: debtType,
    person,
    amount: Math.round(amount * 100) / 100,
    note: document.getElementById('debt-note').value.trim(),
    repaid: 0,
    date: formatDate(new Date()),
    createdAt: new Date().toISOString()
  });
  await setSetting('debts', JSON.stringify(debts));
  showToast('已记录');
  closeModal();
  showAssets();
}

async function repayDebt(id) {
  const debts = JSON.parse(await getSetting('debts', '[]'));
  const debt = debts.find(d => d.id === id);
  if (!debt) return;
  showConfirm('还款', `当前欠款 ¥${(debt.amount - debt.repaid).toFixed(2)}\n输入还款金额:`, async () => {
    // Simple: mark as fully repaid
    debt.repaid = debt.amount;
    await setSetting('debts', JSON.stringify(debts));
    showToast('已标记为已还清');
    showAssets();
  });
}

// ========== 预算管理 ==========
async function openBudgetModal() {
  const budget = await getSetting('monthlyBudget', '0');
  document.getElementById('budget-total').value = budget === '0' ? '' : budget;
  document.getElementById('budget-modal').classList.add('open');
}

async function saveBudget() {
  const val = document.getElementById('budget-total').value.trim();
  if (!val || parseFloat(val) <= 0) { showToast('请输入预算金额'); return; }
  await setSetting('monthlyBudget', parseFloat(val).toFixed(2));
  showToast('预算已设置');
  closeModal();
  showStats();
}

async function clearBudget() {
  await setSetting('monthlyBudget', '0');
  showToast('预算已清除');
  closeModal();
  showStats();
}

async function renderBudget() {
  const now = new Date();
  const stats = await getMonthStats(now.getFullYear(), now.getMonth() + 1);
  const budget = parseFloat(await getSetting('monthlyBudget', '0'));

  const spentEl = document.getElementById('budget-spent');
  const remainEl = document.getElementById('budget-remain');
  const barEl = document.getElementById('budget-bar');
  const statusEl = document.getElementById('budget-status');

  if (budget <= 0) {
    statusEl.textContent = '未设置';
    barEl.style.width = '0%';
    spentEl.textContent = `¥${stats.totalExpense.toFixed(2)}`;
    remainEl.textContent = '设置预算';
    return;
  }

  const pct = Math.min(100, (stats.totalExpense / budget) * 100);
  statusEl.textContent = `${pct.toFixed(1)}%`;
  barEl.style.width = pct + '%';
  barEl.className = 'bp-fill' + (pct > 90 ? ' d' : pct > 70 ? ' w' : '');
  spentEl.textContent = `已支出 ¥${stats.totalExpense.toFixed(2)}`;
  remainEl.textContent = `预算 ¥${budget.toFixed(2)} · 剩余 ¥${Math.max(0, budget - stats.totalExpense).toFixed(2)}`;
}

// ========== 报销管理 ==========
async function renderReimbursements() {
  const container = document.getElementById('reimbursement-section');
  const reimbs = JSON.parse(await getSetting('reimbursements', '{}'));
  const ids = Object.keys(reimbs);

  if (ids.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:16px"><div class="empty-text">暂无待报销记录</div></div>';
    return;
  }

  let totalPending = 0, totalReimbursed = 0;
  ids.forEach(id => {
    if (reimbs[id].status === 'reimbursed') totalReimbursed += reimbs[id].amount;
    else totalPending += reimbs[id].amount;
  });

  let html = `<div class="d-sum">
    <div class="d-card"><div class="dl">待报销</div><div class="da r">¥${totalPending.toFixed(2)}</div></div>
    <div class="d-card"><div class="dl">已报销</div><div class="da g">¥${totalReimbursed.toFixed(2)}</div></div>
  </div>`;

  ids.sort().reverse().forEach(id => {
    const r = reimbs[id];
    const isDone = r.status === 'reimbursed';
    html += `<div class="d-item" onclick="${isDone ? '' : "markReimbursed('" + id + "')"}">
      <div class="di ${isDone ? 'g' : 'r'}">${isDone ? '✅' : '🧾'}</div>
      <div class="dx">
        <div class="dn">${r.note || '报销'}</div>
        <div class="dd">${r.date} · ${isDone ? '已报销' : '待报销'}</div>
      </div>
      <div class="da2 ${isDone ? 'g' : 'r'}">¥${(isDone ? r.amount : r.amount).toFixed(2)}</div>
    </div>`;
  });
  container.innerHTML = html;
}

async function markReimbursed(txId) {
  showConfirm('标记已报销', '确定这笔已经报销到账了吗？', async () => {
    const reimbs = JSON.parse(await getSetting('reimbursements', '{}'));
    if (reimbs[txId]) {
      reimbs[txId].status = 'reimbursed';
      await setSetting('reimbursements', JSON.stringify(reimbs));
      showToast('已标记为已报销');
      showAssets();
    }
  });
}

// ========== 工具函数 ==========
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekDay(dateStr) {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[new Date(dateStr).getDay()];
}

function closeModal() {
  document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('open'));
  document.querySelectorAll('.dialog-overlay').forEach(el => el.classList.remove('open'));

}

// 页面加载时监听返回键
window.addEventListener('popstate', function(e) {
  // 如果有任何模态框打开，关闭它并阻止导航
  const openModal = document.querySelector('.modal-overlay.open, .dialog-overlay.open');
  if (openModal) {
    closeModal();
    // 阻止真正的页面返回
    if (!e.state || !e.state.modalOpen) {
      window.history.pushState({ modalOpen: true }, '');
    }
    return;
  }
});

// 在打开模态框时记录历史状态
function openModalWithBackSupport(modalId) {
  document.getElementById(modalId).classList.add('open');
  window.history.pushState({ modalOpen: true }, '');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
}

function showConfirm(title, body, onConfirm) {
  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-body').textContent = body;
  document.getElementById('dialog-confirm-btn').onclick = () => { closeModal(); onConfirm(); };
  document.getElementById('dialog-confirm').classList.add('open');
}

// ========== 事件注册 ==========
function registerEvents() {
  // Tab 切换
  document.querySelectorAll('.tab-item').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });

  // 点击遮罩关闭模态框
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
  });

  // 账单月份导航
  document.getElementById('bills-month-prev').addEventListener('click', async () => {
    const label = document.getElementById('bills-month-label').textContent;
    const m = label.match(/(\d+)年(\d+)月/);
    if (m) {
      let y = parseInt(m[1]), mo = parseInt(m[2]) - 1;
      if (mo < 1) { mo = 12; y--; }
      document.getElementById('bills-month-label').textContent = `${y}年${mo}月`;
      await loadBillsData(y, mo);
    }
  });

  document.getElementById('bills-month-next').addEventListener('click', async () => {
    const label = document.getElementById('bills-month-label').textContent;
    const m = label.match(/(\d+)年(\d+)月/);
    if (m) {
      let y = parseInt(m[1]), mo = parseInt(m[2]) + 1;
      if (mo > 12) { mo = 1; y++; }
      const now = new Date();
      if (y > now.getFullYear() || (y === now.getFullYear() && mo > now.getMonth() + 1)) return;
      document.getElementById('bills-month-label').textContent = `${y}年${mo}月`;
      await loadBillsData(y, mo);
    }
  });

  // 统计视图切换
  document.querySelectorAll('.stat-view-btn').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.stat-view-btn').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      currentStatView = el.dataset.view;
      loadStatsData();
    });
  });

  // 统计图表切换
  document.querySelectorAll('.stat-chart-btn').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.stat-chart-btn').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      currentStatChart = el.dataset.chart;
      loadStatsData();
    });
  });

  // 账单过滤
  document.querySelectorAll('.chip').forEach(el => {
    el.addEventListener('click', async () => {
      document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      currentFilterType = el.dataset.filter;
      const label = document.getElementById('bills-month-label').textContent;
      const m = label.match(/(\d+)年(\d+)月/);
      if (m) await loadBillsData(parseInt(m[1]), parseInt(m[2]));
    });
  });

  // 金额输入限制
  document.getElementById('tx-amount').addEventListener('input', function() {
    this.value = this.value.replace(/[^\d.]/g, '');
    const parts = this.value.split('.');
    if (parts.length > 2) this.value = parts[0] + '.' + parts[1];
    if (parts[1] && parts[1].length > 2) this.value = parts[0] + '.' + parts[1].slice(0, 2);
  });

  // 新账户余额输入限制
  const balInput = document.getElementById('new-acc-balance');
  if (balInput) {
    balInput.addEventListener('input', function() {
      this.value = this.value.replace(/[^\d.]/g, '');
      const parts = this.value.split('.');
      if (parts.length > 2) this.value = parts[0] + '.' + parts[1];
      if (parts[1] && parts[1].length > 2) this.value = parts[0] + '.' + parts[1].slice(0, 2);
    });
  }

  // 日期默认今天
  document.getElementById('tx-date').value = formatDate(new Date());
}

// ========== 启动 ==========
document.addEventListener('DOMContentLoaded', initApp);
