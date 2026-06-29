// cloudfunctions/adminService/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// 全局缓存超级管理员 OpenID，减少暖启动时的数据库查询开销
let cachedSuperAdminOpenid = null;

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const db = cloud.database();
  const _ = db.command;

  const { action, config, familyId } = event;

  // ============================================================
  // 超级管理员 OpenID 校验
  // 从 system_config 读取 super_admin_openid，实现运行时动态校验，
  // 避免硬编码在云函数代码中（部署更新时无需重新上传）
  // ============================================================
  const getSuperAdminOpenid = async () => {
    if (cachedSuperAdminOpenid) {
      return cachedSuperAdminOpenid;
    }
    try {
      const res = await db.collection('system_config').doc('global_config').get().catch(() => null);
      if (res && res.data && res.data.super_admin_openid) {
        cachedSuperAdminOpenid = res.data.super_admin_openid;
        return cachedSuperAdminOpenid;
      }
    } catch (e) { /* ignore */ }
    return null;
  };

  // 需要超管权限的操作
  const adminRequiredActions = ['saveLLMConfig', 'getLLMConfig'];
  if (adminRequiredActions.includes(action)) {
    const superAdminOpenid = await getSuperAdminOpenid();
    if (!superAdminOpenid) {
      return {
        success: false,
        message: '系统尚未初始化超管 OpenID，请先调用 initSuperAdmin 完成初始化。'
      };
    }
    if (openid !== superAdminOpenid) {
      return {
        success: false,
        message: '权限不足：您当前不是超级管理员，无法操作 API 凭证'
      };
    }
  }

  try {
    switch (action) {

      // 初始化：写入超管 OpenID（仅允许调用一次，已存在则拒绝）
      case 'initSuperAdmin': {
        const existRes = await db.collection('system_config').doc('global_config').get().catch(() => null);
        if (existRes && existRes.data && existRes.data.super_admin_openid) {
          // 已存在超管，拒绝覆盖（防止被普通用户劫持）
          return { success: false, message: '超管 OpenID 已初始化，不可重复设置。' };
        }
        // 第一次调用：将当前调用者的 openid 设为超管
        const configData = {
          super_admin_openid: openid,
          initialized_at: db.serverDate()
        };
        if (existRes) {
          await db.collection('system_config').doc('global_config').update({ data: configData });
        } else {
          await db.collection('system_config').add({ data: { _id: 'global_config', ...configData } });
        }
        cachedSuperAdminOpenid = openid;
        return { success: true, message: '超管 OpenID 初始化成功', openid };
      }

      case 'getSuperAdminStatus': {
        // 返回当前用户是否是超管（不暴露 OpenID）
        const superAdminOpenid = await getSuperAdminOpenid();
        return {
          success: true,
          isSystemAdmin: openid === superAdminOpenid,
          initialized: !!superAdminOpenid
        };
      }

      case 'saveLLMConfig': {
        const configId = 'global_config';
        // 只更新提供的字段，api_key 若未传入则不覆盖原值
        const configData = {
          llm_provider: config.llm_provider,
          base_url: config.base_url,
          model_name: config.model_name,
          updated_at: db.serverDate()
        };
        if (config.api_key) {
          configData.api_key = config.api_key;
        }
        if (config.disable_reasoning !== undefined) {
          configData.disable_reasoning = config.disable_reasoning;
        }
        if (config.reasoning_effort !== undefined) {
          configData.reasoning_effort = config.reasoning_effort;
        }
        const existRes = await db.collection('system_config').doc(configId).get().catch(() => null);
        if (existRes) {
          await db.collection('system_config').doc(configId).update({ data: configData });
        } else {
          await db.collection('system_config').add({ data: { _id: configId, ...configData } });
        }
        return { success: true, message: '配置保存成功' };
      }


      case 'getLLMConfig': {
        const configId = 'global_config';
        const res = await db.collection('system_config').doc(configId).get().catch(() => null);
        if (res) {
          // 不返回 api_key 的明文，只返回有无配置的状态 + 其他字段
          const { api_key, ...safeData } = res.data;
          return { success: true, config: { ...safeData, api_key_set: !!api_key } };
        }
        return { success: true, config: {} };
      }

      case 'incrementMemberCount': {
        if (!familyId) return { success: false, message: '参数缺失 familyId' };
        await db.collection('families').doc(familyId).update({ data: { members_count: _.inc(1) } });
        return { success: true };
      }

      case 'deleteFamily': {
        if (!familyId) return { success: false, message: '参数缺失 familyId' };
        
        // 1. 校验当前用户是否为该家庭的管理员
        const memberRes = await db.collection('family_members').where({
          family_id: familyId,
          openid: openid,
          role: 'admin'
        }).get();
        
        if (memberRes.data.length === 0) {
          return { success: false, message: '权限不足：只有家庭管理员可以删除该家庭' };
        }
        
        // 2. 并行删除关联的所有数据
        await Promise.all([
          db.collection('dishes').where({ family_id: familyId }).remove(),
          db.collection('menus').where({ family_id: familyId }).remove(),
          db.collection('family_members').where({ family_id: familyId }).remove(),
          db.collection('families').doc(familyId).remove()
        ]);
        
        return { success: true, message: '家庭及关联数据已成功删除' };
      }

      default:
        return { success: false, message: `不支持的操作 action: ${action}` };
    }
  } catch (err) {
    console.error('adminService 错误', err);
    return {
      success: false,
      message: '云函数内部执行出错',
      error: err.toString()
    };
  }
};
