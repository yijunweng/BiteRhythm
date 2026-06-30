// miniprogram/pages/index/index.js
const app = getApp();
const { toast } = require('../../utils/toast.js');

function parseMarkdown(md) {
  if (!md) return [];
  const lines = md.split('\n');
  const blocks = [];
  
  let inTable = false;
  let tableHeaders = [];
  let tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check if it's a table line
    if (line.startsWith('|') && line.endsWith('|')) {
      const cols = line.split('|').map(c => c.trim().replace(/\*\*/g, '')).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
      
      const isSeparator = cols.every(c => c.startsWith('-') || c === '');
      if (isSeparator) {
        continue;
      }
      
      if (!inTable) {
        inTable = true;
        tableHeaders = cols;
        tableRows = [];
      } else {
        tableRows.push(cols);
      }
      continue;
    } else {
      if (inTable) {
        blocks.push({
          type: 'table',
          headers: tableHeaders,
          rows: tableRows
        });
        inTable = false;
        tableHeaders = [];
        tableRows = [];
      }
    }
    
    if (line === '') {
      continue;
    }
    
    const cleanLine = line.replace(/\*\*/g, '');
    
    if (cleanLine.startsWith('# ')) {
      blocks.push({ type: 'h1', text: cleanLine.substring(2).trim() });
    } else if (cleanLine.startsWith('## ')) {
      blocks.push({ type: 'h2', text: cleanLine.substring(3).trim() });
    } else if (cleanLine.startsWith('### ')) {
      blocks.push({ type: 'h3', text: cleanLine.substring(4).trim() });
    } else if (cleanLine.startsWith('- ') || cleanLine.startsWith('* ')) {
      blocks.push({ type: 'bullet', text: cleanLine.substring(2).trim() });
    } else {
      blocks.push({ type: 'p', text: cleanLine });
    }
  }
  
  if (inTable) {
    blocks.push({
      type: 'table',
      headers: tableHeaders,
      rows: tableRows
    });
  }
  
  return blocks;
}

function splitShoppingList(md) {
  if (!md) return { simpleMd: '', fullMd: '' };
  
  const separator = '### 📋 详细采购建议';
  const index = md.indexOf(separator);
  
  if (index !== -1) {
    let simplePart = md.substring(0, index).trim();
    let detailedPart = md.substring(index + separator.length).trim();
    
    simplePart = simplePart.replace('### 💡 简要提示', '').trim();
    simplePart = simplePart.replace(/^---/, '').replace(/---$/, '').trim();
    
    return {
      simpleMd: simplePart,
      fullMd: detailedPart
    };
  }
  
  // Fallback for old formatting:
  // Parse the markdown and collect the first column of the first few table rows
  const parsed = parseMarkdown(md);
  const tables = parsed.filter(b => b.type === 'table');
  const ingredients = [];
  
  tables.forEach(table => {
    table.rows.forEach(row => {
      if (row[0] && row[0] !== '食材') {
        const name = row[0].replace(/\*\*/g, '').trim();
        if (name && !ingredients.includes(name)) {
          ingredients.push(name);
        }
      }
    });
  });
  
  if (ingredients.length > 0) {
    const summary = ingredients.slice(0, 8).join('、');
    return {
      simpleMd: `今日配餐建议采购：${summary} 等核心食材。`,
      fullMd: md
    };
  }
  
  const lines = md.split('\n');
  let simpleLines = [];
  let lineCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (line.startsWith('#') || line.startsWith('|') || line.startsWith('-')) {
      continue;
    }
    simpleLines.push(line);
    lineCount++;
    if (lineCount >= 2) break;
  }
  
  const simpleText = simpleLines.join('\n');
  return {
    simpleMd: simpleText || '已生成配餐采购建议，请点击详情查看完整清单。',
    fullMd: md
  };
}

Page({
  data: {
    initialLoading: true,
    isSystemAdmin: false,
    memberRole: '',
    families: [],
    activeFamily: null,
    showFamilySelector: false,
    currentYear: 0,
    currentMonth: 0,
    days: [],
    selectedDateStr: '',
    selectedDateMenu: null,
    monthlyMenus: {},
    loading: false,
    showCreateFamilyModal: false,
    newFamilyName: '',
    showDeleteFamilyConfirm: false,
    deleteFamilyId: '',
    deleteFamilyName: '',
    showClearMenuConfirm: false,
    shoppingLoading: false,
    showConfigPromptModal: false,
    showShoppingDetailsModal: false,
    parsedSimpleShoppingList: [],
    parsedFullShoppingList: [],
    toastData: { show: false, type: 'none', title: '' }
  },

  onLoad: function () {
    const today = new Date();
    this.setData({
      currentYear: today.getFullYear(),
      currentMonth: today.getMonth() + 1,
      selectedDateStr: this.formatDate(today)
    });

    if (app.globalData.hasCheckedAuth) {
      this.initUserAndData();
    } else {
      app.authCallback = () => this.initUserAndData();
    }
  },

  onShow: function () {
    if (app.globalData.hasCheckedAuth) {
      const globalActive = app.globalData.activeFamily;
      const pageActive = this.data.activeFamily;
      if (globalActive && (!pageActive || JSON.stringify(pageActive) !== JSON.stringify(globalActive))) {
        this.setData({ activeFamily: globalActive });
        this.fetchMonthlyMenus();
        this.fetchUserRoleInFamily();
      } else if (pageActive && app.globalData.menuChanged) {
        app.globalData.menuChanged = false;
        this.fetchMonthlyMenus();
      }
    }
  },

  onPullDownRefresh: async function () {
    try {
      await this.fetchFamiliesList();
    } catch (err) {
      console.error('下拉刷新失败', err);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  initUserAndData: async function () {
    this.setData({ isSystemAdmin: app.globalData.isSystemAdmin, initialLoading: true });
    try {
      await this.fetchFamiliesList();
      this.initCalendar();
    } catch (err) {
      console.error('初始化数据失败', err);
    } finally {
      this.setData({ initialLoading: false });
    }
  },

  fetchFamiliesList: async function () {
    this.setData({ loading: true });
    try {
      const db = wx.cloud.database();
      const openid = app.globalData.openid;

      // 并发查询用户加入的家庭成员记录和自己创建的家庭
      const [memberRes, ownRes] = await Promise.all([
        db.collection('family_members').where({ openid, status: 'approved' }).get(),
        db.collection('families').where({ creator_openid: openid }).get()
      ]);

      const familyIds = memberRes.data.map(m => m.family_id);

      let families = [];
      if (familyIds.length > 0) {
        const r = await db.collection('families')
          .where({ _id: db.command.in(familyIds) }).get();
        families = r.data;
      }

      ownRes.data.forEach(f => {
        if (!families.find(x => x._id === f._id)) families.push(f);
      });

      this.setData({ families });

      if (families.length > 0) {
        const lastId = wx.getStorageSync('last_family_id');
        const selected = families.find(f => f._id === lastId) || families[0];
        await this.selectFamily(selected);
      }
    } catch (err) {
      console.error('获取家庭列表失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  selectFamily: async function (family) {
    app.globalData.activeFamily = family;
    wx.setStorageSync('last_family_id', family._id);
    this.setData({ activeFamily: family, showFamilySelector: false });
    await Promise.all([
      this.fetchUserRoleInFamily(),
      this.fetchMonthlyMenus()
    ]);
  },

  onSelectFamily: async function (e) {
    toast.showLoading(this, '切换中...');
    try {
      await this.selectFamily(e.currentTarget.dataset.family);
    } catch (err) {
      console.error('选择家庭失败', err);
    } finally {
      toast.hideLoading(this);
    }
  },

  toggleFamilySelector: function () {
    this.setData({ showFamilySelector: !this.data.showFamilySelector });
  },

  fetchUserRoleInFamily: async function () {
    if (!this.data.activeFamily) return;
    const db = wx.cloud.database();
    const openid = app.globalData.openid;
    try {
      if (this.data.activeFamily.creator_openid === openid) {
        this.setData({ memberRole: 'admin' });
        app.globalData.memberRole = 'admin';
        return;
      }
      const res = await db.collection('family_members')
        .where({ family_id: this.data.activeFamily._id, openid }).get();
      const role = res.data.length > 0 ? res.data[0].role : '';
      this.setData({ memberRole: role });
      app.globalData.memberRole = role;
    } catch (err) {
      console.error('获取角色失败', err);
    }
  },

  onCreateFamily: function () {
    this.setData({ showCreateFamilyModal: true, newFamilyName: '' });
  },

  onCloseCreateFamilyModal: function () {
    this.setData({ showCreateFamilyModal: false });
  },

  onNewFamilyNameInput: function (e) {
    this.setData({ newFamilyName: e.detail.value });
  },

  noop: function () {},

  onCommitCreateFamily: async function () {
    const name = this.data.newFamilyName.trim();
    if (!name) {
      toast.showToast(this, '请输入家庭名称', 'none');
      return;
    }
    toast.showLoading(this, '检查重名中...');
    try {
      const db = wx.cloud.database();
      
      // 检查是否重名
      const checkRes = await db.collection('families').where({ name }).get();
      if (checkRes.data.length > 0) {
        toast.showToast(this, '已存在同名家庭', 'none');
        return;
      }

      toast.showLoading(this, '创建中...');
      const openid = app.globalData.openid;
      const addRes = await db.collection('families').add({
        data: { name, creator_openid: openid, preferences: '', members_count: 1, created_at: db.serverDate() }
      });
      await db.collection('family_members').add({
        data: { family_id: addRes._id, openid, nickname: '管理员', role: 'admin', status: 'approved', created_at: db.serverDate() }
      });
      toast.showToast(this, '创建成功', 'success');
      this.setData({ showCreateFamilyModal: false });
      await this.fetchFamiliesList();
    } catch (err) {
      toast.showToast(this, '创建失败', 'error');
    } finally {
      toast.hideLoading(this);
    }
  },

  fetchMonthlyMenus: async function () {
    if (!this.data.activeFamily) return;
    const { currentYear, currentMonth, activeFamily, selectedDateStr } = this.data;
    const pad = n => String(n).padStart(2, '0');
    const startStr = `${currentYear}-${pad(currentMonth)}-01`;
    const endStr = `${currentYear}-${pad(currentMonth)}-31`;
    this.setData({ loading: true });
    try {
      const db = wx.cloud.database();
      
      // 分批获取当前月的所有菜单记录（小程序端单次获取上限 20 条，一个月最多 31 天需要获取）
      const MAX_LIMIT = 20;
      let monthMenusData = [];
      let skip = 0;
      let hasMore = true;
      
      while (hasMore) {
        const res = await db.collection('menus').where({
          family_id: activeFamily._id,
          date: db.command.gte(startStr).and(db.command.lte(endStr))
        })
        .skip(skip)
        .limit(MAX_LIMIT)
        .get();
        
        monthMenusData = monthMenusData.concat(res.data);
        if (res.data.length < MAX_LIMIT) {
          hasMore = false;
        } else {
          skip += MAX_LIMIT;
        }
      }

      let selectedDateMenuData = [];
      if (selectedDateStr) {
        const parts = selectedDateStr.split('-');
        if (parts.length === 3) {
          const selYear = parseInt(parts[0], 10);
          const selMonth = parseInt(parts[1], 10);
          if (selYear !== currentYear || selMonth !== currentMonth) {
            const resSel = await db.collection('menus').where({
              family_id: activeFamily._id,
              date: selectedDateStr
            }).get();
            selectedDateMenuData = resSel.data;
          }
        }
      }

      console.log('【数据库读取成功】月度菜单数据 monthMenusData:', monthMenusData);

      const menusMap = {};
      monthMenusData.forEach(m => { menusMap[m.date] = m; });
      selectedDateMenuData.forEach(m => { menusMap[m.date] = m; });

      this.setData({ monthlyMenus: menusMap });
      this.renderCalendarMenus();
      this.updateSelectedDateMenu();
    } catch (err) {
      console.error('获取月菜单失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },


  initCalendar: function () {
    const { currentYear, currentMonth } = this.data;
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
    const todayStr = this.formatDate(new Date());
    let days = [];
    const prevMonthDays = new Date(currentYear, currentMonth - 1, 0).getDate();
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({ day: prevMonthDays - i, isCurrentMonth: false, dateStr: '', hasMenu: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const pad = n => String(n).padStart(2, '0');
      const dateStr = `${currentYear}-${pad(currentMonth)}-${pad(d)}`;
      days.push({
        day: d, isCurrentMonth: true, dateStr,
        isToday: dateStr === todayStr,
        isSelected: dateStr === this.data.selectedDateStr,
        hasMenu: false
      });
    }
    this.setData({ days }, () => this.renderCalendarMenus());
  },

  renderCalendarMenus: function () {
    const { days, monthlyMenus } = this.data;
    const updated = days.map(day => {
      if (!day.isCurrentMonth) return day;
      const menu = monthlyMenus[day.dateStr];
      return { ...day, hasMenu: !!(menu && menu.dishes && menu.dishes.length > 0) };
    });
    this.setData({ days: updated });
  },

  updateSelectedDateMenu: function () {
    const { selectedDateStr, monthlyMenus } = this.data;
    const menu = monthlyMenus[selectedDateStr] || null;
    let parsedSimple = [];
    let parsedFull = [];
    if (menu && menu.shopping_list) {
      const parts = splitShoppingList(menu.shopping_list);
      parsedSimple = parseMarkdown(parts.simpleMd);
      parsedFull = parseMarkdown(parts.fullMd);
    }
    this.setData({ 
      selectedDateMenu: menu,
      parsedSimpleShoppingList: parsedSimple,
      parsedFullShoppingList: parsedFull
    });
  },

  onOpenShoppingDetails: function () {
    this.setData({ showShoppingDetailsModal: true });
  },

  onCloseShoppingDetails: function () {
    this.setData({ showShoppingDetailsModal: false });
  },

  onSelectDate: function (e) {
    const { datestr } = e.currentTarget.dataset;
    if (!datestr) return;
    const updated = this.data.days.map(day => ({ ...day, isSelected: day.dateStr === datestr }));
    this.setData({ selectedDateStr: datestr, days: updated }, () => this.updateSelectedDateMenu());
  },

  onChangeMonth: function (e) {
    const { direction } = e.currentTarget.dataset;
    let { currentYear, currentMonth } = this.data;
    if (direction === 'prev') {
      currentMonth--;
      if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    } else {
      currentMonth++;
      if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    }
    this.setData({ currentYear, currentMonth }, () => {
      this.initCalendar();
      this.fetchMonthlyMenus();
    });
  },

  onGoToEditMenu: function () {
    if (!this.data.activeFamily) {
      toast.showToast(this, '请先创建家庭', 'none'); return;
    }
    if (this.data.memberRole === 'read') {
      toast.showToast(this, '只读角色无法编辑菜单', 'none'); return;
    }
    wx.navigateTo({
      url: `/pages/edit-menu/index?date=${this.data.selectedDateStr}&familyId=${this.data.activeFamily._id}`
    });
  },

  onGenerateShoppingList: function () {
    if (!this.data.activeFamily || !this.data.selectedDateStr) return;
    
    const activeFamily = this.data.activeFamily;
    const aiConfig = activeFamily ? activeFamily.ai_config : null;
    if (!aiConfig || aiConfig.adults === undefined || aiConfig.adults === '') {
      this.setData({ showConfigPromptModal: true });
      return;
    }
    
    this.setData({ shoppingLoading: true });
    toast.showLoading(this, '正在智能分析食材...');
    wx.cloud.callFunction({
      name: 'llmService',
      data: {
        action: 'generateShoppingList',
        familyId: this.data.activeFamily._id,
        date: this.data.selectedDateStr
      },
      success: res => {
        this.setData({ shoppingLoading: false });
        toast.hideLoading(this);
        if (res.result && res.result.success && res.result.shoppingList) {
          const listText = res.result.shoppingList;
          const { selectedDateStr, monthlyMenus } = this.data;
          if (monthlyMenus[selectedDateStr]) {
            monthlyMenus[selectedDateStr].shopping_list = listText;
          } else {
            monthlyMenus[selectedDateStr] = {
              family_id: this.data.activeFamily._id,
              date: selectedDateStr,
              dishes: this.data.selectedDateMenu ? this.data.selectedDateMenu.dishes : [],
              shopping_list: listText
            };
          }
          let parsedSimple = [];
          let parsedFull = [];
          if (listText) {
            const parts = splitShoppingList(listText);
            parsedSimple = parseMarkdown(parts.simpleMd);
            parsedFull = parseMarkdown(parts.fullMd);
          }
          this.setData({ 
            monthlyMenus, 
            selectedDateMenu: monthlyMenus[selectedDateStr],
            parsedSimpleShoppingList: parsedSimple,
            parsedFullShoppingList: parsedFull
          });
          toast.showToast(this, '采购建议已生成', 'success');
        } else {
          toast.showToast(this, res.result?.message || '生成采购建议失败', 'none');
        }
      },
      fail: err => {
        this.setData({ shoppingLoading: false });
        toast.hideLoading(this);
        console.error('调用生成采购建议失败', err);
        toast.showToast(this, '生成失败，请重试', 'none');
      }
    });
  },



  formatDate: function (date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  onDeleteFamilyFromSwitcher: function (e) {
    const { familyId, familyName } = e.currentTarget.dataset;
    this.setData({
      showDeleteFamilyConfirm: true,
      deleteFamilyId: familyId,
      deleteFamilyName: familyName
    });
  },

  onCloseDeleteFamilyConfirm: function () {
    this.setData({ showDeleteFamilyConfirm: false, deleteFamilyId: '', deleteFamilyName: '' });
  },

  onCommitDeleteFamily: async function () {
    const { deleteFamilyId } = this.data;
    this.setData({ showDeleteFamilyConfirm: false });
    toast.showLoading(this, '正在删除...');
    try {
      const callRes = await wx.cloud.callFunction({
        name: 'adminService',
        data: {
          action: 'deleteFamily',
          familyId: deleteFamilyId
        }
      });
      
      if (callRes.result && callRes.result.success) {
        toast.showToast(this, '删除成功', 'success');
        // 重新拉取家庭列表并自动隐藏选择器
        this.setData({ showFamilySelector: false });
        await this.fetchFamiliesList();
      } else {
        toast.showToast(this, callRes.result.message || '删除失败', 'none');
      }
    } catch (err) {
      console.error('删除家庭失败', err);
      toast.showToast(this, '删除失败', 'none');
    } finally {
      toast.hideLoading(this);
    }
  },

  onClearTodayMenu: function () {
    this.setData({ showClearMenuConfirm: true });
  },

  onCloseClearMenuConfirm: function () {
    this.setData({ showClearMenuConfirm: false });
  },

  onCommitClearMenu: async function () {
    const { activeFamily, selectedDateStr } = this.data;
    this.setData({ showClearMenuConfirm: false });
    toast.showLoading(this, '正在清空...');
    try {
      const callRes = await wx.cloud.callFunction({
        name: 'menuService',
        data: {
          action: 'clearMenu',
          familyId: activeFamily._id,
          date: selectedDateStr
        }
      });
      
      if (callRes.result && callRes.result.success) {
        toast.showToast(this, '清空成功', 'success');
        // 重新拉取当月菜单以及今日菜单详情
        await this.fetchMonthlyMenus();
      } else {
        toast.showToast(this, callRes.result.message || '清空失败', 'none');
      }
    } catch (err) {
      console.error('清空菜单失败', err);
      toast.showToast(this, '清空失败', 'none');
    } finally {
      toast.hideLoading(this);
    }
  },

  onCloseConfigPrompt: function () {
    this.setData({ showConfigPromptModal: false });
  },

  onGoToConfig: function () {
    this.setData({ showConfigPromptModal: false });
    app.globalData.settingsSubpage = 'members';
    wx.switchTab({
      url: '/pages/admin-settings/index'
    });
  }
});
