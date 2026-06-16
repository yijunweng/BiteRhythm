// cloudfunctions/menuService/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const db = cloud.database();

  const { action, familyId, date, dishes } = event;

  if (!familyId) {
    return { success: false, message: '操作失败：参数缺失 familyId' };
  }

  try {
    // ================= 1. 安全控制：校验用户在家庭中的写权限 =================
    let hasWriteAccess = false;

    // 1.1 检查是否是家庭的创建者
    const familyRes = await db.collection('families').doc(familyId).get().catch(() => null);
    if (familyRes && familyRes.data.creator_openid === openid) {
      hasWriteAccess = true;
    }

    // 1.2 检查是否是授权的写权限成员 (role = 'admin' 或 'write')
    if (!hasWriteAccess) {
      const memberRes = await db.collection('family_members')
        .where({
          family_id: familyId,
          openid: openid,
          status: 'approved'
        }).get();

      if (memberRes.data.length > 0) {
        const role = memberRes.data[0].role;
        if (role === 'admin' || role === 'write') {
          hasWriteAccess = true;
        }
      }
    }

    // 拦截无写入权限的请求 (如阿姨角色 role = 'read'，或非成员)
    if (!hasWriteAccess) {
      return {
        success: false,
        message: '权限不足：您当前是只读角色或非该家庭群组成员，无权修改菜单或菜品库'
      };
    }

    // ================= 2. 核心业务逻辑执行 =================
    switch (action) {
      case 'saveMenu': {
        if (!date || !Array.isArray(dishes)) {
          return { success: false, message: '参数错误：date 或 dishes 格式不正确' };
        }
        
        // 使用 familyId_date 作为主键保证唯一性，防止并发写入导致重复数据
        const menuId = `${familyId}_${date}`;
        const menuData = {
          family_id: familyId,
          date: date,
          dishes: dishes,
          updated_at: db.serverDate()
        };

        const existMenu = await db.collection('menus').doc(menuId).get().catch(() => null);

        if (existMenu) {
          await db.collection('menus').doc(menuId).update({
            data: menuData
          });
        } else {
          await db.collection('menus').add({
            data: {
              _id: menuId,
              ...menuData
            }
          });
        }

        return { success: true, message: '菜单保存成功' };
      }

      case 'clearMenu': {
        if (!date) {
          return { success: false, message: '参数错误：未提供要清空菜单的日期' };
        }
        const menuId = `${familyId}_${date}`;
        await db.collection('menus').doc(menuId).remove().catch(() => null);
        return { success: true, message: '菜单已成功清空' };
      }

      default:
        return { success: false, message: `不支持的动作: ${action}` };
    }

  } catch(err) {
    console.error('menuService 发生错误', err);
    return {
      success: false,
      message: '云服务内部错误',
      error: err.toString()
    };
  }
};
