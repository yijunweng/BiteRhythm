// cloudfunctions/login/index.js
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const db = cloud.database();
  let dbConfig = null;
  
  try {
    const configRes = await db.collection('system_config').doc('global_config').get().catch(() => null);
    if (configRes && configRes.data) {
      dbConfig = {
        hasApiKey: !!configRes.data.api_key,
        apiKeyLength: configRes.data.api_key ? configRes.data.api_key.length : 0,
        apiKeyPrefix: configRes.data.api_key ? configRes.data.api_key.substring(0, 8) + '...' : 'none',
        baseUrl: configRes.data.base_url,
        modelName: configRes.data.model_name,
        llmProvider: configRes.data.llm_provider
      };
    } else {
      dbConfig = { status: 'global_config document not found or empty' };
    }
  } catch (err) {
    dbConfig = { error: err.toString() };
  }

  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
    env: wxContext.ENV,
    dbConfig: dbConfig
  };
};
