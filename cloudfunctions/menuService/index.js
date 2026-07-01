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

    // 并发查询家庭信息和成员身份
    const [familyRes, memberRes] = await Promise.all([
      db.collection('families').doc(familyId).get().catch(() => null),
      db.collection('family_members')
        .where({
          family_id: familyId,
          openid: openid,
          status: 'approved'
        }).get().catch(() => ({ data: [] }))
    ]);

    // 1.1 检查是否是家庭的创建者
    if (familyRes && familyRes.data && familyRes.data.creator_openid === openid) {
      hasWriteAccess = true;
    }

    // 1.2 检查是否是授权的写权限成员 (role = 'admin' 或 'write')
    if (!hasWriteAccess && memberRes && memberRes.data && memberRes.data.length > 0) {
      const role = memberRes.data[0].role;
      if (role === 'admin' || role === 'write') {
        hasWriteAccess = true;
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

        if (dishes.length === 0) {
          await db.collection('menus').doc(menuId).remove().catch(() => null);
          return { success: true, message: '菜单已成功清空' };
        }

        // 使用 set() 直接覆盖或创建文档，省去一次 get() 检查
        await db.collection('menus').doc(menuId).set({
          data: menuData
        });

        // 自动将新规划的自定义菜品同步保存到家庭菜品库中，防止在“别处”使用时没有实时更新
        try {
          if (dishes.length > 0) {
            // 1. 获取该家庭目前已有的所有菜品名字
            const existingDishesRes = await db.collection('dishes')
              .where({ family_id: familyId })
              .field({ name: true })
              .limit(500)
              .get();
            const existingNames = new Set(existingDishesRes.data.map(d => d.name));

            // 2. 找出当前菜单里，菜品库中不存在的新菜品
            const newDishes = dishes.filter(d => d.name && d.name.trim() && !existingNames.has(d.name.trim()));

            // 3. 将新菜品批量加入菜品库
            if (newDishes.length > 0) {
              const addPromises = newDishes.map(d => {
                return db.collection('dishes').add({
                  data: {
                    family_id: familyId,
                    name: d.name.trim(),
                    category: d.category || '热菜',
                    created_at: db.serverDate()
                  }
                });
              });
              await Promise.all(addPromises);
            }
          }
        } catch (syncErr) {
          console.error('同步新菜品到菜品库失败', syncErr);
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

      case 'addDish': {
        const { name, category, remark, practice } = event;
        if (!name) return { success: false, message: '参数缺失 name' };
        
        // 检查是否重名
        const checkRes = await db.collection('dishes').where({
          family_id: familyId,
          name: name.trim()
        }).get();
        if (checkRes.data.length > 0) {
          return { success: false, message: '已存在同名菜品' };
        }

        const addRes = await db.collection('dishes').add({
          data: {
            family_id: familyId,
            name: name.trim(),
            category: category || '热菜',
            remark: remark || '',
            practice: practice || '',
            creator_openid: openid,
            created_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        });
        return { success: true, _id: addRes._id, message: '添加成功' };
      }

      case 'updateDish': {
        const { dishId, name, category, remark, practice } = event;
        if (!dishId || !name) return { success: false, message: '参数缺失 dishId 或 name' };

        // 检查重名 (排除自身)
        const checkRes = await db.collection('dishes').where({
          family_id: familyId,
          name: name.trim()
        }).get();
        const duplicate = checkRes.data.find(d => d._id !== dishId);
        if (duplicate) {
          return { success: false, message: '已存在同名菜品' };
        }

        await db.collection('dishes').doc(dishId).update({
          data: {
            name: name.trim(),
            category: category || '热菜',
            remark: remark || '',
            practice: practice || '',
            updated_at: db.serverDate()
          }
        });
        return { success: true, message: '修改成功' };
      }

      case 'deleteDish': {
        const { dishId } = event;
        if (!dishId) return { success: false, message: '参数缺失 dishId' };
        await db.collection('dishes').doc(dishId).remove();
        return { success: true, message: '删除成功' };
      }

      case 'batchDeleteDishes': {
        const { dishIds } = event;
        if (!Array.isArray(dishIds) || dishIds.length === 0) {
          return { success: false, message: '参数错误：dishIds 格式不正确或为空' };
        }
        const _ = db.command;
        await db.collection('dishes').where({
          _id: _.in(dishIds)
        }).remove();
        return { success: true, message: '批量删除成功' };
      }

      case 'batchAddDishes': {
        const { dishesList } = event;
        if (!Array.isArray(dishesList) || dishesList.length === 0) {
          return { success: false, message: '参数错误：dishesList 格式不正确或为空' };
        }

        const addedDishes = [];
        for (const dish of dishesList) {
          if (!dish.name) continue;
          
          // 检查是否重名
          const checkRes = await db.collection('dishes').where({
            family_id: familyId,
            name: dish.name.trim()
          }).get();
          if (checkRes.data.length > 0) {
            continue; // 跳过重名
          }

          const addRes = await db.collection('dishes').add({
            data: {
              family_id: familyId,
              name: dish.name.trim(),
              category: dish.category || '热菜',
              remark: dish.remark || '',
              practice: dish.practice || '',
              creator_openid: openid,
              created_at: db.serverDate(),
              updated_at: db.serverDate()
            }
          });
          addedDishes.push({
            _id: addRes._id,
            family_id: familyId,
            name: dish.name.trim(),
            category: dish.category || '热菜',
            remark: dish.remark || '',
            practice: dish.practice || '',
            created_at: new Date(),
            updated_at: new Date()
          });
        }
        return { success: true, addedDishes, message: '批量导入成功' };
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
