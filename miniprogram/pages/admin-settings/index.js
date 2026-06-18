// miniprogram/pages/admin-settings/index.js
const app = getApp();

Page({
  data: {
    isSystemAdmin: false,
    myOpenid: '',
    subpage: 'home', // 'home' | 'members' | 'llm'

    // 成员管理
    currentFamilyId: '',
    currentFamilyName: '',
    approvedMembers: [],
    pendingMembers: [],

    // 大模型配置
    providers: ['DeepSeek (推荐)', 'OpenAI', '腾讯混元', '自定义 (兼容 OpenAI 格式)'],
    providerValues: ['deepseek', 'openai', 'hunyuan', 'custom'],
    selectedProviderIndex: 0,
    showProviderPicker: false,
    apiKey: '',
    baseUrl: '',
    modelName: '',
    saving: false,
    loading: false,
    membersLoading: false,
    showRenameFamilyModal: false,
    renameFamilyName: ''
  },

  onLoad: function () {
    const openid = app.globalData.openid;
    const isAdmin = app.globalData.isSystemAdmin;
    this.setData({ isSystemAdmin: isAdmin, myOpenid: openid });

    if (isAdmin) {
      this.fetchSystemConfig();
      // 加载当前家庭信息
      const family = app.globalData.activeFamily;
      if (family) {
        this.setData({ currentFamilyId: family._id, currentFamilyName: family.name });
      }
    }
  },

  onShow: function () {
    // 旰新家庭信息
    const family = app.globalData.activeFamily;
    if (family && this.data.isSystemAdmin) {
      this.setData({ currentFamilyId: family._id, currentFamilyName: family.name });
      if (this.data.subpage === 'members') {
        this.fetchMembers();
      }
    }
  },

  // 导航
  onGoSubpage: function (e) {
    const page = e.currentTarget.dataset.page;
    this.setData({ subpage: page });
    wx.setNavigationBarTitle({ title: page === 'members' ? '成员与协作管理' : '大模型参数配置' });
    if (page === 'members') this.fetchMembers();
  },

  onBackToHome: function () {
    this.setData({ subpage: 'home' });
    wx.setNavigationBarTitle({ title: '设置' });
  },

  // 复制 OpenID
  onCopyOpenid: function () {
    wx.setClipboardData({
      data: this.data.myOpenid,
      success: () => wx.showToast({ title: 'OpenID 已复制', icon: 'success' })
    });
  },

  // 获取大模型配置
  fetchSystemConfig: function () {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'adminService',
      data: { action: 'getLLMConfig' },
      success: res => {
        if (res.result && res.result.success) {
          const cfg = res.result.config || {};
          const idx = this.data.providerValues.indexOf(cfg.llm_provider || 'deepseek');
          this.setData({
            selectedProviderIndex: idx >= 0 ? idx : 0,
            // api_key 不返回明文，用占位符表示已设置
            apiKey: cfg.api_key_set ? '••••••••••••' : '',
            apiKeyIsSet: !!cfg.api_key_set,
            baseUrl: cfg.base_url || '',
            modelName: cfg.model_name || ''
          });
        }
      },
      fail: err => console.error('获取配置失败', err),
      complete: () => { this.setData({ loading: false }); }
    });
  },


  // 获取家庭成员
  fetchMembers: async function () {
    const familyId = this.data.currentFamilyId;
    if (!familyId) return;
    this.setData({ membersLoading: true });
    try {
      const db = wx.cloud.database();
      const res = await db.collection('family_members').where({ family_id: familyId }).get();
      const approved = [], pending = [];
      res.data.forEach(m => {
        if (m.status === 'approved') approved.push(m);
        else if (m.status === 'pending') pending.push(m);
      });
      this.setData({ approvedMembers: approved, pendingMembers: pending });
    } catch (err) {
      console.error('获取成员失败', err);
    } finally {
      this.setData({ membersLoading: false });
    }
  },

  // 审批通过并设定角色
  onApprove: async function (e) {
    const { id, role } = e.currentTarget.dataset;
    wx.showLoading({ title: '审批中' });
    try {
      const db = wx.cloud.database();
      await db.collection('family_members').doc(id).update({ data: { status: 'approved', role } });
      wx.showToast({ title: '审批通过', icon: 'success' });
      this.fetchMembers();
    } catch {
      wx.showToast({ title: '审批失败', icon: 'error' });
    } finally {
      wx.hideLoading();
    }
  },

  // 拒绝申请
  onReject: function (e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认拒绝', content: '确定要拒绝该用户的加入申请吗？',
      success: async res => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中' });
        try {
          await wx.cloud.database().collection('family_members').doc(id).remove();
          wx.showToast({ title: '已拒绝', icon: 'success' });
          this.fetchMembers();
        } catch { wx.showToast({ title: '操作失败', icon: 'error' }); }
        finally { wx.hideLoading(); }
      }
    });
  },

  // 编辑成员（改名或调权）
  onEditMember: function (e) {
    const { id, nickname, role } = e.currentTarget.dataset;
    const rolesList = ['家人 (读写)', '阿姨 (只读)'];
    wx.showActionSheet({
      itemList: [`改名（当前：${nickname}）`, `调权：${role === 'write' ? '设为只读阿姨' : '设为读写家人'}`],
      success: async res => {
        if (res.tapIndex === 0) {
          // 改名
          wx.showModal({
            title: '修改属名',
            editable: true,
            content: nickname,
            placeholderText: '请输入新属名',
            success: async r => {
              if (r.confirm && r.content && r.content.trim()) {
                wx.showLoading({ title: '修改中' });
                try {
                  await wx.cloud.database().collection('family_members').doc(id).update({ data: { nickname: r.content.trim() } });
                  wx.showToast({ title: '修改成功', icon: 'success' });
                  this.fetchMembers();
                } catch { wx.showToast({ title: '修改失败', icon: 'error' }); }
                finally { wx.hideLoading(); }
              }
            }
          });
        } else {
          // 调权
          const newRole = role === 'write' ? 'read' : 'write';
          wx.showLoading({ title: '修改中' });
          try {
            await wx.cloud.database().collection('family_members').doc(id).update({ data: { role: newRole } });
            wx.showToast({ title: '权限已修改', icon: 'success' });
            this.fetchMembers();
          } catch { wx.showToast({ title: '修改失败', icon: 'error' }); }
          finally { wx.hideLoading(); }
        }
      }
    });
  },

  // 移除成员
  onRemoveMember: function (e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '移除成员', content: `确定要将「${name}」移出家庭吗？`, confirmColor: '#E53935',
      success: async res => {
        if (!res.confirm) return;
        wx.showLoading({ title: '移除中' });
        try {
          await wx.cloud.database().collection('family_members').doc(id).remove();
          wx.showToast({ title: '已移除', icon: 'success' });
          this.fetchMembers();
        } catch { wx.showToast({ title: '移除失败', icon: 'error' }); }
        finally { wx.hideLoading(); }
      }
    });
  },

  // 提供分享配置
  onShareAppMessage: function () {
    const family = app.globalData.activeFamily;
    if (!family) return { title: 'BiteRhythm (食之律动) - 邀请加入' };
    return {
      title: `邀请您加入「${family.name}」的厨房日历`,
      path: `/pages/members/index?familyId=${family._id}&action=join`
    };
  },

  // 大模型配置表单
  onToggleProviderPicker: function () {
    this.setData({ showProviderPicker: !this.data.showProviderPicker });
  },
  onCloseProviderPicker: function () {
    this.setData({ showProviderPicker: false });
  },
  onSelectProvider: function (e) {
    const idx = e.currentTarget.dataset.index;
    this.onProviderChange({ detail: { value: idx } });
    this.setData({ showProviderPicker: false });
  },

  onProviderChange: function (e) {
    const idx = parseInt(e.detail.value);
    const pv = this.data.providerValues[idx];
    let url = '', model = '';
    if (pv === 'deepseek') { url = 'https://api.deepseek.com/v1'; model = 'deepseek-chat'; }
    else if (pv === 'openai') { url = 'https://api.openai.com/v1'; model = 'gpt-4o-mini'; }
    else if (pv === 'hunyuan') { url = 'https://api.hunyuan.cloud.com/v1'; model = 'hunyuan-lite'; }
    this.setData({ selectedProviderIndex: idx, baseUrl: url || this.data.baseUrl, modelName: model || this.data.modelName });
  },

  onApiKeyInput: function (e) { this.setData({ apiKey: e.detail.value }); },
  onBaseUrlInput: function (e) { this.setData({ baseUrl: e.detail.value }); },
  onModelNameInput: function (e) { this.setData({ modelName: e.detail.value }); },

  onSaveConfig: function () {
    const { selectedProviderIndex, providerValues, apiKey, baseUrl, modelName, apiKeyIsSet } = this.data;
    // 若 apiKey 是占位符（未修改），则不更新 key
    const isPlaceholder = apiKey.startsWith('•');
    if (!isPlaceholder && !apiKey.trim()) {
      wx.showToast({ title: '请输入 API Key', icon: 'none' }); return;
    }
    if (!baseUrl.trim()) { wx.showToast({ title: '请输入 Base URL', icon: 'none' }); return; }
    if (!modelName.trim()) { wx.showToast({ title: '请输入模型名称', icon: 'none' }); return; }
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    const configPayload = {
      llm_provider: providerValues[selectedProviderIndex],
      base_url: baseUrl.trim(),
      model_name: modelName.trim()
    };
    // 只有用户主动修改了 key 才更新
    if (!isPlaceholder) {
      configPayload.api_key = apiKey.trim();
    }
    wx.cloud.callFunction({
      name: 'adminService',
      data: { action: 'saveLLMConfig', config: configPayload },
      success: res => {
        if (res.result && res.result.success) wx.showToast({ title: '配置保存成功', icon: 'success' });
        else wx.showToast({ title: res.result.message || '保存失败', icon: 'none' });
      },
      fail: () => wx.showToast({ title: '云端保存失败', icon: 'none' }),
      complete: () => { this.setData({ saving: false }); wx.hideLoading(); }
    });
  },

  onOpenRenameFamilyModal: function () {
    this.setData({
      showRenameFamilyModal: true,
      renameFamilyName: this.data.currentFamilyName
    });
  },

  onCloseRenameFamilyModal: function () {
    this.setData({
      showRenameFamilyModal: false
    });
  },

  onRenameFamilyNameInput: function (e) {
    this.setData({
      renameFamilyName: e.detail.value
    });
  },

  noop: function () {},

  onCommitRenameFamily: async function () {
    const name = this.data.renameFamilyName.trim();
    if (!name) {
      wx.showToast({ title: '请输入家庭名称', icon: 'none' });
      return;
    }
    
    // 检查是否重名
    wx.showLoading({ title: '检查重名中...' });
    try {
      const db = wx.cloud.database();
      const checkRes = await db.collection('families').where({ name }).get();
      const duplicate = checkRes.data.find(f => f._id !== this.data.currentFamilyId);
      if (duplicate) {
        wx.showToast({ title: '已存在同名家庭', icon: 'none' });
        return;
      }

      wx.showLoading({ title: '修改中...' });
      await db.collection('families').doc(this.data.currentFamilyId).update({
        data: { name }
      });

      if (app.globalData.activeFamily && app.globalData.activeFamily._id === this.data.currentFamilyId) {
        app.globalData.activeFamily.name = name;
      }

      this.setData({
        currentFamilyName: name,
        showRenameFamilyModal: false
      });
      wx.showToast({ title: '修改成功', icon: 'success' });
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '修改失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onDeleteFamily: function () {
    const myOpenid = this.data.myOpenid;
    const isFamilyAdmin = this.data.approvedMembers.some(m => m.openid === myOpenid && m.role === 'admin');
    
    if (!isFamilyAdmin) {
      wx.showToast({ title: '只有家庭管理员可以删除家庭', icon: 'none' });
      return;
    }
    
    wx.showModal({
      title: '确认删除家庭',
      content: `确定要解散并删除家庭「${this.data.currentFamilyName}」吗？此操作将永久清除该家庭下的所有成员、菜品及排餐记录，且无法恢复！`,
      confirmColor: '#E53935',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '正在删除...' });
          try {
            const callRes = await wx.cloud.callFunction({
              name: 'adminService',
              data: {
                action: 'deleteFamily',
                familyId: this.data.currentFamilyId
              }
            });
            
            if (callRes.result && callRes.result.success) {
              wx.showToast({ title: '删除成功', icon: 'success' });
              app.globalData.activeFamily = null;
              app.globalData.memberRole = '';
              setTimeout(() => {
                wx.reLaunch({
                  url: '/pages/index/index'
                });
              }, 1500);
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
