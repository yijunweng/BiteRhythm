// miniprogram/pages/index/index.js
const app = getApp();

Page({
  data: {
    // 权限与身份
    isSystemAdmin: false,
    memberRole: '', // 'admin' | 'write' | 'read' | ''
    
    // 家庭列表及当前选中
    families: [],
    activeFamily: null,
    showFamilySelector: false,
    
    // 日历相关
    currentYear: 0,
    currentMonth: 0, // 1-12
    days: [],        // { dateStr: '2026-06-01', day: 1, isToday: false, isSelected: false, hasMenu: false, dishesSummary: '' }
    selectedDateStr: '', // 格式: 'yyyy-MM-dd'
    selectedDateMenu: null, // 当天菜谱
    
    // 菜单缓存 (以日期为key)
    monthlyMenus: {}, 
    
    loading: false
  },

  onLoad: function (options) {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1; // 1-indexed
    const dayStr = this.formatDate(today);

    this.setData({
      currentYear: year,
      currentMonth: month,
      selectedDateStr: dayStr
    });

    // 等待 app.js 登录成功
    if (app.globalData.hasCheckedAuth) {
      this.initUserAndData();
    } else {
      app.authCallback = () => {
        this.initUserAndData();
      };
    }
  },

  onShow: function () {
    if (app.globalData.hasCheckedAuth && this.data.activeFamily) {
      // 每次页面显示，刷新当前月菜单和选中日菜单，保证协同更新
      this.fetchMonthlyMenus();
      this.fetchUserRoleInFamily();
    }
  },

  // 初始化用户权限和家庭列表
  initUserAndData: async function() {
    this.setData({
      isSystemAdmin: app.globalData.isSystemAdmin
    });
    
    await this.fetchFamiliesList();
    this.initCalendar();
  },

  // 获取该用户的家庭列表
  fetchFamiliesList: async function() {
    this.setData({ loading: true });
    try {
      // 从云函数或云数据库拉取
      const db = wx.cloud.database();
      const openid = app.globalData.openid;
      
      // 1. 先查用户作为成员加入的家庭
      const memberRes = await db.collection('family_members')
        .where({
          openid: openid,
          status: 'approved'
        }).get();
      
      const familyIds = memberRes.data.map(m => m.family_id);
      
      let families = [];
      if (familyIds.length > 0) {
        const familyRes = await db.collection('families')
          .where({
            _id: db.command.in(familyIds)
          }).get();
        families = familyRes.data;
      }
      
      // 2. 查用户自己创建的家庭 (如果没在成员表里)
      const ownRes = await db.collection('families')
        .where({
          creator_openid: openid
        }).get();
      
      // 合并去重
      ownRes.data.forEach(fam => {
        if (!families.find(f => f._id === fam._id)) {
          families.push(fam);
        }
      });

      this.setData({ families });

      // 如果有家庭，默认选择第一个或缓存的家庭
      if (families.length > 0) {
        let lastFamilyId = wx.getStorageSync('last_family_id');
        let selected = families.find(f => f._id === lastFamilyId) || families[0];
        
        this.selectFamily(selected);
      } else {
        this.setData({ activeFamily: null });
      }
    } catch (err) {
      console.error('获取家庭列表失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  // 切换选中家庭
  selectFamily: function(family) {
    app.globalData.activeFamily = family;
    wx.setStorageSync('last_family_id', family._id);
    
    this.setData({
      activeFamily: family,
      showFamilySelector: false
    });
    
    this.fetchUserRoleInFamily();
    this.fetchMonthlyMenus();
  },

  // 获取用户在当前家庭的角色
  fetchUserRoleInFamily: async function() {
    if (!this.data.activeFamily) return;
    const db = wx.cloud.database();
    const openid = app.globalData.openid;
    
    try {
      // 1. 如果是创建者，默认是 admin
      if (this.data.activeFamily.creator_openid === openid) {
        this.setData({ memberRole: 'admin' });
        app.globalData.memberRole = 'admin';
        return;
      }
      
      // 2. 否则查成员关系表
      const res = await db.collection('family_members')
        .where({
          family_id: this.data.activeFamily._id,
          openid: openid
        }).get();
        
      if (res.data.length > 0) {
        const role = res.data[0].role;
        this.setData({ memberRole: role });
        app.globalData.memberRole = role;
      } else {
        this.setData({ memberRole: '' });
        app.globalData.memberRole = '';
      }
    } catch(err) {
      console.error('获取用户角色失败', err);
    }
  },

  // 创建新家庭
  onCreateFamily: function() {
    const that = this;
    wx.showModal({
      title: '创建新家庭',
      placeholderText: '请输入家庭名称，如“温馨小家”',
      editable: true,
      success: async (res) => {
        if (res.confirm && res.content.trim()) {
          const name = res.content.trim();
          wx.showLoading({ title: '创建中' });
          try {
            const db = wx.cloud.database();
            const openid = app.globalData.openid;
            
            // 写入 families 表
            const addRes = await db.collection('families').add({
              data: {
                name: name,
                creator_openid: openid,
                preferences: '',
                members_count: 1,
                created_at: db.serverDate()
              }
            });

            // 写入 family_members 表作为 admin
            await db.collection('family_members').add({
              data: {
                family_id: addRes._id,
                openid: openid,
                nickname: '创建者',
                role: 'admin',
                status: 'approved',
                created_at: db.serverDate()
              }
            });

            wx.showToast({ title: '创建成功', icon: 'success' });
            await that.fetchFamiliesList();
          } catch(err) {
            console.error('创建家庭失败', err);
            wx.showToast({ title: '创建失败', icon: 'error' });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  },

  // 获取选中月的菜单列表
  fetchMonthlyMenus: async function() {
    if (!this.data.activeFamily) return;
    
    const { currentYear, currentMonth, activeFamily } = this.data;
    const startStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const endStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-31`; // 简化范围
    
    this.setData({ loading: true });
    try {
      const db = wx.cloud.database();
      const res = await db.collection('menus')
        .where({
          family_id: activeFamily._id,
          date: db.command.gte(startStr).and(db.command.lte(endStr))
        }).get();
      
      const menusMap = {};
      res.data.forEach(menu => {
        menusMap[menu.date] = menu;
      });
      
      this.setData({
        monthlyMenus: menusMap
      });
      
      this.renderCalendarMenus();
      this.updateSelectedDateMenu();
    } catch (err) {
      console.error('获取月菜单数据失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  // 初始化日历骨架
  initCalendar: function() {
    const { currentYear, currentMonth } = this.data;
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const firstDayIndex = new Date(currentYear, currentMonth - 1, 1).getDay(); // 0 是周日

    const today = new Date();
    const todayStr = this.formatDate(today);

    let days = [];
    
    // 补齐月初空白
    const prevMonthDays = new Date(currentYear, currentMonth - 1, 0).getDate();
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      // 仅用作占位或弱化显示
      days.push({
        day: prevMonthDays - i,
        isCurrentMonth: false,
        dateStr: ''
      });
    }

    // 填充当月日期
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        day: d,
        isCurrentMonth: true,
        dateStr: dateStr,
        isToday: dateStr === todayStr,
        isSelected: dateStr === this.data.selectedDateStr,
        hasMenu: false,
        dishesSummary: ''
      });
    }

    this.setData({ days }, () => {
      this.renderCalendarMenus();
    });
  },

  // 将菜单数据映射到日历格子中
  renderCalendarMenus: function() {
    const { days, monthlyMenus } = this.data;
    const updatedDays = days.map(day => {
      if (!day.isCurrentMonth) return day;
      const menu = monthlyMenus[day.dateStr];
      return {
        ...day,
        hasMenu: !!(menu && menu.dishes && menu.dishes.length > 0),
        dishesSummary: menu ? menu.dishes.map(d => d.name).join('+') : ''
      };
    });
    this.setData({ days: updatedDays });
  },

  // 刷新当前选中的日期的菜单卡片
  updateSelectedDateMenu: function() {
    const { selectedDateStr, monthlyMenus } = this.data;
    this.setData({
      selectedDateMenu: monthlyMenus[selectedDateStr] || null
    });
  },

  // 点击选中日期
  onSelectDate: function(e) {
    const { datestr } = e.currentTarget.dataset;
    if (!datestr) return; // 点击了非本月占位符

    const updatedDays = this.data.days.map(day => ({
      ...day,
      isSelected: day.dateStr === datestr
    }));

    this.setData({
      selectedDateStr: datestr,
      days: updatedDays
    }, () => {
      this.updateSelectedDateMenu();
    });
  },

  // 切换月份
  onChangeMonth: function(e) {
    const { direction } = e.currentTarget.dataset; // 'prev' | 'next'
    let { currentYear, currentMonth } = this.data;
    
    if (direction === 'prev') {
      currentMonth--;
      if (currentMonth < 1) {
        currentMonth = 12;
        currentYear--;
      }
    } else {
      currentMonth++;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
      }
    }

    this.setData({
      currentYear,
      currentMonth
    }, () => {
      this.initCalendar();
      this.fetchMonthlyMenus();
    });
  },

  // 跳转到修改菜单页面
  onGoToEditMenu: function() {
    if (!this.data.activeFamily) {
      wx.showToast({ title: '请先创建或选择一个家庭', icon: 'none' });
      return;
    }
    // 只读权限拦截跳转 (或在页面内拦截，这里先提示)
    if (this.data.memberRole === 'read') {
      wx.showToast({ title: '阿姨角色仅有只读权限，无法编辑', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/pages/edit-menu/index?date=${this.data.selectedDateStr}&familyId=${this.data.activeFamily._id}`
    });
  },

  // 导航跳转
  onNavigate: function(e) {
    const { page } = e.currentTarget.dataset;
    
    if (page === 'admin-settings' && !this.data.isSystemAdmin) {
      wx.showToast({ title: '仅超级管理员可配置系统', icon: 'none' });
      return;
    }
    
    if (!this.data.activeFamily && page !== 'admin-settings') {
      wx.showToast({ title: '请先创建家庭', icon: 'none' });
      return;
    }

    let url = `/pages/${page}/index`;
    if (this.data.activeFamily) {
      url += `?familyId=${this.data.activeFamily._id}`;
    }
    
    wx.navigateTo({ url });
  },

  toggleFamilySelector: function() {
    this.setData({
      showFamilySelector: !this.data.showFamilySelector
    });
  },

  // 辅助函数：格式化 Date
  formatDate: function(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
});
