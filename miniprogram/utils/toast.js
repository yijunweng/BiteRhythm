// miniprogram/utils/toast.js
const toast = {
  showLoading: function (page, title) {
    page.setData({
      toastData: {
        show: true,
        type: 'loading',
        title: title || '加载中...'
      }
    });
  },

  hideLoading: function (page) {
    if (page && page.data && page.data.toastData && page.data.toastData.type === 'loading') {
      page.setData({
        'toastData.show': false
      });
    }
  },

  showToast: function (page, title, icon = 'success', duration = 1500) {
    let type = 'success';
    if (icon === 'none') {
      type = 'none';
    } else if (icon === 'error') {
      type = 'info';
    }

    page.setData({
      toastData: {
        show: true,
        type: type,
        title: title
      }
    });

    if (page.toastTimer) {
      clearTimeout(page.toastTimer);
    }
    
    page.toastTimer = setTimeout(() => {
      page.setData({
        'toastData.show': false
      });
    }, duration);
  }
};

module.exports = {
  toast
};
