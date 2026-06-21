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
    showAiImportModal: false,
    bulkImportText: '',
    importLoading: false,
    showEditModal: false,
    editDishId: '',
    editDishName: '',
    editDishCategory: '热菜',
    editCategoryIndex: 0,
    editDishRemark: '',
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

  fetchDishes: async function () {
    this.setData({ loading: true });
    try {
      const db = wx.cloud.database();
      const res = await db.collection('dishes').where({ family_id: this.data.familyId }).limit(200).get();
      this.setData({ dishes: res.data }, () => this.filterDishes());
    } catch (err) {
      console.error('获取菜品库失败', err);
      toast.showToast(this, '加载失败', 'error');
    } finally {
      this.setData({ loading: false });
    }
  },

  filterDishes: function () {
    let filtered = this.data.dishes;
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

  onOpenAddModal: function () {
    if (this.data.memberRole === 'read') { toast.showToast(this, '只读权限，无法添加', 'none'); return; }
    this.setData({ showAddModal: true, newDishName: '', newDishCategory: '热菜', categoryIndex: 0, newDishRemark: '', showCategoryPicker: false });
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
        data: { family_id: this.data.familyId, name, category: this.data.newDishCategory, remark: this.data.newDishRemark, creator_openid: app.globalData.openid, created_at: db.serverDate() }
      });
      const newDish = { _id: addRes._id, family_id: this.data.familyId, name, category: this.data.newDishCategory, remark: this.data.newDishRemark };
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
          remark: this.data.editDishRemark
        }
      });
      const updatedDishes = this.data.dishes.map(d => {
        if (d._id === id) {
          return {
            ...d,
            name,
            category: this.data.editDishCategory,
            remark: this.data.editDishRemark
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

  onCommitAiImport: function () {
    const text = this.data.bulkImportText.trim();
    if (!text) { toast.showToast(this, '请输入导入文本', 'none'); return; }
    this.setData({ importLoading: true });
    toast.showLoading(this, 'AI 分析中...');
    wx.cloud.callFunction({
      name: 'llmService',
      data: { action: 'parseDishes', text },
      success: async res => {
        if (res.result && res.result.success) {
          const parsed = res.result.dishes || [];
          if (!parsed.length) { toast.showToast(this, '未解析到菜名', 'none'); return; }
          const db = wx.cloud.database();
          let count = 0;
          for (const dish of parsed) {
            if (!this.data.dishes.some(d => d.name === dish.name)) {
              try { await db.collection('dishes').add({ data: { family_id: this.data.familyId, name: dish.name, category: dish.category || '热菜', remark: 'AI导入', creator_openid: app.globalData.openid, created_at: db.serverDate() } }); count++; } catch { }
            }
          }
          toast.showToast(this, `成功导入 ${count} 道菜`, 'success');
          this.setData({ showAiImportModal: false });
          this.fetchDishes();
        } else { toast.showToast(this, res.result.message || '分析失败', 'none'); }
      },
      fail: err => {
        console.error('调用 AI 解析失败', err);
        toast.showToast(this, '调用失败，请检查 AI 设置', 'none');
      },
      complete: () => { this.setData({ importLoading: false }); toast.hideLoading(this); }
    });
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
