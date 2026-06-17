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
    apiKey: '',
    baseUrl: '',
    modelName: '',
    saving: false,
    loading: false
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
    wx.showLoading({ title: '获取配置中' });
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
      complete: () => { this.setData({ loading: false }); wx.hideLoading(); }
    });
  },


  // 获取家庭成员
  fetchMembers: async function () {
    const familyId = this.data.currentFamilyId;
    if (!familyId) return;
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
  }
});
