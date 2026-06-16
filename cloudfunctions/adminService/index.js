// cloudfunctions/adminService/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// 超级管理员 OpenID (部署时请替换为您真实的 OpenID)
const SUPER_ADMIN_OPENID = 'SUPER_ADMIN_OPENID';

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const db = cloud.database();
  const _ = db.command;

  const { action, config, familyId } = event;

  // 1. 系统级 LLM 配置的读写操作必须强制校验超级管理员 OpenID
  if (action === 'saveLLMConfig' || action === 'getLLMConfig') {
    if (openid !== SUPER_ADMIN_OPENID) {
      return {
        success: false,
        message: '权限不足：您当前不是超级管理员，无法操作 API 凭证'
      };
    }
  }

  try {
    switch (action) {
      case 'saveLLMConfig': {
        // 保存 API 配置，保持全局单条记录在 system_config 中 (以 'global_config' 为 id)
        const configId = 'global_config';
        const configData = {
          llm_provider: config.llm_provider,
          api_key: config.api_key,
          base_url: config.base_url,
          model_name: config.model_name,
          updated_at: db.serverDate()
        };

        // 尝试获取，若存在则更新，不存在则新增
        const existRes = await db.collection('system_config').doc(configId).get().catch(() => null);
        
        if (existRes) {
          await db.collection('system_config').doc(configId).update({
            data: configData
          });
        } else {
          await db.collection('system_config').add({
            data: {
              _id: configId,
              ...configData
            }
          });
        }
        return { success: true, message: '配置保存成功' };
      }

      case 'getLLMConfig': {
        // 获取 API 配置
        const configId = 'global_config';
        const res = await db.collection('system_config').doc(configId).get().catch(() => null);
        if (res) {
          return { success: true, config: res.data };
        } else {
          return { success: true, config: {} };
        }
      }

      case 'incrementMemberCount': {
        // 增加家庭的成员数计数 (供审批通过时内部调用)
        if (!familyId) {
          return { success: false, message: '参数缺失 familyId' };
        }
        await db.collection('families').doc(familyId).update({
          data: {
            members_count: _.inc(1)
          }
        });
        return { success: true };
      }

      default:
        return { success: false, message: `不支持的操作 action: ${action}` };
    }
  } catch(err) {
    console.error('adminService 错误', err);
    return {
      success: false,
      message: '云函数内部执行出错',
      error: err.toString()
    };
  }
};
