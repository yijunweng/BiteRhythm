// cloudfunctions/llmService/index.js
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event, context) => {
  const db = cloud.database();
  const { action, familyId, date, text } = event;

  // 1. 获取全局大模型配置
  const configRes = await db.collection('system_config').doc('global_config').get().catch(() => null);
  if (!configRes || !configRes.data || !configRes.data.api_key) {
    return {
      success: false,
      message: '系统配置缺失：请联系超级管理员在“系统设置”页面配置大模型 API Key。'
    };
  }

  const { api_key, base_url, model_name } = configRes.data;

  try {
    switch (action) {
      case 'recommendToday': {
        if (!familyId || !date) {
          return { success: false, message: '参数错误：缺失 familyId 或 date' };
        }

        // 1.1 获取家庭口味偏好与忌口
        const familyRes = await db.collection('families').doc(familyId).get().catch(() => null);
        const preferences = familyRes?.data?.preferences || '无特殊忌口，健康营养搭配';

        // 1.2 获取家庭收藏菜品库
        const dishesRes = await db.collection('dishes').where({ family_id: familyId }).limit(100).get();
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

        // 1.4 构建 Prompt
        const prompt = `你是一个家庭智能食谱搭配助手。请为家庭推荐今日(${date})的午餐/晚餐搭配。
家庭偏好与忌口: ${preferences}
已收藏的家常菜候选库: [${dishesRepo}]
最近5天内吃过的菜(请尽量避开，保证多样性): [${recentDishesStr}]

推荐规则:
1. 优先从"已收藏的家常菜候选库"中进行挑选和组合。如果候选库较少，你可以适当推荐1-2道库外常见家常菜，但需符合偏好。
2. 推荐数量：刚好3道菜（建议荤素搭配，如一荤一素一汤，或两荤一素，总共3个）。
3. 必须输出合法的 JSON 数组格式，不要包含任何 markdown 标记(例如 \`\`\`json)，不要写任何前后置解释文案，直接输出 JSON 数组。
JSON 数组格式示例如下:
[
  {"name": "西红柿炒鸡蛋", "category": "热菜", "reason": "清淡美味，营养均衡"},
  {"name": "红烧排骨", "category": "热菜", "reason": "经典家常荤菜"},
  {"name": "紫菜蛋花汤", "category": "汤品", "reason": "简单快捷，润口去油腻"}
]

请生成今日搭配推荐:`;

        // 1.5 请求 LLM
        const response = await callLLM(base_url, api_key, model_name, prompt);
        const recommendations = cleanAndParseJson(response);

        return {
          success: true,
          recommendations: recommendations
        };
      }

      case 'parseDishes': {
        if (!text) {
          return { success: false, message: '参数错误：未提供待解析的文本内容' };
        }

        const prompt = `你是一个食谱数据解析助手。请从下面这段用户输入的文本中，提取出菜名，并识别它们属于哪个品类（分类仅限以下几个值之一：热菜, 凉菜, 汤品, 主食, 其它）。
        
用户文本: "${text}"

输出要求:
1. 必须输出合法的 JSON 数组，不要有 Markdown 格式包装，不要任何额外话语。
格式规范:
[
  {"name": "菜品名称", "category": "品类"}
]`;

        const response = await callLLM(base_url, api_key, model_name, prompt);
        const parsedDishes = cleanAndParseJson(response);

        return {
          success: true,
          dishes: parsedDishes
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
      error: err.toString()
    };
  }
};

// 封装大模型接口调用
async function callLLM(baseUrl, apiKey, model, prompt) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
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
      temperature: 0.7,
      max_tokens: 1000
    },
    timeout: 15000 // 15秒超时
  });

  if (response.data && response.data.choices && response.data.choices.length > 0) {
    return response.data.choices[0].message.content;
  }
  throw new Error('LLM 接口返回空数据');
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
    // 简易容错机制：尝试正则表达式匹配 JSON 数组
    const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]);
    }
    throw e;
  }
}
