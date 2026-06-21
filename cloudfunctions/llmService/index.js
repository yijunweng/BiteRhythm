// cloudfunctions/llmService/index.js
const cloud = require('wx-server-sdk');
const axios = require('axios');

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

        // 1.4 解析并构建 Prompt
        const currentDishesList = (!forceReplan && existingDishes && Array.isArray(existingDishes)) ? existingDishes : [];
        const existingDishesStr = currentDishesList.length > 0
          ? currentDishesList.map(d => `${d.name}(${d.category || '热菜'})`).join(', ')
          : '无';

        let prompt = '';
        if (currentDishesList.length === 0) {
          prompt = `你是一个家庭智能食谱搭配助手。请为家庭推荐今日(${date})的午餐/晚餐搭配。
用餐成员构成: 大人 ${adults} 人，小孩 ${kids} 人
特定配餐要求: ${requirements}
家庭口味偏好与忌口: ${preferences}
已收藏的家常菜候选库: [${dishesRepo}]
最近5天内吃过的菜(请尽量避开，保证多样性): [${recentDishesStr}]

推荐规则:
1. 优先从"已收藏的家常菜候选库"中进行挑选和组合。如果候选库较少，你可以适当推荐1-2道库外常见家常菜，但需符合偏好。
2. 推荐数量：由于用餐人数为大人 ${adults} 人，小孩 ${kids} 人，请提供合理的分量搭配和推荐数量：刚好3道菜（建议荤素搭配，如一荤一素一汤，或两荤一素，总共3个）。并请充分考虑大人 and 小孩的饮食喜好与忌口要求。
3. 必须输出合法的 JSON 格式对象，不要包含任何 markdown 标记(例如 \`\`\`json)，不要写任何前后置解释文案，直接输出以下 JSON 对象：
{
  "status": "complementary",
  "reason": "新搭配整餐",
  "recommendations": [
    {"name": "西红柿炒鸡蛋", "category": "热菜", "reason": "清淡美味，营养均衡"},
    {"name": "红烧排骨", "category": "热菜", "reason": "经典家常荤菜"},
    {"name": "紫菜蛋花汤", "category": "汤品", "reason": "简单快捷，润口去油腻"}
  ]
}

请生成今日搭配推荐:`;
        } else {
          prompt = `你是一个家庭智能食谱搭配助手。请为家庭推荐今日(${date})的午餐/晚餐搭配。
用餐成员构成: 大人 ${adults} 人，小孩 ${kids} 人
特定配餐要求: ${requirements}
家庭口味偏好与忌口: ${preferences}
已收藏的家常菜候选库: [${dishesRepo}]
最近5天内吃过的菜(请尽量避开，保证多样性): [${recentDishesStr}]
今日已选择的菜品: [${existingDishesStr}]

推荐规则:
1. 评估已选择的菜品 [${existingDishesStr}] 对当前家庭成员（大人 ${adults} 人，小孩 ${kids} 人）来说，分量与品类搭配是否已经足够（通常一餐需要 3-4 道菜，建议荤素搭配，有荤有素有汤）。
2. 如果你判断【已选择的菜品已经足够】，请设置 status 为 "sufficient"，并在 reason 中详细说明原因，同时 recommendations 数组留空。
3. 如果你判断【还需要补充/不搭配】，请设置 status 为 "complementary"，并在 recommendations 数组中推荐 1-2 道补充菜品（例如：如果目前只有肉菜，建议补充 1 道素菜或 1 道汤品，请不要推荐与已选菜品重复的菜，优先从候选库中挑选），同时在 reason 中说明需要补充哪些品类 and 原因。
4. 必须输出合法的 JSON 格式对象，不要包含任何 markdown 标记(例如 \`\`\`json)，不要写任何前后置解释文案，直接输出以下 JSON 对象：
{
  "status": "sufficient" 或 "complementary",
  "reason": "你的评估理由",
  "recommendations": [
    {"name": "菜品名称", "category": "分类", "reason": "推荐或补充该菜的理由"}
  ]
}

请进行评估并生成推荐:`;
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

        const prompt = `你是一个食谱数据解析助手。请从下面这段用户输入的文本中，提取出菜名，并识别它们属于哪个品类（分类仅限以下几个值之一：热菜, 凉菜, 汤品, 主食, 其它）。
        
用户文本: "${text}"

输出要求:
1. 必须输出合法的 JSON 数组，不要有 Markdown 格式包装，不要任何额外话语。
格式规范:
[
  {"name": "菜品名称", "category": "品类"}
]`;

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
        const prompt = `你是一个专业的家庭膳食采购助手。请为以下家庭生成今日的食材采购清单与建议。
用餐人口: 大人 ${adults} 人，小孩 ${kids} 人
今日菜谱包含的菜品: [${dishesList}]
特定配餐要求: ${requirements}
家庭口味偏好与忌口: ${preferences}

请根据以上信息，预测并列出烹饪这些菜品所需的全部食材，并给出建议购买的分量。
输出格式必须严格遵循以下结构（使用分隔线，必须包含"### 📋 详细采购建议"这一标题，且不要有任何 Markdown 代码块包裹）：

### 💡 简要提示
[这里用 1-2 句话极简概括今天需要采购的核心食材与建议采购要点，字数控制在 45 字以内]

---
### 📋 详细采购建议
# 今日食材采购清单 & 建议

## 📝 采购清单
[这里详细列出分类采购表格清单，如蔬菜类、肉蛋类等及其购买分量建议]

## 💡 温馨提示
[这里提供 1-2 条关于保鲜、烹饪顺序或食材替换的温馨建议]`;

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
