// miniprogram/pages/members/index.js
// 该页面为微信邀请分享落地页，新成员点击分享卡片后进入此页提交加入申请
const app = getApp();

Page({
  data: {
    familyId: '',
    familyName: '',
    nickname: '',
    submitting: false,
    joined: false,
    loading: true
  },

  onLoad: async function (options) {
    const { familyId, action } = options;
    if (!familyId) {
      this.setData({ loading: false });
      return;
    }
    this.setData({ familyId });

    // 获取家庭名称
    try {
      const db = wx.cloud.database();
      const res = await db.collection('families').doc(familyId).get();
      this.setData({ familyName: res.data.name || '' });
    } catch (err) {
      console.error('获取家庭失败', err);
    } finally {
      this.setData({ loading: false });
    }

    // 检查是否已经是成员
    const openid = app.globalData.openid;
    if (openid) {
      try {
        const db = wx.cloud.database();
        const r = await db.collection('family_members').where({ family_id: familyId, openid }).get();
        if (r.data.length > 0) {
          this.setData({ joined: true });
        }
      } catch { }
    }
  },

  onNicknameInput: function (e) {
    this.setData({ nickname: e.detail.value });
  },

  onSubmitJoin: async function () {
    const { familyId, nickname } = this.data;
    if (!nickname.trim()) {
      wx.showToast({ title: '请输入您的属名', icon: 'none' });
      return;
    }

    // 确保 openid 已就绪
    if (!app.globalData.openid) {
      wx.showToast({ title: '登录状态异常，请重试', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...' });

    try {
      const db = wx.cloud.database();
      const openid = app.globalData.openid;

      // 检查是否已申请
      const existRes = await db.collection('family_members').where({ family_id: familyId, openid }).get();
      if (existRes.data.length > 0) {
        if (existRes.data[0].status === 'approved') {
          this.setData({ joined: true });
          wx.showToast({ title: '您已是家庭成员', icon: 'success' });
          return;
        }
        wx.showToast({ title: '您的申请正在审批中', icon: 'none' });
        return;
      }

      // 提交待审申请
      await db.collection('family_members').add({
        data: {
          family_id: familyId,
          openid,
          nickname: nickname.trim(),
          role: 'read',           // 默认只读，管理员可调权
          status: 'pending',      // 待审批
          created_at: db.serverDate()
        }
      });
      this.setData({ joined: true });
      wx.showToast({ title: '申请已提交', icon: 'success' });
    } catch (err) {
      console.error('提交申请失败', err);
      wx.showToast({ title: '提交失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
      wx.hideLoading();
    }
  },

  onGoHome: function () {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
