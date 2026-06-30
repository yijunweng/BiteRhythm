// miniprogram/pages/dishes/index.js
const app = getApp();
const { toast } = require('../../utils/toast.js');

Page({
  data: {
    familyId: '',
    memberRole: '',
    dishes: [],
    filteredDishes: [],
    loading: true,
    tabs: ['全部', '热菜', '凉菜', '汤品', '主食', '其它'],
    activeTab: '全部',
    searchQuery: '',
    showAddModal: false,
    newDishName: '',
    newDishCategory: '热菜',
    categoryIndex: 0,
    showCategoryPicker: false,
    categories: ['热菜', '凉菜', '汤品', '主食', '其它'],
    newDishRemark: '',
    newDishPractice: '',
    showAiImportModal: false,
    bulkImportText: '',
    importLoading: false,
    showEditModal: false,
    editDishId: '',
    editDishName: '',
    editDishCategory: '热菜',
    editCategoryIndex: 0,
    editDishRemark: '',
    editDishPractice: '',
    showEditCategoryPicker: false,
    showDeleteDishConfirm: false,
    deleteDishId: '',
    deleteDishName: '',
    isBatchMode: false,
    selectedDishIds: {},
    selectedCount: 0,
    isAllSelected: false,
    showBatchDeleteConfirm: false,
    toastData: { show: false, type: 'none', title: '' }
  },

  onLoad: function (options) {
    const familyId = options.familyId || (app.globalData.activeFamily && app.globalData.activeFamily._id) || '';
    if (!familyId) {
      toast.showToast(this, '请先选择家庭', 'none');
      setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 1500);
      return;
    }
    this.setData({ familyId, memberRole: app.globalData.memberRole || '' });
    this.fetchDishes();
  },

  onShow: function () {
    if (app.globalData.memberRole !== undefined) {
      this.setData({ memberRole: app.globalData.memberRole });
    }
    if (app.globalData.activeFamily && this.data.familyId !== app.globalData.activeFamily._id) {
      this.setData({ familyId: app.globalData.activeFamily._id });
      this.fetchDishes();
    }
  },

  onPullDownRefresh: async function () {
    try {
      await this.fetchDishes(true);
    } catch (err) {
      console.error('下拉刷新失败', err);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  fetchDishes: async function (silent = false) {
    if (!silent) {
      this.setData({ loading: true });
    }
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

      this.setData({ dishes: allDishes }, () => this.filterDishes());
    } catch (err) {
      console.error('获取菜品库失败', err);
      toast.showToast(this, '加载失败', 'error');
    } finally {
      if (!silent) {
        this.setData({ loading: false });
      }
    }
  },

  filterDishes: function () {
    let filtered = [...this.data.dishes];
    
    // 按编辑时间/创建时间倒序排序
    const getTime = (val) => {
      if (!val) return 0;
      if (val instanceof Date) return val.getTime();
      const d = new Date(val);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    };
    
    filtered.sort((a, b) => {
      const timeA = getTime(a.updated_at || a.created_at);
      const timeB = getTime(b.updated_at || b.created_at);
      return timeB - timeA;
    });

    if (this.data.activeTab !== '全部') {
      filtered = filtered.filter(d => d.category === this.data.activeTab);
    }
    if (this.data.searchQuery.trim()) {
      const q = this.data.searchQuery.toLowerCase();
      filtered = filtered.filter(d => d.name.toLowerCase().includes(q) || (d.remark && d.remark.toLowerCase().includes(q)));
    }
    this.setData({ 
      filteredDishes: filtered,
      selectedDishIds: {},
      selectedCount: 0,
      isAllSelected: false
    });
  },

  onTabChange: function (e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab }, () => this.filterDishes());
  },

  onSearchInput: function (e) {
    this.setData({ searchQuery: e.detail.value }, () => this.filterDishes());
  },

  onNewDishNameInput: function (e) { this.setData({ newDishName: e.detail.value }); },
  onNewDishRemarkInput: function (e) { this.setData({ newDishRemark: e.detail.value }); },
  onNewDishPracticeInput: function (e) { this.setData({ newDishPractice: e.detail.value }); },

  onOpenAddModal: function () {
    if (this.data.memberRole === 'read') { toast.showToast(this, '只读权限，无法添加', 'none'); return; }
    this.setData({ showAddModal: true, newDishName: '', newDishCategory: '热菜', categoryIndex: 0, newDishRemark: '', newDishPractice: '', showCategoryPicker: false });
  },

  onCloseAddModal: function () { this.setData({ showAddModal: false }); },

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
    this.setData({ categoryIndex: idx, newDishCategory: this.data.categories[idx] });
  },

  onAddDish: async function () {
    const name = this.data.newDishName.trim();
    if (!name) { toast.showToast(this, '请输入菜名', 'none'); return; }
    if (this.data.dishes.some(d => d.name === name)) { toast.showToast(this, '已存在同名菜品', 'none'); return; }
    toast.showLoading(this, '添加中...');
    try {
      const db = wx.cloud.database();
      const addRes = await db.collection('dishes').add({
        data: { family_id: this.data.familyId, name, category: this.data.newDishCategory, remark: this.data.newDishRemark, practice: this.data.newDishPractice || '', creator_openid: app.globalData.openid, created_at: db.serverDate(), updated_at: db.serverDate() }
      });
      const newDish = { _id: addRes._id, family_id: this.data.familyId, name, category: this.data.newDishCategory, remark: this.data.newDishRemark, practice: this.data.newDishPractice || '', created_at: new Date(), updated_at: new Date() };
      this.setData({ dishes: [newDish, ...this.data.dishes], showAddModal: false }, () => this.filterDishes());
      toast.showToast(this, '添加成功', 'success');
    } catch { toast.showToast(this, '添加失败', 'error'); }
    finally { toast.hideLoading(this); }
  },

  onOpenEditModal: function (e) {
    if (this.data.memberRole === 'read') {
      toast.showToast(this, '只读权限，无法修改', 'none');
      return;
    }
    const dish = e.currentTarget.dataset.dish;
    if (!dish) return;
    const catIdx = this.data.categories.indexOf(dish.category);
    this.setData({
      showEditModal: true,
      editDishId: dish._id,
      editDishName: dish.name,
      editDishCategory: dish.category,
      editCategoryIndex: catIdx >= 0 ? catIdx : 0,
      editDishRemark: dish.remark || '',
      editDishPractice: dish.practice || '',
      showEditCategoryPicker: false
    });
  },

  onCloseEditModal: function () {
    this.setData({ showEditModal: false });
  },

  onEditDishNameInput: function (e) {
    this.setData({ editDishName: e.detail.value });
  },

  onEditDishRemarkInput: function (e) {
    this.setData({ editDishRemark: e.detail.value });
  },

  onEditDishPracticeInput: function (e) {
    this.setData({ editDishPractice: e.detail.value });
  },

  onToggleEditCategoryPicker: function () {
    this.setData({ showEditCategoryPicker: !this.data.showEditCategoryPicker });
  },

  onCloseEditCategoryPicker: function () {
    this.setData({ showEditCategoryPicker: false });
  },

  onSelectEditCategory: function (e) {
    const idx = parseInt(e.currentTarget.dataset.index);
    this.setData({
      editCategoryIndex: idx,
      editDishCategory: this.data.categories[idx],
      showEditCategoryPicker: false
    });
  },

  onUpdateDish: async function () {
    const name = this.data.editDishName.trim();
    const id = this.data.editDishId;
    if (!name) {
      toast.showToast(this, '请输入菜名', 'none');
      return;
    }
    if (this.data.dishes.some(d => d.name === name && d._id !== id)) {
      toast.showToast(this, '已存在同名菜品', 'none');
      return;
    }

    toast.showLoading(this, '保存中...');
    try {
      const db = wx.cloud.database();
      await db.collection('dishes').doc(id).update({
        data: {
          name,
          category: this.data.editDishCategory,
          remark: this.data.editDishRemark,
          practice: this.data.editDishPractice || '',
          updated_at: db.serverDate()
        }
      });
      const updatedDishes = this.data.dishes.map(d => {
        if (d._id === id) {
          return {
            ...d,
            name,
            category: this.data.editDishCategory,
            remark: this.data.editDishRemark,
            practice: this.data.editDishPractice || '',
            updated_at: new Date()
          };
        }
        return d;
      });
      this.setData({
        dishes: updatedDishes,
        showEditModal: false
      }, () => this.filterDishes());
      toast.showToast(this, '修改成功', 'success');
    } catch (err) {
      console.error(err);
      toast.showToast(this, '修改失败', 'error');
    } finally {
      toast.hideLoading(this);
    }
  },

  onDeleteDish: function (e) {
    if (this.data.memberRole === 'read') { toast.showToast(this, '只读权限', 'none'); return; }
    const { id, name } = e.currentTarget.dataset;
    this.setData({
      showDeleteDishConfirm: true,
      deleteDishId: id,
      deleteDishName: name
    });
  },

  onCloseDeleteDishConfirm: function () {
    this.setData({ showDeleteDishConfirm: false, deleteDishId: '', deleteDishName: '' });
  },

  onCommitDeleteDish: async function () {
    const id = this.data.deleteDishId;
    this.setData({ showDeleteDishConfirm: false });
    toast.showLoading(this, '删除中...');
    try {
      await wx.cloud.database().collection('dishes').doc(id).remove();
      const updated = this.data.dishes.filter(d => d._id !== id);
      this.setData({ dishes: updated }, () => this.filterDishes());
      toast.showToast(this, '已删除', 'success');
    } catch { toast.showToast(this, '删除失败', 'error'); }
    finally { toast.hideLoading(this); }
  },

  onOpenAiImport: function () {
    if (this.data.memberRole === 'read') { toast.showToast(this, '只读权限', 'none'); return; }
    this.setData({ showAiImportModal: true, bulkImportText: '' });
  },

  onCloseAiImport: function () { this.setData({ showAiImportModal: false }); },
  onBulkImportInput: function (e) { this.setData({ bulkImportText: e.detail.value }); },

  onCommitAiImport: async function () {
    const text = this.data.bulkImportText.trim();
    if (!text) { toast.showToast(this, '请输入导入文本', 'none'); return; }
    
    this.setData({ importLoading: true });
    toast.showLoading(this, 'AI 分析中...');
    
    try {
      const res = await wx.cloud.callFunction({
        name: 'llmService',
        data: { action: 'parseDishes', text }
      });
      
      if (res.result && res.result.success) {
        const parsed = res.result.dishes || [];
        if (!parsed.length) {
          toast.showToast(this, '未解析到菜名', 'none');
          this.setData({ importLoading: false });
          return;
        }
        
        // 过滤出真正需要导入的新菜品
        const newDishes = parsed.filter(dish => !this.data.dishes.some(d => d.name === dish.name));
        
        if (newDishes.length === 0) {
          toast.showToast(this, '所解析菜品已全部存在', 'none');
          this.setData({ importLoading: false });
          return;
        }
        
        // 提示正在导入哪些菜
        const dishNames = newDishes.map(d => d.name).join('、');
        const displayNames = dishNames.length > 20 ? dishNames.slice(0, 20) + '...' : dishNames;
        toast.showLoading(this, `解析出新菜: ${displayNames}\n正在导入中...`);
        
        const db = wx.cloud.database();
        let count = 0;
        for (const dish of newDishes) {
          try {
            await db.collection('dishes').add({
              data: {
                family_id: this.data.familyId,
                name: dish.name,
                category: dish.category || '热菜',
                remark: 'AI导入',
                practice: dish.practice || '',
                creator_openid: app.globalData.openid,
                created_at: db.serverDate(),
                updated_at: db.serverDate()
              }
            });
            count++;
          } catch (err) {
            console.error('导入单道菜失败', dish.name, err);
          }
        }
        
        // 导入成功，关闭弹窗并提示
        this.setData({ showAiImportModal: false });
        toast.showToast(this, `成功导入 ${count} 道菜`, 'success');
        // 后台静默/并行刷新列表，避免因进入骨架屏状态而销毁 Toast 容器
        this.fetchDishes(true);
      } else {
        toast.showToast(this, res.result.message || '分析失败', 'none');
      }
    } catch (err) {
      console.error('调用 AI 解析失败', err);
      toast.showToast(this, '调用失败，请检查 AI 设置', 'none');
    } finally {
      this.setData({ importLoading: false });
      if (this.data.toastData.show && this.data.toastData.type === 'loading') {
        toast.hideLoading(this);
      }
    }
  },

  onToggleBatchMode: function () {
    this.setData({
      isBatchMode: !this.data.isBatchMode,
      selectedDishIds: {},
      selectedCount: 0,
      isAllSelected: false
    });
  },

  onToggleSelectDish: function (e) {
    const id = e.currentTarget.dataset.id;
    const selectedDishIds = { ...this.data.selectedDishIds };
    if (selectedDishIds[id]) {
      delete selectedDishIds[id];
    } else {
      selectedDishIds[id] = true;
    }
    const selectedCount = Object.keys(selectedDishIds).length;
    
    let isAllSelected = this.data.filteredDishes.length > 0;
    for (const d of this.data.filteredDishes) {
      if (!selectedDishIds[d._id]) {
        isAllSelected = false;
        break;
      }
    }

    this.setData({
      selectedDishIds,
      selectedCount,
      isAllSelected
    });
  },

  onToggleSelectAll: function () {
    const isAllSelected = !this.data.isAllSelected;
    const selectedDishIds = { ...this.data.selectedDishIds };
    
    this.data.filteredDishes.forEach(d => {
      if (isAllSelected) {
        selectedDishIds[d._id] = true;
      } else {
        delete selectedDishIds[d._id];
      }
    });
    
    this.setData({
      selectedDishIds,
      selectedCount: Object.keys(selectedDishIds).length,
      isAllSelected
    });
  },

  onBatchDelete: function () {
    if (this.data.selectedCount === 0) return;
    this.setData({ showBatchDeleteConfirm: true });
  },

  onCloseBatchDeleteConfirm: function () {
    this.setData({ showBatchDeleteConfirm: false });
  },

  onCommitBatchDelete: async function () {
    const ids = Object.keys(this.data.selectedDishIds);
    this.setData({ showBatchDeleteConfirm: false });
    toast.showLoading(this, '删除中...');
    
    const db = wx.cloud.database();
    try {
      const deletePromises = ids.map(id => db.collection('dishes').doc(id).remove());
      await Promise.all(deletePromises);
      
      const updated = this.data.dishes.filter(d => !this.data.selectedDishIds[d._id]);
      this.setData({ 
        dishes: updated,
        isBatchMode: false,
        selectedDishIds: {},
        selectedCount: 0,
        isAllSelected: false
      }, () => this.filterDishes());
      
      toast.showToast(this, '删除成功', 'success');
    } catch (err) {
      console.error('删除失败', err);
      toast.showToast(this, '删除失败，请重试', 'none');
    } finally {
      toast.hideLoading(this);
    }
  },

  noop: function () {}
});
