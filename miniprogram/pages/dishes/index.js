// miniprogram/pages/dishes/index.js
const app = getApp();

Page({
  data: {
    familyId: '',
    memberRole: '',
    
    dishes: [],
    filteredDishes: [],
    
    // 过滤条件
    tabs: ['全部', '热菜', '凉菜', '汤品', '主食', '其它'],
    activeTab: '全部',
    searchQuery: '',

    // 新增菜品表单
    showAddModal: false,
    newDishName: '',
    newDishCategory: '热菜',
    categories: ['热菜', '凉菜', '汤品', '主食', '其它'],
    newDishRemark: '',

    // 批量导入
    showAiImportModal: false,
    bulkImportText: '',
    importLoading: false,

    loading: false
  },

  onLoad: function (options) {
    const { familyId } = options;
    if (!familyId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.setData({
      familyId,
      memberRole: app.globalData.memberRole || ''
    });

    this.fetchDishes();
  },

  // 获取菜品库
  fetchDishes: async function() {
    this.setData({ loading: true });
    wx.showLoading({ title: '获取中' });
    try {
      const db = wx.cloud.database();
      const res = await db.collection('dishes')
        .where({
          family_id: this.data.familyId
        }).limit(150).get();
        
      this.setData({
        dishes: res.data
      }, () => {
        this.filterDishes();
      });
    } catch(err) {
      console.error('获取菜品库失败', err);
      wx.showToast({ title: '加载失败', icon: 'error' });
    } finally {
      this.setData({ loading: false });
      wx.hideLoading();
    }
  },

  // 搜索和品类筛选
  filterDishes: function() {
    const { dishes, activeTab, searchQuery } = this.data;
    let filtered = dishes;

    if (activeTab !== '全部') {
      filtered = filtered.filter(d => d.category === activeTab);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(d => d.name.toLowerCase().includes(q) || (d.remark && d.remark.toLowerCase().includes(q)));
    }

    this.setData({
      filteredDishes: filtered
    });
  },

  onTabChange: function(e) {
    const { tab } = e.currentTarget.dataset;
    this.setData({ activeTab: tab }, () => {
      this.filterDishes();
    });
  },

  onSearchInput: function(e) {
    this.setData({ searchQuery: e.detail.value }, () => {
      this.filterDishes();
    });
  },

  // 表单操作
  onOpenAddModal: function() {
    if (this.data.memberRole === 'read') {
      wx.showToast({ title: '阿姨角色仅有只读权限', icon: 'none' });
      return;
    }
    this.setData({
      showAddModal: true,
      newDishName: '',
      newDishCategory: '热菜',
      newDishRemark: ''
    });
  },

  onCloseAddModal: function() {
    this.setData({ showAddModal: false });
  },

  onCategoryChange: function(e) {
    this.setData({
      newDishCategory: this.data.categories[e.detail.value]
    });
  },

  // 新增菜品
  onAddDish: async function() {
    const { newDishName, newDishCategory, newDishRemark, familyId } = this.data;
    const name = newDishName.trim();
    if (!name) {
      wx.showToast({ title: '请输入菜名', icon: 'none' });
      return;
    }

    // 检查本地重名
    if (this.data.dishes.some(d => d.name === name)) {
      wx.showToast({ title: '菜品已在库中', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '添加中' });
    try {
      const db = wx.cloud.database();
      const openid = app.globalData.openid;
      
      const addRes = await db.collection('dishes').add({
        data: {
          family_id: familyId,
          name: name,
          category: newDishCategory,
          remark: newDishRemark,
          creator_openid: openid,
          created_at: db.serverDate()
        }
      });

      const newDish = {
        _id: addRes._id,
        family_id: familyId,
        name: name,
        category: newDishCategory,
        remark: newDishRemark,
        creator_openid: openid
      };

      this.setData({
        dishes: [newDish, ...this.data.dishes],
        showAddModal: false
      }, () => {
        this.filterDishes();
      });

      wx.showToast({ title: '添加成功', icon: 'success' });
    } catch(err) {
      console.error('保存菜品失败', err);
      wx.showToast({ title: '添加失败', icon: 'error' });
    } finally {
      wx.hideLoading();
    }
  },

  // 删除菜品
  onDeleteDish: function(e) {
    if (this.data.memberRole === 'read') {
      wx.showToast({ title: '阿姨角色仅有只读权限', icon: 'none' });
      return;
    }
    const { id, name } = e.currentTarget.dataset;
    const that = this;

    wx.showModal({
      title: '确认删除',
      content: `确定要从菜品库中删除“${name}”吗？这不会删除已存菜单的历史记录。`,
      confirmColor: '#E29B9B',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中' });
          try {
            const db = wx.cloud.database();
            await db.collection('dishes').doc(id).remove();
            
            const updatedDishes = that.data.dishes.filter(d => d._id !== id);
            that.setData({
              dishes: updatedDishes
            }, () => {
              that.filterDishes();
            });
            wx.showToast({ title: '已删除', icon: 'success' });
          } catch(err) {
            console.error('删除菜品失败', err);
            wx.showToast({ title: '删除失败', icon: 'error' });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  },

  // 唤起 AI 批量解析导入
  onOpenAiImport: function() {
    if (this.data.memberRole === 'read') {
      wx.showToast({ title: '阿姨角色仅有只读权限', icon: 'none' });
      return;
    }
    this.setData({
      showAiImportModal: true,
      bulkImportText: ''
    });
  },

  onCloseAiImport: function() {
    this.setData({ showAiImportModal: false });
  },

  // 提交 AI 解析
  onCommitAiImport: function() {
    const text = this.data.bulkImportText.trim();
    if (!text) {
      wx.showToast({ title: '请输入导入文本', icon: 'none' });
      return;
    }

    this.setData({ importLoading: true });
    wx.showLoading({ title: 'AI 正在分析...' });

    wx.cloud.callFunction({
      name: 'llmService',
      data: {
        action: 'parseDishes',
        text: text
      },
      success: async (res) => {
        if (res.result && res.result.success) {
          const parsedDishes = res.result.dishes || []; // [{name, category}]
          if (parsedDishes.length === 0) {
            wx.showToast({ title: '未分析出有效菜名，请调整输入内容', icon: 'none' });
            this.setData({ importLoading: false });
            wx.hideLoading();
            return;
          }
          
          // 写入云数据库 (由于小程序端可以批量写，或者用云函数写更安全，我们这里直接调用 menuService 或循环写入)
          wx.showLoading({ title: `导入中(0/${parsedDishes.length})` });
          
          let importCount = 0;
          const db = wx.cloud.database();
          const openid = app.globalData.openid;
          
          for (let dish of parsedDishes) {
            // 查重
            if (!this.data.dishes.some(d => d.name === dish.name)) {
              try {
                await db.collection('dishes').add({
                  data: {
                    family_id: this.data.familyId,
                    name: dish.name,
                    category: dish.category || '热菜',
                    remark: 'AI 批量导入',
                    creator_openid: openid,
                    created_at: db.serverDate()
                  }
                });
                importCount++;
              } catch(e) {
                console.error('插入失败', dish, e);
              }
            }
          }

          wx.showToast({ title: `成功导入 ${importCount} 道菜`, icon: 'success' });
          this.setData({ showAiImportModal: false });
          this.fetchDishes(); // 刷新
        } else {
          wx.showToast({ title: res.result.message || '分析失败', icon: 'none' });
        }
      },
      fail: err => {
        console.error('AI 解析失败', err);
        wx.showToast({ title: '调用失败，请检查 AI 设置', icon: 'none' });
      },
      complete: () => {
        this.setData({ importLoading: false });
        wx.hideLoading();
      }
    });
  }
});
