// miniprogram/pages/edit-menu/index.js
const app = getApp();

Page({
  data: {
    loading: true,
    dateStr: '',
    familyId: '',
    isReadOnly: false,

    dishesList: [],
    customDishName: '',
    customDishCategory: '热菜',
    categoryIndex: 0,
    showCategoryPicker: false,
    categories: ['热菜', '凉菜', '汤品', '主食', '其它'],

    showRepositoryModal: false,
    repoDishes: [],
    filteredRepoDishes: [],
    searchKeyword: '',
    selectedRepoCategory: '全部',
    repoCategories: ['全部', '热菜', '凉菜', '汤品', '主食', '其它'],

    aiLoading: false,
    aiRecommendations: [],
    showAiPanel: false,
    saving: false
  },

  onLoad: async function (options) {
    const { date, familyId } = options;
    if (!date || !familyId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    const memberRole = app.globalData.memberRole || '';
    this.setData({
      dateStr: date,
      familyId,
      isReadOnly: memberRole === 'read',
      loading: true
    });
    try {
      await Promise.all([
        this.fetchCurrentMenu(),
        this.fetchRepositoryDishes()
      ]);
    } catch (err) {
      console.error('加载菜单页数据失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  fetchCurrentMenu: async function () {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('menus').where({
        family_id: this.data.familyId,
        date: this.data.dateStr
      }).get();
      if (res.data.length > 0) {
        this.setData({ dishesList: res.data[0].dishes || [] });
      }
    } catch (err) {
      console.error('获取菜谱失败', err);
    }
  },

  fetchRepositoryDishes: async function () {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('dishes').where({
        family_id: this.data.familyId
      }).limit(100).get();
      this.setData({ repoDishes: res.data, filteredRepoDishes: res.data });
    } catch (err) {
      console.error('获取收藏菜品失败', err);
    }
  },

  onCustomDishInput: function (e) {
    this.setData({ customDishName: e.detail.value });
  },

  onAddCustomDish: function () {
    const name = this.data.customDishName.trim();
    if (!name) { wx.showToast({ title: '请输入菜名', icon: 'none' }); return; }
    if (this.data.dishesList.some(d => d.name === name)) {
      wx.showToast({ title: '菜品已在今日计划中', icon: 'none' }); return;
    }
    this.setData({
      dishesList: [...this.data.dishesList, { name, category: this.data.customDishCategory }],
      customDishName: ''
    });
  },

  onRemoveDish: function (e) {
    const { index } = e.currentTarget.dataset;
    const list = [...this.data.dishesList];
    list.splice(index, 1);
    this.setData({ dishesList: list });
  },

  onToggleCategoryPicker: function () {
    this.setData({ showCategoryPicker: !this.data.showCategoryPicker });
  },
  onCloseCategoryPicker: function () {
    this.setData({ showCategoryPicker: false });
  },
  onSelectCategory: function (e) {
    const idx = e.currentTarget.dataset.index;
    this.onCategoryChange({ detail: { value: idx } });
    this.setData({ showCategoryPicker: false });
  },

  onCategoryChange: function (e) {
    const idx = parseInt(e.detail.value);
    this.setData({ categoryIndex: idx, customDishCategory: this.data.categories[idx] });
  },

  onOpenRepository: function () {
    this.setData({ showRepositoryModal: true, searchKeyword: '', selectedRepoCategory: '全部' });
    this.filterRepoDishes();
  },

  onCloseRepository: function () {
    this.setData({ showRepositoryModal: false });
  },

  onSearchInput: function (e) {
    this.setData({ searchKeyword: e.detail.value }, () => this.filterRepoDishes());
  },

  onSelectCategoryFilter: function (e) {
    this.setData({ selectedRepoCategory: e.currentTarget.dataset.category }, () => this.filterRepoDishes());
  },

  filterRepoDishes: function () {
    let filtered = this.data.repoDishes;
    if (this.data.selectedRepoCategory !== '全部') {
      filtered = filtered.filter(d => d.category === this.data.selectedRepoCategory);
    }
    if (this.data.searchKeyword.trim()) {
      const kw = this.data.searchKeyword.toLowerCase();
      filtered = filtered.filter(d => d.name.toLowerCase().includes(kw));
    }
    this.setData({ filteredRepoDishes: filtered });
  },

  onAddRepoDish: function (e) {
    const { dish } = e.currentTarget.dataset;
    if (this.data.dishesList.some(d => d.name === dish.name)) {
      wx.showToast({ title: '该菜已加入', icon: 'none' }); return;
    }
    this.setData({
      dishesList: [...this.data.dishesList, { name: dish.name, category: dish.category, id: dish._id }]
    });
    wx.showToast({ title: '添加成功', icon: 'success', duration: 800 });
  },

  // 复制昨日菜单
  onCopyYesterdayMenu: async function () {
    const today = new Date(this.data.dateStr);
    const yesterday = new Date(today.getTime() - 86400000);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');
    const yDateStr = `${y}-${m}-${d}`;
    wx.showLoading({ title: '获取中...' });
    try {
      const db = wx.cloud.database();
      const res = await db.collection('menus').where({
        family_id: this.data.familyId, date: yDateStr
      }).get();
      if (res.data.length > 0 && res.data[0].dishes && res.data[0].dishes.length > 0) {
        this.setData({ dishesList: res.data[0].dishes });
        wx.showToast({ title: '复制成功', icon: 'success' });
      } else {
        wx.showToast({ title: '昨日无菜单可复制', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: '获取失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 清空菜单
  onClearMenu: function () {
    wx.showModal({
      title: '确认清空',
      content: '确定要清空今日菜单吗？',
      confirmColor: '#E53935',
      success: res => {
        if (res.confirm) this.setData({ dishesList: [] });
      }
    });
  },

  // AI 推荐
  onCallAIRecommend: function () {
    this.setData({ aiLoading: true });
    wx.showLoading({ title: 'AI 智能配餐中...', mask: true });
    wx.cloud.callFunction({
      name: 'llmService',
      data: { action: 'recommendToday', familyId: this.data.familyId, date: this.data.dateStr },
      success: res => {
        wx.hideLoading();
        this.setData({ aiLoading: false });
        if (res.result && res.result.success && res.result.recommendations) {
          const recs = res.result.recommendations;
          const merged = [...this.data.dishesList];
          recs.forEach(d => {
            if (!merged.some(x => x.name === d.name)) {
              merged.push({ name: d.name, category: d.category || '热菜' });
            }
          });
          this.setData({ dishesList: merged });
          wx.showToast({ title: '已应用 AI 推荐', icon: 'success' });
        } else {
          console.error('AI 推荐失败:', res.result ? res.result.message : '无返回消息');
          wx.showToast({ title: (res.result && res.result.message) || '推荐失败，请重试', icon: 'none' });
        }
      },
      fail: err => {
        wx.hideLoading();
        this.setData({ aiLoading: false });
        console.error('调用 AI 推荐失败', err);
        wx.showToast({ title: 'AI 服务异常，请确认 API 配置', icon: 'none' });
      }
    });
  },

  onSaveMenu: function () {
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    wx.cloud.callFunction({
      name: 'menuService',
      data: {
        action: 'saveMenu',
        familyId: this.data.familyId,
        date: this.data.dateStr,
        dishes: this.data.dishesList
      },
      success: res => {
        if (res.result && res.result.success) {
          wx.showToast({ title: '保存成功', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 1000);
        } else {
          wx.showToast({ title: res.result.message || '保存失败', icon: 'none' });
        }
      },
      fail: err => {
        console.error('保存菜单网络异常', err);
        wx.showToast({ title: '网络异常，保存失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ saving: false });
        wx.hideLoading();
      }
    });
  },

  noop: function () {}
});
