// miniprogram/app.js
const config = require('./config.js');

App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: config.envId || undefined,
        traceUser: true,
      });
    }

    this.globalData = {
      openid: '',
      isSystemAdmin: false,
      activeFamily: null, // 当前选中的家庭 { _id, name, preferences, creator_openid }
      memberRole: '',     // 当前用户在当前家庭的角色 ('admin' | 'write' | 'read' | '')
      userInfo: null,     // 微信用户信息
      hasCheckedAuth: false
    };

    // 尝试进行登录与身份拉取
    this.loginAndInit();
  },

  loginAndInit: function() {
    const that = this;
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'login',
        data: {},
        success: res => {
          console.log('[云函数] [login] 登录成功: ', res.result);
          const openid = res.result.openid;
          that.globalData.openid = openid;
          
          // 校验是否是超级管理员
          if (openid === config.superAdminOpenId) {
            that.globalData.isSystemAdmin = true;
          }
          
          that.globalData.hasCheckedAuth = true;
          
          // 回调页面初始化
          if (that.authCallback) {
            that.authCallback(res.result);
          }
          resolve(res.result);
        },
        fail: err => {
          console.error('[云函数] [login] 调用失败', err);
          reject(err);
        }
      });
    });
  }
});
