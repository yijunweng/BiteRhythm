// miniprogram/pages/edit-menu/index.js
const app = getApp();
const { toast } = require('../../utils/toast.js');

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
    saving: false,
    showClearConfirm: false,
    syncShoppingList: false,
    showConfigPromptModal: false,
    showSufficientModal: false,
    sufficientReason: '',
    showEmptySaveConfirm: false,
    toastData: { show: false, type: 'none', title: '' }
  },

  onLoad: async function (options) {
    const { date, familyId } = options;
    if (!date || !familyId) {
      toast.showToast(this, '参数错误', 'none');
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    const memberRole = app.globalData.memberRole || '';
    const syncShoppingList = wx.getStorageSync('sync_shopping_list') || false;
    this.setData({
      dateStr: date,
      familyId,
      isReadOnly: memberRole === 'read',
      syncShoppingList,
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
      const MAX_LIMIT = 20;
      let allDishes = [];
      let skip = 0;
      let hasMore = true;

      while (hasMore) {
        const res = await db.collection('dishes')
          .where({ family_id: this.data.familyId })
          .skip(skip)
          .limit(MAX_LIMIT)
          .get();
        
        allDishes = allDishes.concat(res.data);
        if (res.data.length < MAX_LIMIT) {
          hasMore = false;
        } else {
          skip += MAX_LIMIT;
        }
      }

      this.setData({ repoDishes: allDishes, filteredRepoDishes: allDishes });
    } catch (err) {
      console.error('获取收藏菜品失败', err);
    }
  },

  onCustomDishInput: function (e) {
    this.setData({ customDishName: e.detail.value });
  },

  onAddCustomDish: function () {
    const name = this.data.customDishName.trim();
    if (!name) { toast.showToast(this, '请输入菜名', 'none'); return; }
    if (this.data.dishesList.some(d => d.name === name)) {
      toast.showToast(this, '菜品已在今日计划中', 'none'); return;
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
    const index = this.data.dishesList.findIndex(d => d.name === dish.name);
    if (index > -1) {
      const list = [...this.data.dishesList];
      list.splice(index, 1);
      this.setData({ dishesList: list });
    } else {
      this.setData({
        dishesList: [...this.data.dishesList, { name: dish.name, category: dish.category, id: dish._id }]
      });
    }
  },

  // 复制昨日菜单
  onCopyYesterdayMenu: async function () {
    const today = new Date(this.data.dateStr);
    const yesterday = new Date(today.getTime() - 86400000);
    const y = yesterday.getFullYear();
    const m = String(yesterday.getMonth() + 1).padStart(2, '0');
    const d = String(yesterday.getDate()).padStart(2, '0');
    const yDateStr = `${y}-${m}-${d}`;
    toast.showLoading(this, '获取中...');
    try {
      const db = wx.cloud.database();
      const res = await db.collection('menus').where({
        family_id: this.data.familyId, date: yDateStr
      }).get();
      if (res.data.length > 0 && res.data[0].dishes && res.data[0].dishes.length > 0) {
        this.setData({ dishesList: res.data[0].dishes });
        toast.showToast(this, '复制成功', 'success');
      } else {
        toast.showToast(this, '昨日无菜单可复制', 'none');
      }
    } catch (err) {
      toast.showToast(this, '获取失败', 'none');
    } finally {
      toast.hideLoading(this);
    }
  },

  // 清空菜单
  onClearMenu: function () {
    this.setData({ showClearConfirm: true });
  },

  onCloseClearConfirm: function () {
    this.setData({ showClearConfirm: false });
  },

  onCommitClearMenu: function () {
    this.setData({ dishesList: [], showClearConfirm: false });
  },

  // AI 推荐
  onCallAIRecommend: function (opt) {
    const forceReplan = opt === true;
    const activeFamily = app.globalData.activeFamily;
    const aiConfig = activeFamily ? activeFamily.ai_config : null;
    if (!aiConfig || aiConfig.adults === undefined || aiConfig.adults === '') {
      this.setData({ showConfigPromptModal: true });
      return;
    }

    const existingDishes = this.data.dishesList || [];
    const formattedExisting = existingDishes.map(d => ({ name: d.name, category: d.category || '热菜' }));

    this.setData({ aiLoading: true });
    toast.showLoading(this, 'AI 智能配餐中...');
    wx.cloud.callFunction({
      name: 'llmService',
      data: { 
        action: 'recommendToday', 
        familyId: this.data.familyId, 
        date: this.data.dateStr,
        existingDishes: formattedExisting,
        forceReplan: forceReplan
      },
      success: res => {
        this.setData({ aiLoading: false });
        toast.hideLoading(this);
        if (res.result && res.result.success) {
          const status = res.result.status || 'complementary';
          const recs = res.result.recommendations || [];
          
          if (status === 'sufficient') {
            this.setData({
              showSufficientModal: true,
              sufficientReason: res.result.reason || '当前所选菜品已足够，是否需要重新搭配？'
            });
            return;
          }

          if (forceReplan) {
            this.setData({ dishesList: recs });
            toast.showToast(this, '已为您重新搭配整餐', 'success');
          } else {
            if (recs.length === 0) {
              toast.showToast(this, '当前已选分量合适，未发现需要补充的菜品', 'none');
              return;
            }
            const merged = [...this.data.dishesList];
            let addedCount = 0;
            recs.forEach(d => {
              if (!merged.some(x => x.name === d.name)) {
                merged.push({ name: d.name, category: d.category || '热菜' });
                addedCount++;
              }
            });
            this.setData({ dishesList: merged });
            if (addedCount > 0) {
              toast.showToast(this, `已为您补充推荐 ${addedCount} 道搭配菜品`, 'success');
            } else {
              toast.showToast(this, 'AI 推荐菜品已存在于当前菜单中', 'none');
            }
          }
        } else {
          console.error('AI 推荐失败:', res.result ? res.result.message : '无返回消息');
          toast.showToast(this, (res.result && res.result.message) || '推荐失败，请重试', 'none');
        }
      },
      fail: err => {
        this.setData({ aiLoading: false });
        toast.hideLoading(this);
        console.error('调用 AI 推荐失败', err);
        toast.showToast(this, 'AI 服务异常，请确认 API 配置', 'none');
      }
    });
  },

  onToggleSyncShoppingList: function (e) {
    const value = e.detail.value;
    this.setData({ syncShoppingList: value });
    wx.setStorageSync('sync_shopping_list', value);
  },

  onSaveMenu: function () {
    if (!this.data.dishesList || this.data.dishesList.length === 0) {
      this.setData({ showEmptySaveConfirm: true });
      return;
    }
    this.executeSaveMenu();
  },

  executeSaveMenu: function () {
    this.setData({ saving: true });
    toast.showLoading(this, '保存中...');
    wx.cloud.callFunction({
      name: 'menuService',
      data: {
        action: 'saveMenu',
        familyId: this.data.familyId,
        date: this.data.dateStr,
        dishes: this.data.dishesList
      },
      success: async res => {
        if (res.result && res.result.success) {
          if (this.data.syncShoppingList && this.data.dishesList.length > 0) {
            toast.showLoading(this, '正在生成采购建议...');
            try {
              const shopRes = await wx.cloud.callFunction({
                name: 'llmService',
                data: {
                  action: 'generateShoppingList',
                  familyId: this.data.familyId,
                  date: this.data.dateStr
                }
              });
              this.setData({ saving: false });
              if (shopRes.result && shopRes.result.success) {
                toast.showToast(this, '保存并生成成功', 'success', 1500);
                setTimeout(() => wx.navigateBack(), 1500);
              } else {
                toast.showToast(this, '已保存菜单，但采购建议生成失败，请在首页重新生成', 'none', 3000);
                setTimeout(() => wx.navigateBack(), 3000);
              }
            } catch (err) {
              console.error('同步生成采购建议失败', err);
              this.setData({ saving: false });
              toast.showToast(this, '已保存菜单，但采购建议生成异常，请在首页重新生成', 'none', 3000);
              setTimeout(() => wx.navigateBack(), 3000);
            }
          } else {
            this.setData({ saving: false });
            toast.showToast(this, '保存成功', 'success', 1000);
            setTimeout(() => wx.navigateBack(), 1000);
          }
        } else {
          this.setData({ saving: false });
          toast.showToast(this, res.result.message || '保存失败', 'none');
        }
      },
      fail: err => {
        console.error('保存菜单网络异常', err);
        this.setData({ saving: false });
        toast.showToast(this, '网络异常，保存失败', 'none');
      }
    });
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
  },

  onCloseSufficientModal: function () {
    this.setData({ showSufficientModal: false });
  },

  onCommitSufficientReplan: function () {
    this.setData({ showSufficientModal: false });
    this.onCallAIRecommend(true);
  },

  onCloseEmptySaveConfirm: function () {
    this.setData({ showEmptySaveConfirm: false });
  },

  onCommitEmptySave: function () {
    this.setData({ showEmptySaveConfirm: false });
    this.executeSaveMenu();
  },

  noop: function () {}
});
