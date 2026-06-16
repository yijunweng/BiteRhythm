// miniprogram/pages/admin-settings/index.js
const app = getApp();

Page({
  data: {
    isSystemAdmin: false,
    myOpenid: '',
    
    // 大模型配置表单
    providers: ['DeepSeek', 'OpenAI', '腾讯混yuan', '其它 (兼容 OpenAI 格式)'],
    providerValues: ['deepseek', 'openai', 'hunyuan', 'custom'],
    selectedProviderIndex: 0,
    
    apiKey: '',
    baseUrl: '',
    modelName: '',
    
    loading: false,
    saving: false
  },

  onLoad: function (options) {
    this.setData({
      isSystemAdmin: app.globalData.isSystemAdmin,
      myOpenid: app.globalData.openid
    });

    if (this.data.isSystemAdmin) {
      this.fetchSystemConfig();
    }
  },

  // 获取系统已配置的 API
  fetchSystemConfig: function() {
    this.setData({ loading: true });
    wx.showLoading({ title: '获取配置中' });
    
    wx.cloud.callFunction({
      name: 'adminService',
      data: {
        action: 'getLLMConfig'
      },
      success: res => {
        if (res.result && res.result.success) {
          const config = res.result.config || {};
          const providerIndex = this.data.providerValues.indexOf(config.llm_provider || 'deepseek');
          
          this.setData({
            selectedProviderIndex: providerIndex >= 0 ? providerIndex : 0,
            apiKey: config.api_key || '',
            baseUrl: config.base_url || '',
            modelName: config.model_name || ''
          });
        } else {
          // 首次可能未配置，属于正常情况
          console.log('配置未初始化或读取失败:', res.result?.message);
        }
      },
      fail: err => {
        console.error('获取配置云函数失败', err);
        wx.showToast({ title: '配置拉取失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ loading: false });
        wx.hideLoading();
      }
    });
  },

  onProviderChange: function(e) {
    const index = e.detail.value;
    const provider = this.data.providerValues[index];
    let defaultUrl = '';
    let defaultModel = '';

    if (provider === 'deepseek') {
      defaultUrl = 'https://api.deepseek.com/v1';
      defaultModel = 'deepseek-chat';
    } else if (provider === 'openai') {
      defaultUrl = 'https://api.openai.com/v1';
      defaultModel = 'gpt-4o-mini';
    } else if (provider === 'hunyuan') {
      defaultUrl = 'https://api.hunyuan.tencentyun.com/v1';
      defaultModel = 'hunyuan-lite';
    }

    this.setData({
      selectedProviderIndex: index,
      baseUrl: defaultUrl || this.data.baseUrl,
      modelName: defaultModel || this.data.modelName
    });
  },

  onCopyOpenid: function() {
    wx.setClipboardData({
      data: this.data.myOpenid,
      success: () => {
        wx.showToast({ title: 'OpenID 已复制', icon: 'success' });
      }
    });
  },

  // 保存系统配置
  onSaveConfig: function() {
    const { selectedProviderIndex, providerValues, apiKey, baseUrl, modelName } = this.data;
    
    if (!apiKey.trim()) {
      wx.showToast({ title: '请输入 API Key', icon: 'none' });
      return;
    }
    if (!baseUrl.trim()) {
      wx.showToast({ title: '请输入 Base URL', icon: 'none' });
      return;
    }
    if (!modelName.trim()) {
      wx.showToast({ title: '请输入 Model Name', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '正在保存...' });

    wx.cloud.callFunction({
      name: 'adminService',
      data: {
        action: 'saveLLMConfig',
        config: {
          llm_provider: providerValues[selectedProviderIndex],
          api_key: apiKey.trim(),
          base_url: baseUrl.trim(),
          model_name: modelName.trim()
        }
      },
      success: res => {
        if (res.result && res.result.success) {
          wx.showToast({ title: '配置保存成功', icon: 'success' });
        } else {
          wx.showToast({ title: res.result.message || '保存失败', icon: 'none' });
        }
      },
      fail: err => {
        console.error('保存失败', err);
        wx.showToast({ title: '云端保存失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ saving: false });
        wx.hideLoading();
      }
    });
  }
});
