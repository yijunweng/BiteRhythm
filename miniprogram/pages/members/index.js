// miniprogram/pages/members/index.js
const app = getApp();

Page({
  data: {
    familyId: '',
    familyName: '',
    currentUserRole: '', // 当前用户在此家庭的角色
    
    approvedMembers: [], // 已加入成员
    pendingMembers: [],  // 待审批成员
    
    // 是否为被分享进入的加入页面
    isJoinFlow: false,
    inviterName: '',

    loading: false
  },

  onLoad: function (options) {
    const { familyId, action, inviter } = options;
    
    if (!familyId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.setData({ familyId });

    if (action === 'join') {
      // 申请加入流程
      this.setData({
        isJoinFlow: true,
        inviterName: inviter || '您的家人'
      });
      this.fetchFamilyDetails();
    } else {
      // 正常管理流程
      this.setData({
        currentUserRole: app.globalData.memberRole || ''
      });
      this.fetchFamilyDetails();
      this.fetchMembers();
    }
  },

  // 获取家庭基本资料
  fetchFamilyDetails: async function() {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('families').doc(this.data.familyId).get();
      this.setData({
        familyName: res.data.name
      });
    } catch(err) {
      console.error('获取家庭详情失败', err);
    }
  },

  // 获取当前家庭所有成员
  fetchMembers: async function() {
    this.setData({ loading: true });
    try {
      const db = wx.cloud.database();
      const res = await db.collection('family_members')
        .where({
          family_id: this.data.familyId
        }).get();

      const approved = [];
      const pending = [];

      res.data.forEach(m => {
        if (m.status === 'approved') {
          approved.push(m);
        } else if (m.status === 'pending') {
          pending.push(m);
        }
      });

      this.setData({
        approvedMembers: approved,
        pendingMembers: pending
      });
    } catch(err) {
      console.error('获取成员列表失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  // 微信分享配置：生成邀请链接
  onShareAppMessage: function () {
    const openid = app.globalData.openid;
    return {
      title: `邀请您加入我的“胃口周刊”家庭：${this.data.familyName}`,
      path: `/pages/members/index?familyId=${this.data.familyId}&action=join&inviter=${encodeURIComponent(app.globalData.userInfo?.nickName || '家人')}`,
      imageUrl: '/images/share_cover.png' // 可选，微信默认截屏
    };
  },

  // 申请加入家庭提交
  onSubmitJoinRequest: async function() {
    wx.showLoading({ title: '正在提交' });
    try {
      const db = wx.cloud.database();
      const openid = app.globalData.openid;

      // 1. 检查是否已经是成员或已申请
      const checkRes = await db.collection('family_members')
        .where({
          family_id: this.data.familyId,
          openid: openid
        }).get();

      if (checkRes.data.length > 0) {
        const m = checkRes.data[0];
        if (m.status === 'approved') {
          wx.showToast({ title: '您已经是该家庭成员了', icon: 'none' });
        } else {
          wx.showToast({ title: '已提交过申请，请等待管理员审批', icon: 'none' });
        }
        setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 1500);
        return;
      }

      // 2. 插入申请记录
      // 备注：这里由于没有接入完整的微信用户信息，昵称先使用“微信用户”
      await db.collection('family_members').add({
        data: {
          family_id: this.data.familyId,
          openid: openid,
          nickname: app.globalData.userInfo?.nickName || '新成员',
          avatar_url: app.globalData.userInfo?.avatarUrl || '',
          role: 'read', // 申请者默认分配只读角色，等待管理员修改
          status: 'pending',
          created_at: db.serverDate()
        }
      });

      wx.showToast({ title: '申请提交成功，请联系群主审批', icon: 'success' });
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/index/index' });
      }, 2000);
    } catch(err) {
      console.error('申请加入失败', err);
      wx.showToast({ title: '提交失败，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 审批通过并设定角色
  onApprove: async function(e) {
    const { id, role } = e.currentTarget.dataset;
    wx.showLoading({ title: '审批中' });
    try {
      const db = wx.cloud.database();
      
      // 更新成员状态
      await db.collection('family_members').doc(id).update({
        data: {
          status: 'approved',
          role: role // 'write' 或 'read'
        }
      });

      // 增加 families 表中的成员数计数
      await wx.cloud.callFunction({
        name: 'adminService',
        data: {
          action: 'incrementMemberCount',
          familyId: this.data.familyId
        }
      });

      wx.showToast({ title: '审批通过', icon: 'success' });
      this.fetchMembers();
    } catch(err) {
      console.error('审批失败', err);
      wx.showToast({ title: '审批失败', icon: 'error' });
    } finally {
      wx.hideLoading();
    }
  },

  // 拒绝申请
  onReject: async function(e) {
    const { id } = e.currentTarget.dataset;
    const that = this;
    wx.showModal({
      title: '确认拒绝',
      content: '确定要拒绝该用户的加入申请吗？',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中' });
          try {
            const db = wx.cloud.database();
            await db.collection('family_members').doc(id).remove();
            wx.showToast({ title: '已拒绝申请', icon: 'success' });
            that.fetchMembers();
          } catch(err) {
            console.error('拒绝申请失败', err);
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  },

  // 修改已有成员角色
  onChangeMemberRole: function(e) {
    const { id, currentrole } = e.currentTarget.dataset;
    const that = this;
    
    // 如果是自己，不修改
    const member = this.data.approvedMembers.find(m => m._id === id);
    if (member && member.openid === app.globalData.openid) {
      wx.showToast({ title: '无法修改自己的角色', icon: 'none' });
      return;
    }

    const rolesList = ['家人 (读写)', '阿姨 (只读)'];
    wx.showActionSheet({
      itemList: rolesList,
      success: async (res) => {
        const index = res.tapIndex;
        const targetRole = index === 0 ? 'write' : 'read';
        
        if (targetRole === currentrole) return;

        wx.showLoading({ title: '修改中' });
        try {
          const db = wx.cloud.database();
          await db.collection('family_members').doc(id).update({
            data: { role: targetRole }
          });
          wx.showToast({ title: '修改成功', icon: 'success' });
          that.fetchMembers();
        } catch(err) {
          console.error('修改角色失败', err);
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  // 移除家庭成员
  onRemoveMember: function(e) {
    const { id, name } = e.currentTarget.dataset;
    const that = this;

    wx.showModal({
      title: '移除成员',
      content: `确定要将“${name}”移出家庭吗？`,
      confirmColor: '#E29B9B',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '移出中' });
          try {
            const db = wx.cloud.database();
            await db.collection('family_members').doc(id).remove();
            wx.showToast({ title: '已成功移出', icon: 'success' });
            that.fetchMembers();
          } catch(err) {
            console.error('移除成员失败', err);
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  }
});
