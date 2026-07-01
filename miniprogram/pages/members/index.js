// miniprogram/pages/members/index.js
// 该页面为微信邀请分享落地页，新成员点击分享卡片后进入此页提交加入申请
const app = getApp();
const { toast } = require('../../utils/toast.js');

Page({
  data: {
    familyId: '',
    familyName: '',
    nickname: '',
    submitting: false,
    joined: false,
    loading: true,
    toastData: { show: false, type: 'none', title: '' }
  },

  onLoad: function (options) {
    // 隐藏微信自带的左上角返回首页按钮
    if (wx.hideHomeButton) {
      wx.hideHomeButton();
    }

    const { familyId, action } = options;
    if (!familyId) {
      this.setData({ loading: false });
      return;
    }
    this.setData({ familyId, loading: true });

    if (app.globalData.hasCheckedAuth) {
      this.initInvitationPage();
    } else {
      app.authCallback = () => this.initInvitationPage();
    }
  },

  initInvitationPage: async function () {
    const familyId = this.data.familyId;
    try {
      // 1. 获取家庭名称 (通过云函数绕过客户端数据库读取规则限制)
      const namePromise = wx.cloud.callFunction({
        name: 'adminService',
        data: {
          action: 'getFamilyName',
          familyId
        }
      });

      // 2. 检查是否已经是成员
      let memberPromise = Promise.resolve({ data: [] });
      const openid = app.globalData.openid;
      if (openid) {
        const db = wx.cloud.database();
        memberPromise = db.collection('family_members').where({ family_id: familyId, openid }).get();
      }

      // 并发等待两个请求完成
      const [nameRes, memberRes] = await Promise.all([namePromise, memberPromise]);

      // 处理家庭名称结果
      if (nameRes.result && nameRes.result.success) {
        this.setData({ familyName: nameRes.result.name || '' });
      } else {
        console.error('获取家庭名称失败', nameRes.result.message);
      }

      // 处理成员检查结果
      if (memberRes && memberRes.data && memberRes.data.length > 0) {
        const memberStatus = memberRes.data[0].status;
        this.setData({
          joined: true,
          isApproved: memberStatus === 'approved'
        });
      }
    } catch (err) {
      console.error('加载页面数据失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onNicknameInput: function (e) {
    this.setData({ nickname: e.detail.value });
  },

  onSubmitJoin: async function () {
    const { familyId, nickname } = this.data;
    if (!nickname.trim()) {
      toast.showToast(this, '请输入您的署名', 'none');
      return;
    }

    // 确保 openid 已就绪
    if (!app.globalData.openid) {
      toast.showToast(this, '登录状态异常，请重试', 'none');
      return;
    }

    this.setData({ submitting: true });
    toast.showLoading(this, '提交中...');

    try {
      const db = wx.cloud.database();
      const openid = app.globalData.openid;

      // 检查是否已申请
      const existRes = await db.collection('family_members').where({ family_id: familyId, openid }).get();
      if (existRes.data.length > 0) {
        const memberStatus = existRes.data[0].status;
        if (memberStatus === 'approved') {
          this.setData({ joined: true, isApproved: true });
          toast.showToast(this, '您已是家庭成员', 'success');
          return;
        }
        this.setData({ joined: true, isApproved: false });
        toast.showToast(this, '您的申请正在审批中', 'none');
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
      this.setData({ joined: true, isApproved: false });
      toast.showToast(this, '申请已提交', 'success');
    } catch (err) {
      console.error('提交申请失败', err);
      toast.showToast(this, '提交失败，请重试', 'none');
    } finally {
      this.setData({ submitting: false });
      toast.hideLoading(this);
    }
  },

  onGoHome: function () {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
