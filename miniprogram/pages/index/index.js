// miniprogram/pages/index/index.js
const app = getApp();

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
    aiPlanLoading: false,
    showCreateFamilyModal: false,
    newFamilyName: ''
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
    if (app.globalData.hasCheckedAuth && this.data.activeFamily) {
      this.fetchMonthlyMenus();
      this.fetchUserRoleInFamily();
    }
  },

  onPullDownRefresh: async function () {
    if (this.data.activeFamily) {
      await this.fetchMonthlyMenus();
    }
    wx.stopPullDownRefresh();
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

      const memberRes = await db.collection('family_members')
        .where({ openid, status: 'approved' }).get();
      const familyIds = memberRes.data.map(m => m.family_id);

      let families = [];
      if (familyIds.length > 0) {
        const r = await db.collection('families')
          .where({ _id: db.command.in(familyIds) }).get();
        families = r.data;
      }

      const ownRes = await db.collection('families')
        .where({ creator_openid: openid }).get();
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
    wx.showLoading({ title: '切换中...' });
    try {
      await this.selectFamily(e.currentTarget.dataset.family);
    } catch (err) {
      console.error('选择家庭失败', err);
    } finally {
      wx.hideLoading();
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
      wx.showToast({ title: '请输入家庭名称', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '检查重名中...' });
    try {
      const db = wx.cloud.database();
      
      // 检查是否重名
      const checkRes = await db.collection('families').where({ name }).get();
      if (checkRes.data.length > 0) {
        wx.showToast({ title: '已存在同名家庭', icon: 'none' });
        return;
      }

      wx.showLoading({ title: '创建中' });
      const openid = app.globalData.openid;
      const addRes = await db.collection('families').add({
        data: { name, creator_openid: openid, preferences: '', members_count: 1, created_at: db.serverDate() }
      });
      await db.collection('family_members').add({
        data: { family_id: addRes._id, openid, nickname: '管理员', role: 'admin', status: 'approved', created_at: db.serverDate() }
      });
      wx.showToast({ title: '创建成功', icon: 'success' });
      this.setData({ showCreateFamilyModal: false });
      await this.fetchFamiliesList();
    } catch (err) {
      wx.showToast({ title: '创建失败', icon: 'error' });
    } finally {
      wx.hideLoading();
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
      
      const monthQuery = db.collection('menus').where({
        family_id: activeFamily._id,
        date: db.command.gte(startStr).and(db.command.lte(endStr))
      }).get();

      let selectedDateQuery = null;
      if (selectedDateStr) {
        const parts = selectedDateStr.split('-');
        if (parts.length === 3) {
          const selYear = parseInt(parts[0], 10);
          const selMonth = parseInt(parts[1], 10);
          if (selYear !== currentYear || selMonth !== currentMonth) {
            selectedDateQuery = db.collection('menus').where({
              family_id: activeFamily._id,
              date: selectedDateStr
            }).get();
          }
        }
      }

      const queries = [monthQuery, selectedDateQuery].filter(Boolean);
      const results = await Promise.all(queries);
      
      const resMonth = results[0];
      const resSel = results[1];

      console.log('【数据库读取成功】月度菜单数据 resMonth.data:', resMonth.data);
      if (resSel) {
        console.log('【数据库读取成功】选中日期菜单数据 resSel.data:', resSel.data);
      }

      const menusMap = {};
      resMonth.data.forEach(m => { menusMap[m.date] = m; });
      if (resSel && resSel.data) {
        resSel.data.forEach(m => { menusMap[m.date] = m; });
      }

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
    this.setData({ selectedDateMenu: monthlyMenus[selectedDateStr] || null });
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
      wx.showToast({ title: '请先创建家庭', icon: 'none' }); return;
    }
    if (this.data.memberRole === 'read') {
      wx.showToast({ title: '只读角色无法编辑菜单', icon: 'none' }); return;
    }
    wx.navigateTo({
      url: `/pages/edit-menu/index?date=${this.data.selectedDateStr}&familyId=${this.data.activeFamily._id}`
    });
  },

  // AI 一键智能周排餐
  onWeekAIPlan: async function () {
    if (!this.data.activeFamily) return;
    this.setData({ aiPlanLoading: true });
    
    // 获取下周5个工作日
    const today = new Date();
    const dates = [];
    for (let i = 1; i <= 7 && dates.length < 5; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const day = d.getDay();
      if (day >= 1 && day <= 5) dates.push(this.formatDate(d));
    }
    
    let successCount = 0;
    const total = dates.length;
    
    for (let i = 0; i < total; i++) {
      const date = dates[i];
      wx.showLoading({ title: `AI排餐中 ${i + 1}/${total}` });
      
      try {
        const res = await wx.cloud.callFunction({
          name: 'llmService',
          data: { action: 'recommendToday', familyId: this.data.activeFamily._id, date }
        });
        
        console.log(`AI 推荐 ${date} 返回结果:`, res);
        
        if (res.result && res.result.success && res.result.recommendations) {
          const dishes = res.result.recommendations;
          const saveRes = await wx.cloud.callFunction({
            name: 'menuService',
            data: { action: 'saveMenu', familyId: this.data.activeFamily._id, date, dishes }
          });
          
          if (saveRes.result && saveRes.result.success) {
            successCount++;
            console.log(`【数据库保存成功】${date} 菜单已成功保存`, saveRes);
          } else {
            console.error(`保存 ${date} 菜单失败, 返回内容:`, saveRes);
          }
        } else {
          console.error(`AI 推荐 ${date} 菜谱失败, 返回内容:`, res);
        }
      } catch (err) {
        console.error(`排餐 ${date} 发生异常:`, err);
      }
    }

    this.finishWeekAIPlan(successCount, total);
  },

  finishWeekAIPlan: function (successCount, total) {
    this.setData({ aiPlanLoading: false });
    wx.hideLoading();
    if (successCount > 0) {
      wx.showToast({ title: `🤖 已排 ${successCount}/${total} 天菜谱`, icon: 'success' });
    } else {
      wx.showToast({ title: 'AI 排餐失败，请检查配置', icon: 'none' });
    }
    this.fetchMonthlyMenus();
  },

  formatDate: function (date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  onDeleteFamilyFromSwitcher: function (e) {
    const { familyId, familyName } = e.currentTarget.dataset;
    
    // 由于是主页组件，直接检测该用户是否是这个家庭的管理员
    // 注意：这里的删除在云函数端也会做超级管理员权限或者该家庭管理员 role === 'admin' 权限的安全校验。
    wx.showModal({
      title: '确认删除家庭',
      content: `确定要解散并删除家庭「${familyName}」吗？此操作将永久清除该家庭下的所有成员、菜品及排餐记录，且无法恢复！`,
      confirmColor: '#E53935',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '正在删除...' });
          try {
            const callRes = await wx.cloud.callFunction({
              name: 'adminService',
              data: {
                action: 'deleteFamily',
                familyId: familyId
              }
            });
            
            if (callRes.result && callRes.result.success) {
              wx.showToast({ title: '删除成功', icon: 'success' });
              // 重新拉取家庭列表并自动隐藏选择器
              this.setData({ showFamilySelector: false });
              await this.fetchFamiliesList();
            } else {
              wx.showToast({ title: callRes.result.message || '删除失败', icon: 'none' });
            }
          } catch (err) {
            console.error('删除家庭失败', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  }
});
