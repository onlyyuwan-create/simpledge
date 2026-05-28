// ========== 数据库层 - 基于 Dexie.js (IndexedDB) ==========

const DB_NAME = 'AccountBookDB';
const DB_VERSION = 2;

// ========== 默认数据 ==========

const DEFAULT_EXPENSE_CATEGORIES = [
  { id: 'food', name: '餐饮', icon: '🍜', type: 'expense', sortOrder: 1 },
  { id: 'transport', name: '交通', icon: '🚌', type: 'expense', sortOrder: 2 },
  { id: 'shopping', name: '购物', icon: '🛒', type: 'expense', sortOrder: 3 },
  { id: 'entertain', name: '娱乐', icon: '🎮', type: 'expense', sortOrder: 4 },
  { id: 'housing', name: '住房', icon: '🏠', type: 'expense', sortOrder: 5 },
  { id: 'utilities', name: '水电', icon: '💡', type: 'expense', sortOrder: 6 },
  { id: 'communication', name: '通讯', icon: '📱', type: 'expense', sortOrder: 7 },
  { id: 'medical', name: '医疗', icon: '🏥', type: 'expense', sortOrder: 8 },
  { id: 'education', name: '教育', icon: '📚', type: 'expense', sortOrder: 9 },
  { id: 'social', name: '人情', icon: '🎁', type: 'expense', sortOrder: 10 },
  { id: 'beauty', name: '美容', icon: '💄', type: 'expense', sortOrder: 11 },
  { id: 'clothes', name: '服饰', icon: '👔', type: 'expense', sortOrder: 12 },
  { id: 'pet', name: '宠物', icon: '🐱', type: 'expense', sortOrder: 13 },
  { id: 'other_expense', name: '其他', icon: '📦', type: 'expense', sortOrder: 99 }
];

const DEFAULT_INCOME_CATEGORIES = [
  { id: 'salary', name: '工资', icon: '💰', type: 'income', sortOrder: 1 },
  { id: 'bonus', name: '奖金', icon: '🏆', type: 'income', sortOrder: 2 },
  { id: 'freelance', name: '兼职', icon: '💻', type: 'income', sortOrder: 3 },
  { id: 'investment', name: '投资', icon: '📈', type: 'income', sortOrder: 4 },
  { id: 'gift_money', name: '红包', icon: '🧧', type: 'income', sortOrder: 5 },
  { id: 'refund', name: '退款', icon: '↩️', type: 'income', sortOrder: 6 },
  { id: 'other_income', name: '其他', icon: '📥', type: 'income', sortOrder: 99 }
];

// 默认资产账户
const DEFAULT_ACCOUNTS = [
  { id: 'cash', name: '现金', icon: '💵', type: 'cash', balance: 0, sortOrder: 1 },
  { id: 'wechat', name: '微信零钱', icon: '💚', type: 'digital', balance: 0, sortOrder: 2 },
  { id: 'alipay', name: '支付宝', icon: '💙', type: 'digital', balance: 0, sortOrder: 3 },
  { id: 'bank_card', name: '银行卡', icon: '🏦', type: 'debit', balance: 0, sortOrder: 4 },
  { id: 'credit_card', name: '信用卡', icon: '💳', type: 'credit', balance: 0, sortOrder: 5 }
];

let db;

// ========== 初始化数据库 ==========
async function initDB() {
  db = new Dexie(DB_NAME);

  db.version(1).stores({
    transactions: '++id, type, categoryId, date, createdAt',
    categories: 'id, type, sortOrder',
    settings: 'key'
  });

  db.version(2).stores({
    transactions: '++id, type, categoryId, accountId, date, createdAt',
    categories: 'id, type, sortOrder',
    accounts: 'id, type, sortOrder',
    settings: 'key'
  }).upgrade(async tx => {
    // 迁移：给所有旧交易加上 accountId = 'cash'
    await tx.table('transactions').toCollection().modify(t => {
      if (!t.accountId) t.accountId = 'cash';
    });
    // 写入默认账户
    await tx.table('accounts').bulkAdd(DEFAULT_ACCOUNTS);
  });

  // 确保默认分类存在 (v1已做的仍会保留)
  const categoryCount = await db.categories.count();
  if (categoryCount === 0) {
    await db.categories.bulkAdd([...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES]);
  }

  // 确保默认账户存在 (全新安装时)
  const accountCount = await db.accounts.count();
  if (accountCount === 0) {
    await db.accounts.bulkAdd(DEFAULT_ACCOUNTS);
  }

  return db;
}

// ========== 工具：计算账户余额 ==========
function roundMoney(v) {
  return Math.round(v * 100) / 100;
}

// 从交易历史重算某个账户的余额
async function recalcAccountBalance(accountId) {
  const txs = await db.transactions.where('accountId').equals(accountId).toArray();
  let balance = 0;
  txs.forEach(tx => {
    if (tx.type === 'income') balance += tx.amount;
    else balance -= tx.amount;
  });
  balance = roundMoney(balance);
  await db.accounts.update(accountId, { balance });
  return balance;
}

// 重算所有账户余额
async function recalcAllBalances() {
  const accounts = await db.accounts.toArray();
  for (const acc of accounts) {
    await recalcAccountBalance(acc.id);
  }
}

// ========== 账户 CRUD ==========

async function getAllAccounts() {
  return await db.accounts.orderBy('sortOrder').toArray();
}

async function getAccount(id) {
  return await db.accounts.get(id);
}

async function addAccount(acc) {
  const id = 'acc_' + Date.now();
  await db.accounts.add({ ...acc, id, balance: acc.balance || 0 });
  return id;
}

async function updateAccount(id, updates) {
  return await db.accounts.update(id, updates);
}

async function deleteAccount(id) {
  // 检查是否有交易使用此账户
  const count = await db.transactions.where('accountId').equals(id).count();
  if (count > 0) {
    throw new Error(`有 ${count} 条记录关联此账户，无法删除`);
  }
  return await db.accounts.delete(id);
}

// ========== 交易记录 CRUD（含余额联动） ==========

// 添加交易（自动更新账户余额）
async function addTransaction(tx) {
  const id = await db.transactions.add({
    ...tx,
    accountId: tx.accountId || 'cash',
    createdAt: new Date().toISOString()
  });
  // 更新账户余额
  const acc = await db.accounts.get(tx.accountId || 'cash');
  if (acc) {
    const delta = tx.type === 'income' ? tx.amount : -tx.amount;
    await db.accounts.update(tx.accountId || 'cash', {
      balance: roundMoney(acc.balance + delta)
    });
  }
  return id;
}

// 更新交易（先回滚旧值，再应用新值）
async function updateTransaction(id, updates) {
  const oldTx = await db.transactions.get(id);
  if (!oldTx) return;

  // 回滚旧交易对旧账户余额的影响
  const oldAccountId = oldTx.accountId || 'cash';
  const oldAcc = await db.accounts.get(oldAccountId);
  if (oldAcc) {
    const oldDelta = oldTx.type === 'income' ? -oldTx.amount : oldTx.amount;
    await db.accounts.update(oldAccountId, {
      balance: roundMoney(oldAcc.balance + oldDelta)
    });
  }

  // 应用新值
  await db.transactions.update(id, updates);
  const merged = { ...oldTx, ...updates };
  const newAccountId = merged.accountId || 'cash';

  // 如果换账户了，重算旧账户余额
  if (oldAccountId !== newAccountId) {
    await recalcAccountBalance(oldAccountId);
  }

  // 应用新交易对新账户余额的影响
  const newAcc = await db.accounts.get(newAccountId);
  if (newAcc) {
    const newDelta = merged.type === 'income' ? merged.amount : -merged.amount;
    await db.accounts.update(newAccountId, {
      balance: roundMoney(newAcc.balance + newDelta)
    });
  }
}

// 删除交易（回滚余额）
async function deleteTransaction(id) {
  const tx = await db.transactions.get(id);
  if (!tx) return;

  await db.transactions.delete(id);

  // 回滚余额
  const accountId = tx.accountId || 'cash';
  const acc = await db.accounts.get(accountId);
  if (acc) {
    const delta = tx.type === 'income' ? -tx.amount : tx.amount;
    await db.accounts.update(accountId, {
      balance: roundMoney(acc.balance + delta)
    });
  }
}

// 获取单笔交易
async function getTransaction(id) {
  return await db.transactions.get(id);
}

// 获取交易列表
async function getTransactions(options = {}) {
  const { type, categoryId, accountId, startDate, endDate } = options;
  let results = await db.transactions.orderBy('date').reverse().toArray();

  if (type && type !== 'all') results = results.filter(t => t.type === type);
  if (categoryId) results = results.filter(t => t.categoryId === categoryId);
  if (accountId) results = results.filter(t => t.accountId === accountId);
  if (startDate) results = results.filter(t => t.date >= startDate);
  if (endDate) results = results.filter(t => t.date <= endDate);

  return results;
}

// 按月获取交易
async function getTransactionsByMonth(year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  return await getTransactions({ startDate, endDate });
}

// 获取某账户的交易
async function getTransactionsByAccount(accountId, limit = 50) {
  const results = await db.transactions
    .where('accountId').equals(accountId)
    .reverse()
    .limit(limit)
    .toArray();
  return results;
}

// ========== 统计 ==========

async function getMonthStats(year, month) {
  const txs = await getTransactionsByMonth(year, month);
  let totalExpense = 0, totalIncome = 0;
  const expenseByCategory = {};
  const incomeByCategory = {};

  txs.forEach(tx => {
    if (tx.type === 'expense') {
      totalExpense += tx.amount;
      expenseByCategory[tx.categoryId] = (expenseByCategory[tx.categoryId] || 0) + tx.amount;
    } else {
      totalIncome += tx.amount;
      incomeByCategory[tx.categoryId] = (incomeByCategory[tx.categoryId] || 0) + tx.amount;
    }
  });

  return {
    totalExpense: roundMoney(totalExpense),
    totalIncome: roundMoney(totalIncome),
    balance: roundMoney(totalIncome - totalExpense),
    expenseByCategory,
    incomeByCategory,
    count: txs.length
  };
}

async function getDailyStats(year, month) {
  const txs = await getTransactionsByMonth(year, month);
  const lastDay = new Date(year, month, 0).getDate();
  const daily = {};
  for (let d = 1; d <= lastDay; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    daily[key] = { expense: 0, income: 0 };
  }
  txs.forEach(tx => {
    if (daily[tx.date]) {
      if (tx.type === 'expense') daily[tx.date].expense += tx.amount;
      else daily[tx.date].income += tx.amount;
    }
  });
  Object.keys(daily).forEach(key => {
    daily[key].expense = roundMoney(daily[key].expense);
    daily[key].income = roundMoney(daily[key].income);
  });
  return daily;
}

// ========== 分类管理 ==========

async function getAllCategories(type = null) {
  let cats = await db.categories.orderBy('sortOrder').toArray();
  if (type) cats = cats.filter(c => c.type === type);
  return cats;
}

async function addCategory(cat) {
  const id = cat.type + '_' + Date.now();
  return await db.categories.add({ ...cat, id });
}

async function deleteCategory(id) {
  const count = await db.transactions.where('categoryId').equals(id).count();
  if (count > 0) {
    throw new Error(`有 ${count} 条记录使用了此分类，无法删除`);
  }
  return await db.categories.delete(id);
}

// ========== 设置管理 ==========

async function getSetting(key, defaultValue = null) {
  const s = await db.settings.get(key);
  return s ? s.value : defaultValue;
}

async function setSetting(key, value) {
  return await db.settings.put({ key, value });
}

// ========== 数据导出导入 ==========

async function exportData(format = 'json') {
  const transactions = await db.transactions.toArray();
  const categories = await db.categories.toArray();
  const accounts = await db.accounts.toArray();
  const data = { transactions, categories, accounts, exportDate: new Date().toISOString() };

  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  } else if (format === 'csv') {
    const cats = {};
    categories.forEach(c => { cats[c.id] = c.name; });
    const accs = {};
    accounts.forEach(a => { accs[a.id] = a.name; });

    const headers = ['日期', '类型', '分类', '账户', '金额', '备注'];
    const rows = transactions.sort((a, b) => a.date.localeCompare(b.date)).map(tx => [
      tx.date,
      tx.type === 'expense' ? '支出' : '收入',
      cats[tx.categoryId] || tx.categoryId,
      accs[tx.accountId] || tx.accountId,
      tx.amount.toFixed(2),
      tx.note || ''
    ]);
    return [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
  }
}

async function importData(jsonStr) {
  const data = JSON.parse(jsonStr);
  if (!data.transactions || !data.categories) {
    throw new Error('数据格式错误');
  }

  await db.transactions.clear();
  await db.categories.clear();
  if (data.accounts) {
    await db.accounts.clear();
    await db.accounts.bulkAdd(data.accounts);
  }
  await db.categories.bulkAdd(data.categories);
  await db.transactions.bulkAdd(data.transactions);

  // 重算所有账户余额
  await recalcAllBalances();

  return {
    txCount: data.transactions.length,
    catCount: data.categories.length,
    accCount: data.accounts ? data.accounts.length : 0
  };
}

// ========== 钱迹CSV导入 ==========

// 钱迹分类 → 度支简账分类映射
const QIANJI_CAT_MAP = {
  '三餐': 'food',
  '交通': 'transport',
  '其它': 'other_expense',
  '住房': 'housing',
  '学习': 'education',
  '日用品': 'shopping',
  '话费网费': 'communication',
  '工资': 'salary',
  '美妆': 'beauty',
  '请客送礼': 'social',
  '零食': 'food',
  '电器数码': 'shopping',
  '会员': 'entertain',
  '衣服': 'clothes',
  '医疗': 'medical',
  '娱乐': 'entertain',
  '餐饮': 'food',
  '购物': 'shopping'
};

// 钱迹类型 → 我们的类型
function mapQianjiType(type) {
  if (type === '支出') return 'expense';
  if (type === '收入') return 'income';
  return null; // 转账、还款等特殊处理
}

// 从钱迹CSV导入
async function importFromQianjiCSV(csvText, onProgress) {
  // 解析CSV
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV格式错误');

  // 解析标题行（去掉引号）
  const headers = parseCSVLine(lines[0]);
  
  // 找到各列的索引
  const colIdx = {
    time: headers.indexOf('时间'),
    category: headers.indexOf('分类'),
    subCategory: headers.indexOf('二级分类'),
    type: headers.indexOf('类型'),
    amount: headers.indexOf('金额'),
    account1: headers.indexOf('账户1'),
    account2: headers.indexOf('账户2'),
    note: headers.indexOf('备注')
  };

  if (colIdx.time < 0 || colIdx.amount < 0 || colIdx.type < 0) {
    throw new Error('无法识别CSV列名，请确认是钱迹导出的CSV');
  }

  // 解析所有行
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length <= colIdx.amount) continue;
    rows.push({
      time: cols[colIdx.time] || '',
      category: cols[colIdx.category] || '',
      subCategory: cols[colIdx.subCategory] || '',
      type: cols[colIdx.type] || '',
      amount: parseFloat(cols[colIdx.amount]) || 0,
      account1: cols[colIdx.account1] || '',
      account2: cols[colIdx.account2] || '',
      note: cols[colIdx.note] || ''
    });
  }

  if (rows.length === 0) throw new Error('没有找到有效数据');

  // ---- Step 1: 创建/获取账户 ----
  const accountNames = new Set();
  rows.forEach(r => {
    if (r.account1) accountNames.add(r.account1);
    if (r.account2 && r.type === '转账') accountNames.add(r.account2);
  });

  // 现有的账户
  const existingAccs = await db.accounts.toArray();
  const existingAccNames = new Set(existingAccs.map(a => a.name));
  const accNameMap = {}; // 钱迹账户名 → 我们的账户id
  existingAccs.forEach(a => { accNameMap[a.name] = a.id; });

  // 账户类型推断
  function guessAccType(name) {
    if (name.includes('信用卡') || name === '花呗') return 'credit';
    if (name.includes('银行') || name === '招商银行' || name === '建设银行' || name === '民生银行') return 'debit';
    if (name.includes('现金')) return 'cash';
    if (name.includes('公交') || name.includes('手环')) return 'debit';
    return 'digital';
  }

  function guessAccIcon(name) {
    if (name.includes('微信')) return '💚';
    if (name.includes('支付宝')) return '💙';
    if (name.includes('银行') || name === '招商银行' || name === '建设银行' || name === '民生银行') return '🏦';
    if (name.includes('现金')) return '💵';
    if (name.includes('花呗')) return '💳';
    if (name.includes('公交') || name.includes('手环')) return '🚌';
    return '🏦';
  }

  // 创建不存在的账户
  const newAccounts = [];
  let sortOrder = existingAccs.length + 1;
  for (const name of accountNames) {
    if (!accNameMap[name]) {
      const id = 'qj_' + name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
      accNameMap[name] = id;
      newAccounts.push({
        id,
        name,
        icon: guessAccIcon(name),
        type: guessAccType(name),
        balance: 0,
        sortOrder: sortOrder++
      });
    }
  }
  if (newAccounts.length > 0) {
    await db.accounts.bulkAdd(newAccounts);
  }

  // ---- Step 2: 确保分类存在 ----
  const existingCats = await db.categories.toArray();
  const existingCatNames = new Set(existingCats.map(c => c.name));
  const newCats = [];

  const usedCatNames = new Set();
  rows.forEach(r => {
    if (r.category && !existingCatNames.has(r.category) && !usedCatNames.has(r.category)) {
      usedCatNames.add(r.category);
      const mappedId = QIANJI_CAT_MAP[r.category];
      // 如果映射不存在，使用ID查找
      if (!mappedId || !existingCats.find(c => c.id === mappedId)) {
        // 需要创建新分类
        newCats.push({
          id: 'qj_' + r.category,
          name: r.category,
          icon: '📦',
          type: 'expense',
          sortOrder: 99
        });
      }
    }
  });
  if (newCats.length > 0) {
    await db.categories.bulkAdd(newCats);
  }

  // 刷新分类列表
  const allCats = await db.categories.toArray();

  // 查找分类ID的函数
  function findCategoryId(name, type) {
    if (!name) return type === 'income' ? 'other_income' : 'other_expense';
    const mappedId = QIANJI_CAT_MAP[name];
    if (mappedId && allCats.find(c => c.id === mappedId)) return mappedId;
    const byName = allCats.find(c => c.name === name);
    if (byName) return byName.id;
    const qjCat = allCats.find(c => c.id === 'qj_' + name);
    if (qjCat) return qjCat.id;
    return type === 'income' ? 'other_income' : 'other_expense';
  }

  // ---- Step 3: 创建交易 ----
  const newTxs = [];
  let transfersCreated = 0;

  for (const row of rows) {
    const ourType = mapQianjiType(row.type);
    const date = row.time.slice(0, 10);
    const note = row.note || '';

    if (ourType === 'expense' || ourType === 'income') {
      const accountId = accNameMap[row.account1] || 'cash';
      newTxs.push({
        amount: roundMoney(row.amount),
        type: ourType,
        categoryId: findCategoryId(row.category, ourType),
        accountId: accountId,
        date: date,
        note: note,
        time: row.time.slice(11, 16),
        createdAt: row.time
      });
    } else if (row.type === '转账') {
      // 转账：A→B，相当于从A支出、向B收入
      const fromAcc = accNameMap[row.account1];
      const toAcc = accNameMap[row.account2];
      if (fromAcc && toAcc) {
        newTxs.push({
          amount: roundMoney(row.amount),
          type: 'expense',
          categoryId: 'other_expense',
          accountId: fromAcc,
          date: date,
          note: '转账→' + row.account2 + (note ? ' ' + note : ''),
          time: row.time.slice(11, 16),
          createdAt: row.time
        });
        newTxs.push({
          amount: roundMoney(row.amount),
          type: 'income',
          categoryId: 'other_income',
          accountId: toAcc,
          date: date,
          note: '转账←' + row.account1 + (note ? ' ' + note : ''),
          time: row.time.slice(11, 16),
          createdAt: row.time
        });
        transfersCreated++;
      }
    }
    // 其他类型（还款、债务等）暂当支出记录
    else if (row.amount > 0) {
      const accountId = accNameMap[row.account1] || 'cash';
      newTxs.push({
        amount: roundMoney(row.amount),
        type: 'expense',
        categoryId: 'other_expense',
        accountId: accountId,
        date: date,
        note: '[' + row.type + '] ' + note,
        time: row.time.slice(11, 16),
        createdAt: row.time
      });
    }
  }

  // 批量导入
  if (newTxs.length > 0) {
    await db.transactions.bulkAdd(newTxs);
  }

  // 重算所有账户余额
  await recalcAllBalances();

  return {
    totalRows: rows.length,
    importedTxs: newTxs.length,
    newAccounts: newAccounts.length,
    transfersCreated,
    skipped: rows.length - newTxs.length
  };
}

// CSV行解析（处理引号内逗号）
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
