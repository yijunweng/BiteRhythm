// miniprogram/app.js
const { ENV_ID } = require('./config');

App({
  globalData: {
    openid: '',
    isSystemAdmin: false,
    memberRole: '',
    activeFamily: null,
    hasCheckedAuth: false,
    menuChanged: false,
    lastSavedMenu: null
  },

  // 页面注册的初始化完成回调
  authCallback: null,

  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: ENV_ID,
        traceUser: true
      });
    }

    this.fetchOpenid();
  },

  fetchOpenid: function () {
    const that = this;
    wx.cloud.callFunction({
      name: 'login',
      success: res => {
        const openid = res.result && res.result.openid;
        if (!openid) {
          console.error('获取 openid 失败：', res);
          return;
        }
        that.globalData.openid = openid;

        // 调用云端接口校验是否是超管（动态校验，无需在本地 config.js 里存 openid）
        wx.cloud.callFunction({
          name: 'adminService',
          data: { action: 'getSuperAdminStatus' },
          success: adminRes => {
            if (adminRes.result && adminRes.result.success) {
              that.globalData.isSystemAdmin = adminRes.result.isSystemAdmin;

              // 如果系统尚未初始化超管，且当前用户首次进入，则自动初始化
              if (!adminRes.result.initialized) {
                wx.cloud.callFunction({
                  name: 'adminService',
                  data: { action: 'initSuperAdmin' },
                  success: initRes => {
                    if (initRes.result && initRes.result.success) {
                      that.globalData.isSystemAdmin = true;
                      console.log('超管 OpenID 已自动初始化为当前用户');
                    }
                    that._onAuthDone();
                  },
                  fail: () => that._onAuthDone()
                });
                return;
              }
            } else {
              that.globalData.isSystemAdmin = false;
            }
            that._onAuthDone();
          },
          fail: () => {
            // 云函数调用失败时降级处理
            that.globalData.isSystemAdmin = false;
            that._onAuthDone();
          }
        });
      },
      fail: err => {
        console.error('调用 login 云函数失败：', err);
      }
    });
  },

  _onAuthDone: function () {
    this.globalData.hasCheckedAuth = true;
    if (typeof this.authCallback === 'function') {
      this.authCallback();
      this.authCallback = null;
    }
  }
});
