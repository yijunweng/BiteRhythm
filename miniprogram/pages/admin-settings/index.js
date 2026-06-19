// miniprogram/pages/admin-settings/index.js
const app = getApp();
const { toast } = require('../../utils/toast.js');

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
    renameFamilyName: '',

    // 编辑成员 Modal
    showEditMemberModal: false,
    editMemberId: '',
    editMemberNickname: '',
    editMemberRole: '',
    showEditMemberRolePicker: false,

    // 通用确认 Modal
    showConfirmModal: false,
    confirmTitle: '',
    confirmContent: '',
    confirmActionType: '', // 'deleteFamily' | 'removeMember'
    confirmTargetId: '',
    confirmTargetName: '',

    toastData: { show: false, type: 'none', title: '' }
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
      success: () => toast.showToast(this, 'OpenID 已复制', 'success')
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
    toast.showLoading(this, '审批中...');
    try {
      const db = wx.cloud.database();
      await db.collection('family_members').doc(id).update({ data: { status: 'approved', role } });
      toast.showToast(this, '审批通过', 'success');
      this.fetchMembers();
    } catch {
      toast.showToast(this, '审批失败', 'error');
    } finally {
      toast.hideLoading(this);
    }
  },

  // 拒绝申请
  onReject: function (e) {
    const { id } = e.currentTarget.dataset;
    this.setData({
      showConfirmModal: true,
      confirmTitle: '确认拒绝',
      confirmContent: '确定要拒绝该用户的加入申请吗？',
      confirmActionType: 'rejectMember',
      confirmTargetId: id,
      confirmTargetName: ''
    });
  },

  // 编辑成员（打开自定义 Modal）
  onEditMember: function (e) {
    const { id, nickname, role } = e.currentTarget.dataset;
    this.setData({
      showEditMemberModal: true,
      editMemberId: id,
      editMemberNickname: nickname,
      editMemberRole: role,
      showEditMemberRolePicker: false
    });
  },

  onCloseEditMemberModal: function () {
    this.setData({ showEditMemberModal: false });
  },

  onEditMemberNicknameInput: function (e) {
    this.setData({ editMemberNickname: e.detail.value });
  },

  onToggleEditMemberRolePicker: function () {
    this.setData({ showEditMemberRolePicker: !this.data.showEditMemberRolePicker });
  },

  onCloseEditMemberRolePicker: function () {
    this.setData({ showEditMemberRolePicker: false });
  },

  onSelectEditMemberRole: function (e) {
    const role = e.currentTarget.dataset.role;
    this.setData({
      editMemberRole: role,
      showEditMemberRolePicker: false
    });
  },

  onCommitEditMember: async function () {
    const id = this.data.editMemberId;
    const nickname = this.data.editMemberNickname.trim();
    const role = this.data.editMemberRole;
    if (!nickname) {
      toast.showToast(this, '请输入成员昵称', 'none');
      return;
    }
    toast.showLoading(this, '保存中...');
    try {
      const db = wx.cloud.database();
      if (role === 'admin') {
        await db.collection('family_members').doc(id).update({ data: { nickname } });
      } else {
        await db.collection('family_members').doc(id).update({ data: { nickname, role } });
      }
      toast.showToast(this, '修改成功', 'success');
      this.setData({ showEditMemberModal: false });
      this.fetchMembers();
    } catch (err) {
      console.error(err);
      toast.showToast(this, '修改失败', 'none');
    } finally {
      toast.hideLoading(this);
    }
  },

  // 移除成员（打开自定义确认 Modal）
  onRemoveMember: function (e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({
      showConfirmModal: true,
      confirmTitle: '移除成员',
      confirmContent: `确定要将「${name}」移出家庭吗？`,
      confirmActionType: 'removeMember',
      confirmTargetId: id,
      confirmTargetName: name
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
      toast.showToast(this, '请输入 API Key', 'none'); return;
    }
    if (!baseUrl.trim()) { toast.showToast(this, '请输入 Base URL', 'none'); return; }
    if (!modelName.trim()) { toast.showToast(this, '请输入模型名称', 'none'); return; }
    this.setData({ saving: true });
    toast.showLoading(this, '保存中...');
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
        if (res.result && res.result.success) toast.showToast(this, '配置保存成功', 'success');
        else toast.showToast(this, res.result.message || '保存失败', 'none');
      },
      fail: () => toast.showToast(this, '云端保存失败', 'none'),
      complete: () => { this.setData({ saving: false }); toast.hideLoading(this); }
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
      toast.showToast(this, '请输入家庭名称', 'none');
      return;
    }
    
    // 检查是否重名
    toast.showLoading(this, '检查重名中...');
    try {
      const db = wx.cloud.database();
      const checkRes = await db.collection('families').where({ name }).get();
      const duplicate = checkRes.data.find(f => f._id !== this.data.currentFamilyId);
      if (duplicate) {
        toast.showToast(this, '已存在同名家庭', 'none');
        return;
      }

      toast.showLoading(this, '修改中...');
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
      toast.showToast(this, '修改成功', 'success');
    } catch (err) {
      console.error(err);
      toast.showToast(this, '修改失败', 'none');
    } finally {
      toast.hideLoading(this);
    }
  },



  onCloseConfirmModal: function () {
    this.setData({ showConfirmModal: false });
  },

  onCommitConfirm: async function () {
    const actionType = this.data.confirmActionType;
    const targetId = this.data.confirmTargetId;
    
    if (actionType === 'rejectMember') {
      toast.showLoading(this, '处理中...');
      try {
        await wx.cloud.database().collection('family_members').doc(targetId).remove();
        toast.showToast(this, '已拒绝', 'success');
        this.setData({ showConfirmModal: false });
        this.fetchMembers();
      } catch {
        toast.showToast(this, '操作失败', 'error');
      } finally {
        toast.hideLoading(this);
      }
    } else if (actionType === 'removeMember') {
      toast.showLoading(this, '移除中...');
      try {
        await wx.cloud.database().collection('family_members').doc(targetId).remove();
        toast.showToast(this, '已移除', 'success');
        this.setData({ showConfirmModal: false });
        this.fetchMembers();
      } catch (err) {
        console.error(err);
        toast.showToast(this, '移除失败', 'none');
      } finally {
        toast.hideLoading(this);
      }
    } else if (actionType === 'deleteFamily') {
      toast.showLoading(this, '正在删除...');
      try {
        const callRes = await wx.cloud.callFunction({
          name: 'adminService',
          data: {
            action: 'deleteFamily',
            familyId: targetId
          }
        });
        
        if (callRes.result && callRes.result.success) {
          toast.showToast(this, '删除成功', 'success');
          app.globalData.activeFamily = null;
          app.globalData.memberRole = '';
          this.setData({ showConfirmModal: false });
          setTimeout(() => {
            wx.reLaunch({
              url: '/pages/index/index'
            });
          }, 1500);
        } else {
          toast.showToast(this, callRes.result.message || '删除失败', 'none');
        }
      } catch (err) {
        console.error('删除家庭失败', err);
        toast.showToast(this, '删除失败', 'none');
      } finally {
        toast.hideLoading(this);
      }
    }
  },

  noop: function () {}
});
