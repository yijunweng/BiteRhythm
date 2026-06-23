// cloudfunctions/llmService/index.js
const cloud = require('wx-server-sdk');
const axios = require('axios');

// 导入外部提示词模板
const recommendNewMenuPrompt = require('./prompts/recommendNewMenu');
const recommendComplementaryMenuPrompt = require('./prompts/recommendComplementaryMenu');
const parseDishesPrompt = require('./prompts/parseDishes');
const generateShoppingListPrompt = require('./prompts/generateShoppingList');

// 导入大模型请求配置
const llmConfig = require('./config');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event, context) => {
  const db = cloud.database();
  const { action, familyId, date, text, existingDishes, forceReplan } = event;

  // 1. 获取全局大模型配置
  const configRes = await db.collection('system_config').doc('global_config').get().catch(() => null);
  if (!configRes || !configRes.data || !configRes.data.api_key) {
    return {
      success: false,
      message: '系统配置缺失：请联系超级管理员在“系统设置”页面配置大模型 API Key。'
    };
  }

  const { api_key, base_url, model_name } = configRes.data;

  let rawResponse = '';
  try {
    switch (action) {
      case 'recommendToday': {
        if (!familyId || !date) {
          return { success: false, message: '参数错误：缺失 familyId 或 date' };
        }

        // 1.1 获取家庭口味偏好与忌口
        const familyRes = await db.collection('families').doc(familyId).get().catch(() => null);
        const preferences = familyRes?.data?.preferences || '无特殊忌口，健康营养搭配';
        const aiConfig = familyRes?.data?.ai_config || {};
        const adults = aiConfig.adults !== undefined ? aiConfig.adults : 0;
        const kids = aiConfig.kids !== undefined ? aiConfig.kids : 0;
        const requirements = aiConfig.requirements || '无特殊要求';

        // 1.2 获取家庭收藏菜品库
        const dishesRes = await db.collection('dishes').where({ family_id: familyId }).limit(40).get();
        const dishesRepo = dishesRes.data.map(d => `${d.name}(${d.category || '热菜'})`).join(', ');

        // 1.3 获取最近 5 天的菜单（避免吃重复菜）
        const pastDate = new Date(new Date(date).getTime() - 5 * 24 * 60 * 60 * 1000);
        const pastDateStr = pastDate.toISOString().split('T')[0];
        
        const recentMenusRes = await db.collection('menus')
          .where({
            family_id: familyId,
            date: db.command.gte(pastDateStr).and(db.command.lt(date))
          }).get();

        const recentDishes = [];
        recentMenusRes.data.forEach(m => {
          if (m.dishes) {
            m.dishes.forEach(d => recentDishes.push(d.name));
          }
        });
        const recentDishesStr = recentDishes.length > 0 ? recentDishes.join(', ') : '无';

        // 1.4 解析并构建 Prompt
        const currentDishesList = (!forceReplan && existingDishes && Array.isArray(existingDishes)) ? existingDishes : [];
        const existingDishesStr = currentDishesList.length > 0
          ? currentDishesList.map(d => `${d.name}(${d.category || '热菜'})`).join(', ')
          : '无';

        let prompt = '';
        if (currentDishesList.length === 0) {
          prompt = recommendNewMenuPrompt({
            date,
            adults,
            kids,
            requirements,
            preferences,
            dishesRepo,
            recentDishesStr
          });
        } else {
          prompt = recommendComplementaryMenuPrompt({
            date,
            adults,
            kids,
            requirements,
            preferences,
            dishesRepo,
            recentDishesStr,
            existingDishesStr
          });
        }

        // 1.5 请求 LLM
        const response = await callLLM(base_url, api_key, model_name, prompt);
        rawResponse = response;
        const resultObj = cleanAndParseJson(response);

        let finalRecommendations = [];
        let status = 'complementary';
        let reason = '';

        if (resultObj && typeof resultObj === 'object' && !Array.isArray(resultObj)) {
          finalRecommendations = resultObj.recommendations || [];
          status = resultObj.status || 'complementary';
          reason = resultObj.reason || '';
        } else if (Array.isArray(resultObj)) {
          finalRecommendations = resultObj;
        }

        return {
          success: true,
          status: status,
          reason: reason,
          recommendations: finalRecommendations
        };
      }

      case 'parseDishes': {
        if (!text) {
          return { success: false, message: '参数错误：未提供待解析的文本内容' };
        }

        const prompt = parseDishesPrompt({ text });

        const response = await callLLM(base_url, api_key, model_name, prompt);
        rawResponse = response;
        const parsedDishes = cleanAndParseJson(response);

        return {
          success: true,
          dishes: parsedDishes
        };
      }

      case 'generateShoppingList': {
        if (!familyId || !date) {
          return { success: false, message: '参数错误：缺失 familyId 或 date' };
        }

        // 2.1 获取家庭口味偏好与忌口
        const familyRes = await db.collection('families').doc(familyId).get().catch(() => null);
        const preferences = familyRes?.data?.preferences || '无特殊忌口，健康营养搭配';
        const aiConfig = familyRes?.data?.ai_config || {};
        const adults = aiConfig.adults !== undefined ? aiConfig.adults : 0;
        const kids = aiConfig.kids !== undefined ? aiConfig.kids : 0;
        const requirements = aiConfig.requirements || '无特殊要求';

        // 2.2 获取该日期的菜单
        const menuId = `${familyId}_${date}`;
        const menuRes = await db.collection('menus').doc(menuId).get().catch(() => null);
        if (!menuRes || !menuRes.data || !menuRes.data.dishes || menuRes.data.dishes.length === 0) {
          return { success: false, message: '生成失败：该日期暂无已规划的菜品' };
        }
        const dishesList = menuRes.data.dishes.map(d => `${d.name}(${d.category || '热菜'})`).join(', ');

        // 2.3 构建 Prompt
        const prompt = generateShoppingListPrompt({
          adults,
          kids,
          dishesList,
          requirements,
          preferences
        });

        // 2.4 请求 LLM
        const response = await callLLM(base_url, api_key, model_name, prompt);
        rawResponse = response;

        // 2.5 保存采购建议到 menus 文档中
        await db.collection('menus').doc(menuId).update({
          data: {
            shopping_list: response,
            updated_at: db.serverDate()
          }
        });

        return {
          success: true,
          shoppingList: response
        };
      }

      default:
        return { success: false, message: `未知的操作: ${action}` };
    }

  } catch(err) {
    console.error('llmService 云函数出错', err);
    return {
      success: false,
      message: '智能分析服务异常，请稍后重试',
      error: err.toString(),
      rawResponse: rawResponse
    };
  }
};

// 封装大模型接口调用
async function callLLM(baseUrl, apiKey, model, prompt) {
  let url = baseUrl.replace(/\/$/, '');
  if (!url.endsWith('/chat/completions')) {
    url = `${url}/chat/completions`;
  }
  try {
    const response = await axios({
      method: 'post',
      url: url,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: model,
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: llmConfig.temperature,
        max_tokens: llmConfig.max_tokens
      },
      timeout: llmConfig.timeout
    });

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      const content = response.data.choices[0].message.content;
      if (content === undefined || content === null || content === '') {
        throw new Error(`LLM 接口返回内容为空，完整响应: ${JSON.stringify(response.data)}`);
      }
      return content;
    }
    throw new Error(`LLM 接口返回格式不符合预期，完整响应: ${JSON.stringify(response.data)}`);
  } catch (error) {
    if (error.response) {
      throw new Error(`请求大模型 API 失败 (状态码 ${error.response.status}): ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

// 清理 markdown 包裹并转化为 JSON
function cleanAndParseJson(str) {
  let cleaned = str.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  cleaned = cleaned.trim();
  
  try {
    return JSON.parse(cleaned);
  } catch(e) {
    console.error('JSON 转换为对象失败, 原字符串: ', str, e);
    
    // 容错机制 1：尝试提取第一个 { 和最后一个 } 之间的 JSON 对象
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (errObj) {
        console.error('容错提取 JSON 对象解析失败，尝试进行截断修复', errObj);
        const repaired = tryRepairTruncatedJson(objectMatch[0]);
        if (repaired) {
          console.log('截断 JSON 修复成功:', repaired);
          return repaired;
        }
      }
    }

    // 容错机制 2：尝试提取第一个 [ 和最后一个 ] 之间的 JSON 数组
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch (errArr) {
        console.error('容错提取 JSON 数组解析失败', errArr);
      }
    }
    
    throw e;
  }
}

// 尝试修复被截断的 JSON 对象并恢复部分数据
function tryRepairTruncatedJson(jsonStr) {
  try {
    // 1. 提取 status 和 reason
    let status = "complementary";
    let reason = "AI 推荐 (部分生成)";
    const statusMatch = jsonStr.match(/"status"\s*:\s*"([^"]+)"/);
    if (statusMatch) status = statusMatch[1];
    const reasonMatch = jsonStr.match(/"reason"\s*:\s*"([^"]+)"/);
    if (reasonMatch) reason = reasonMatch[1];

    // 2. 提取 recommendations 数组中所有完整的叶子对象
    const recommendations = [];
    const leafObjRegex = /\{[^{}]*\}/g;
    let match;
    while ((match = leafObjRegex.exec(jsonStr)) !== null) {
      try {
        const obj = JSON.parse(match[0]);
        if (obj && obj.name) {
          recommendations.push(obj);
        }
      } catch (err) {
        // 忽略解析失败的片段
      }
    }

    if (recommendations.length > 0) {
      return {
        status,
        reason,
        recommendations
      };
    }
  } catch (err) {
    console.error('修复截断 JSON 失败', err);
  }
  return null;
}
