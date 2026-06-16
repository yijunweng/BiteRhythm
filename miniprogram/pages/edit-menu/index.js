// miniprogram/pages/edit-menu/index.js
const app = getApp();

Page({
  data: {
    dateStr: '',
    familyId: '',
    
    // 当前规划的菜品列表
    dishesList: [],
    
    // 手动添加输入框内容
    customDishName: '',
    customDishCategory: '热菜',
    categories: ['热菜', '凉菜', '汤品', '主食', '其它'],
    
    // 从菜品库中选择的弹窗
    showRepositoryModal: false,
    repoDishes: [], // 库中所有菜品
    filteredRepoDishes: [],
    searchKeyword: '',
    selectedRepoCategory: '全部',
    
    // AI 推荐相关
    aiLoading: false,
    aiRecommendations: [], // AI 推荐的菜品列表 [{ name, category, reason }]
    showAiPanel: false,
    
    saving: false
  },

  onLoad: function (options) {
    const { date, familyId } = options;
    if (!date || !familyId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.setData({
      dateStr: date,
      familyId: familyId
    });

    this.fetchCurrentMenu();
    this.fetchRepositoryDishes();
  },

  // 获取该日期已有的菜单
  fetchCurrentMenu: async function() {
    wx.showLoading({ title: '加载中...' });
    try {
      const db = wx.cloud.database();
      const res = await db.collection('menus')
        .where({
          family_id: this.data.familyId,
          date: this.data.dateStr
        }).get();
        
      if (res.data.length > 0) {
        this.setData({
          dishesList: res.data[0].dishes || []
        });
      }
    } catch(err) {
      console.error('获取菜谱失败', err);
    } finally {
      wx.hideLoading();
    }
  },

  // 获取该家庭已收藏的菜品库
  fetchRepositoryDishes: async function() {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('dishes')
        .where({
          family_id: this.data.familyId
        }).limit(100).get();
        
      this.setData({
        repoDishes: res.data,
        filteredRepoDishes: res.data
      });
    } catch(err) {
      console.error('获取收藏菜品失败', err);
    }
  },

  // 快捷添加自定义菜品
  onAddCustomDish: function() {
    const dishName = this.data.customDishName.trim();
    if (!dishName) {
      wx.showToast({ title: '请输入菜名', icon: 'none' });
      return;
    }

    // 检查重复
    if (this.data.dishesList.some(d => d.name === dishName)) {
      wx.showToast({ title: '菜品已在今日计划中', icon: 'none' });
      return;
    }

    const newList = [...this.data.dishesList, {
      name: dishName,
      category: this.data.customDishCategory
    }];

    this.setData({
      dishesList: newList,
      customDishName: ''
    });
  },

  // 删除某道已加的菜
  onRemoveDish: function(e) {
    const { index } = e.currentTarget.dataset;
    const newList = [...this.data.dishesList];
    newList.splice(index, 1);
    this.setData({ dishesList: newList });
  },

  // 唤起收藏库选择弹窗
  onOpenRepository: function() {
    this.setData({
      showRepositoryModal: true,
      searchKeyword: '',
      selectedRepoCategory: '全部'
    });
    this.filterRepoDishes();
  },

  onCloseRepository: function() {
    this.setData({ showRepositoryModal: false });
  },

  // 搜索和过滤库中菜品
  onSearchInput: function(e) {
    this.setData({
      searchKeyword: e.detail.value
    }, () => {
      this.filterRepoDishes();
    });
  },

  onSelectCategoryFilter: function(e) {
    this.setData({
      selectedRepoCategory: e.currentTarget.dataset.category
    }, () => {
      this.filterRepoDishes();
    });
  },

  filterRepoDishes: function() {
    const { repoDishes, searchKeyword, selectedRepoCategory } = this.data;
    let filtered = repoDishes;

    if (selectedRepoCategory !== '全部') {
      filtered = filtered.filter(d => d.category === selectedRepoCategory);
    }

    if (searchKeyword.trim()) {
      const kw = searchKeyword.toLowerCase();
      filtered = filtered.filter(d => d.name.toLowerCase().includes(kw));
    }

    this.setData({ filteredRepoDishes: filtered });
  },

  // 选择库中菜品加入到当日菜单
  onAddRepoDish: function(e) {
    const { dish } = e.currentTarget.dataset;
    if (this.data.dishesList.some(d => d.name === dish.name)) {
      wx.showToast({ title: '该菜已加入', icon: 'none' });
      return;
    }

    this.setData({
      dishesList: [...this.data.dishesList, {
        name: dish.name,
        category: dish.category,
        id: dish._id
      }]
    });
    wx.showToast({ title: '添加成功', icon: 'success', duration: 800 });
  },

  // AI 智能排餐推荐
  onCallAIRecommend: function() {
    this.setData({
      aiLoading: true,
      showAiPanel: true,
      aiRecommendations: []
    });

    wx.cloud.callFunction({
      name: 'llmService',
      data: {
        action: 'recommendToday',
        familyId: this.data.familyId,
        date: this.data.dateStr
      },
      success: res => {
        if (res.result && res.result.success) {
          this.setData({
            aiRecommendations: res.result.recommendations || []
          });
        } else {
          wx.showToast({ title: res.result.message || '推荐失败，请重试', icon: 'none' });
        }
      },
      fail: err => {
        console.error('调用 AI 推荐失败', err);
        wx.showToast({ title: '服务异常，请确认系统设置中的 API 配置', icon: 'none' });
      },
      complete: () => {
        this.setData({ aiLoading: false });
      }
    });
  },

  // 应用 AI 推荐的菜品
  onApplyAiRecommend: function() {
    if (this.data.aiRecommendations.length === 0) return;
    
    // 合并当前与 AI 推荐的菜品（去重）
    const merged = [...this.data.dishesList];
    this.data.aiRecommendations.forEach(aiDish => {
      if (!merged.some(d => d.name === aiDish.name)) {
        merged.push({
          name: aiDish.name,
          category: aiDish.category || '热菜'
        });
      }
    });

    this.setData({
      dishesList: merged,
      showAiPanel: false
    });
    
    wx.showToast({ title: '已应用 AI 推荐', icon: 'success' });
  },

  // 类别选择更改
  onCategoryChange: function(e) {
    this.setData({
      customDishCategory: this.data.categories[e.detail.value]
    });
  },

  // 保存今日菜单
  onSaveMenu: function() {
    const that = this;
    
    this.setData({ saving: true });
    wx.showLoading({ title: '正在保存...' });
    
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
          setTimeout(() => {
            wx.navigateBack();
          }, 1000);
        } else {
          wx.showToast({ title: res.result.message || '保存失败', icon: 'none' });
        }
      },
      fail: err => {
        console.error('保存失败', err);
        wx.showToast({ title: '网络异常，保存失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ saving: false });
        wx.hideLoading();
      }
    });
  }
});
