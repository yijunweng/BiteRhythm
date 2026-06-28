// test/run-tests.js
const Module = require('module');
const path = require('path');
const mockSdk = require('./mock-wx-sdk');

// 1. Mock global axios for LLM calls
const mockAxios = async (config) => {
  mockAxios.calls.push(config);
  if (mockAxios.response) return mockAxios.response;
  return {
    data: {
      choices: [
        {
          message: {
            content: mockAxios.mockContent || '{"status": "complementary", "recommendations": []}'
          }
        }
      ]
    }
  };
};
mockAxios.calls = [];
mockAxios.mockContent = '';

// 2. Intercept requires globally using Module.prototype.require
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'wx-server-sdk') {
    return mockSdk;
  }
  if (id === 'axios') {
    return mockAxios;
  }
  return originalRequire.apply(this, arguments);
};

// 3. Load cloud functions
const adminService = require('../cloudfunctions/adminService/index.js');
const loginService = require('../cloudfunctions/login/index.js');
const menuService = require('../cloudfunctions/menuService/index.js');
const llmService = require('../cloudfunctions/llmService/index.js');

// 4. Test runner helper functions
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTest(name, fn) {
  try {
    mockSdk.dbInstance.resetOpsCount();
    mockAxios.calls = [];
    mockAxios.mockContent = '';
    mockAxios.response = null;
    await fn();
    console.log(`\x1b[32m✔ PASS:\x1b[0m ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`\x1b[31m✘ FAIL:\x1b[0m ${name}`);
    console.error(err);
    failedTests++;
  }
}

// 5. Main test execution function
async function main() {
  console.log('🚀 Starting BiteRhythm Performance & Coverage Unit Tests...\n');
  const db = mockSdk.dbInstance;

  // ==========================================
  // Test Case 1: login cloud function
  // ==========================================
  await runTest('loginService should return openid and empty config status initially', async () => {
    mockSdk.openid = 'user_1';
    db.collections.system_config = []; // reset DB config
    const res = await loginService.main({}, {});
    assert(res.openid === 'user_1', 'should return correct openid');
    assert(res.dbConfig.status === 'global_config document not found or empty', 'should indicate empty config');
  });

  // ==========================================
  // Test Case 2: adminService super admin initialization
  // ==========================================
  await runTest('adminService - initSuperAdmin', async () => {
    mockSdk.openid = 'super_admin_user';
    db.collections.system_config = []; // reset

    // First init should succeed
    const res1 = await adminService.main({ action: 'initSuperAdmin' }, {});
    assert(res1.success === true, 'should initialize successfully');
    assert(res1.openid === 'super_admin_user', 'should record the openid');

    // Verify it is written to DB
    const dbRecord = db.collections.system_config.find(x => x._id === 'global_config');
    assert(dbRecord.super_admin_openid === 'super_admin_user', 'should save openid in system_config');

    // Second init should fail
    const res2 = await adminService.main({ action: 'initSuperAdmin' }, {});
    assert(res2.success === false, 'should fail on second init');
    assert(res2.message.includes('不可重复设置'), 'should show duplicate message');
  });

  // ==========================================
  // Test Case 3: adminService permissions and LLM configuration
  // ==========================================
  await runTest('adminService - saveLLMConfig / getLLMConfig permissions', async () => {
    // Non-admin user tries to save
    mockSdk.openid = 'normal_user';
    const res1 = await adminService.main({
      action: 'saveLLMConfig',
      config: { llm_provider: 'deepseek', api_key: 'sk-123', base_url: 'https://api.deepseek.com', model_name: 'deepseek-chat' }
    }, {});
    assert(res1.success === false, 'should deny non-admin user');
    assert(res1.message.includes('权限不足'), 'should explain permission error');

    // Admin user saves config
    mockSdk.openid = 'super_admin_user';
    const res2 = await adminService.main({
      action: 'saveLLMConfig',
      config: { llm_provider: 'deepseek', api_key: 'sk-123', base_url: 'https://api.deepseek.com', model_name: 'deepseek-chat' }
    }, {});
    assert(res2.success === true, 'should allow admin to save config');

    // Verify config is saved in DB
    const configDoc = db.collections.system_config.find(x => x._id === 'global_config');
    assert(configDoc.llm_provider === 'deepseek', 'provider should be deepseek');
    assert(configDoc.api_key === 'sk-123', 'api_key should be sk-123');

    // Admin user gets LLM config (api_key should be masked)
    const res3 = await adminService.main({ action: 'getLLMConfig' }, {});
    assert(res3.success === true, 'should fetch config successfully');
    assert(res3.config.llm_provider === 'deepseek', 'should contain provider');
    assert(res3.config.api_key === undefined, 'api_key should NOT be returned directly');
    assert(res3.config.api_key_set === true, 'should indicate api_key is set');
  });

  // ==========================================
  // Test Case 4: adminService deleteFamily and parallel DB removes
  // ==========================================
  await runTest('adminService - deleteFamily permissions & parallel DB ops', async () => {
    db.collections.families = [{ _id: 'fam_1', name: 'Family 1', creator_openid: 'creator_1' }];
    db.collections.family_members = [
      { _id: 'm_1', family_id: 'fam_1', openid: 'creator_1', role: 'admin', status: 'approved' },
      { _id: 'm_2', family_id: 'fam_1', openid: 'normal_1', role: 'write', status: 'approved' }
    ];
    db.collections.dishes = [{ _id: 'dish_1', family_id: 'fam_1', name: 'Beef' }];
    db.collections.menus = [{ _id: 'menu_1', family_id: 'fam_1', date: '2026-06-20', dishes: [] }];

    // Non-admin of family tries to delete
    mockSdk.openid = 'normal_1';
    const res1 = await adminService.main({ action: 'deleteFamily', familyId: 'fam_1' }, {});
    assert(res1.success === false, 'should deny write-only member from deleting family');

    // Admin of family deletes
    mockSdk.openid = 'creator_1';
    db.resetOpsCount();
    const res2 = await adminService.main({ action: 'deleteFamily', familyId: 'fam_1' }, {});
    assert(res2.success === true, 'should allow family admin to delete');

    // Verify all collections are cleaned up
    assert(db.collections.families.length === 0, 'family should be deleted');
    assert(db.collections.family_members.length === 0, 'members should be deleted');
    assert(db.collections.dishes.length === 0, 'dishes should be deleted');
    assert(db.collections.menus.length === 0, 'menus should be deleted');

    // Verify parallel delete operations count (4 remove calls)
    assert(db.opsCount.remove === 4, 'should execute 4 removals concurrently');
  });

  // ==========================================
  // Test Case 5: menuService safety checks & saveMenu (Upsert)
  // ==========================================
  await runTest('menuService - write permission safety and saveMenu direct upsert', async () => {
    db.collections.families = [
      { _id: 'fam_1', name: 'Fam 1', creator_openid: 'creator_1' },
      { _id: 'fam_2', name: 'Fam 2', creator_openid: 'creator_2' }
    ];
    db.collections.family_members = [
      { _id: 'mem_1', family_id: 'fam_1', openid: 'write_user', role: 'write', status: 'approved' },
      { _id: 'mem_2', family_id: 'fam_1', openid: 'read_user', role: 'read', status: 'approved' }
    ];
    db.collections.menus = [];

    // Scenario A: Non-member writes -> denied
    mockSdk.openid = 'stranger_user';
    const res1 = await menuService.main({ action: 'saveMenu', familyId: 'fam_1', date: '2026-06-25', dishes: [] }, {});
    assert(res1.success === false, 'should deny stranger write');

    // Scenario B: Read-only member (阿姨) writes -> denied
    mockSdk.openid = 'read_user';
    const res2 = await menuService.main({ action: 'saveMenu', familyId: 'fam_1', date: '2026-06-25', dishes: [] }, {});
    assert(res2.success === false, 'should deny read-only member write');

    // Scenario C: Creator writes -> allowed
    mockSdk.openid = 'creator_1';
    db.resetOpsCount();
    const res3 = await menuService.main({
      action: 'saveMenu',
      familyId: 'fam_1',
      date: '2026-06-25',
      dishes: [{ name: 'Tomato Egg', category: '素菜' }]
    }, {});
    assert(res3.success === true, 'creator should be allowed to write');
    assert(db.collections.menus.length === 1, 'should save menu document');

    // Check query performance: DB operations should show 0 GETs and 1 SET for saveMenu
    // (excluding 2 GETs for creator validation)
    assert(db.opsCount.set === 1, 'should use doc().set() directly');

    // Scenario D: Write-role member updates same menu -> allowed and updates in-place
    mockSdk.openid = 'write_user';
    db.resetOpsCount();
    const res4 = await menuService.main({
      action: 'saveMenu',
      familyId: 'fam_1',
      date: '2026-06-25',
      dishes: [{ name: 'Tomato Egg', category: '素菜' }, { name: 'Fried Beef', category: '荤菜' }]
    }, {});
    assert(res4.success === true, 'write member should save successfully');
    assert(db.collections.menus.length === 1, 'no duplicate menus created');
    assert(db.collections.menus[0].dishes.length === 2, 'dishes updated successfully');
    assert(db.opsCount.set === 1, 'should update menu with single set() upsert');
  });

  // ==========================================
  // Test Case 6: llmService - recommendToday optimization
  // ==========================================
  await runTest('llmService - recommendToday DB parallelization and JSON parsing', async () => {
    // Populate DB
    db.collections.system_config = [
      { _id: 'global_config', api_key: 'sk-llm-123', base_url: 'https://api.llm.com', model_name: 'gpt-4o' }
    ];
    db.collections.families = [
      { _id: 'fam_1', name: 'Fam 1', creator_openid: 'creator_1', preferences: '不辣', ai_config: { adults: 2, kids: 1, requirements: '少盐' } }
    ];
    db.collections.dishes = [
      { _id: 'd1', family_id: 'fam_1', name: 'Dish A' },
      { _id: 'd2', family_id: 'fam_1', name: 'Dish B' }
    ];
    db.collections.menus = [
      { _id: 'fam_1_2026-06-20', family_id: 'fam_1', date: '2026-06-20', dishes: [{ name: 'Dish C' }] }
    ];

    // Mock LLM Response
    mockAxios.mockContent = '```json\n{"status": "complementary", "reason": "Test reason", "recommendations": [{"name": "Dish A", "category": "荤菜"}]}\n```';

    mockSdk.openid = 'creator_1';
    db.resetOpsCount();
    
    const res = await llmService.main({
      action: 'recommendToday',
      familyId: 'fam_1',
      date: '2026-06-25'
    }, {});

    assert(res.success === true, 'recommendation should succeed');
    assert(res.status === 'complementary', 'should extract status');
    assert(res.recommendations[0].name === 'Dish A', 'should extract recommended dishes');

    // Verify DB operations count: config get is warm-cached (0 ops if cached, but since this is first run it might be 1).
    // Let's assert database ops for the rest are concurrent.
    // The parallel DB call does: families doc get, dishes where get, menus where get.
    // That's exactly 3 database gets. Let's make sure it's 3 gets (excluding config get, so 4 gets max).
    assert(db.opsCount.get <= 4, `should parallelize queries, got ${db.opsCount.get} gets`);

    // Verify Prompt construction passed correct parameters to LLM
    assert(mockAxios.calls.length === 1, 'should call LLM once');
    const promptSent = mockAxios.calls[0].data.messages[0].content;
    assert(promptSent.includes('Dish A'), 'should include dishes repo in prompt');
    assert(promptSent.includes('Dish C'), 'should include recent dishes in prompt');
    assert(promptSent.includes('少盐'), 'should include requirements in prompt');
  });

  // ==========================================
  // Test Case 7: llmService - JSON repair fallback
  // ==========================================
  await runTest('llmService - JSON repair fallback for truncated LLM responses', async () => {
    db.collections.system_config = [
      { _id: 'global_config', api_key: 'sk-llm-123', base_url: 'https://api.llm.com', model_name: 'gpt-4o' }
    ];

    // Simulating truncated JSON response
    mockAxios.mockContent = `
    Some conversational text before JSON...
    {
      "status": "complementary",
      "reason": "AI 推荐 (部分生成)",
      "recommendations": [
        {"name": "Steamed Chicken", "category": "荤菜"},
        {"name": "Stir-fried Cabbage", "category": "素菜"}
    `; // Truncated without ending brackets

    mockSdk.openid = 'creator_1';
    
    const res = await llmService.main({
      action: 'recommendToday',
      familyId: 'fam_1',
      date: '2026-06-25'
    }, {});

    assert(res.success === true, 'should succeed by repairing truncated JSON');
    assert(res.recommendations.length === 2, 'should successfully recover complete leaf objects');
    assert(res.recommendations[0].name === 'Steamed Chicken', 'recovered first object');
    assert(res.recommendations[1].name === 'Stir-fried Cabbage', 'recovered second object');
  });

  // ==========================================
  // Test Case 8: llmService - generateShoppingList parallel queries
  // ==========================================
  await runTest('llmService - generateShoppingList parallel queries & update menus', async () => {
    db.collections.system_config = [
      { _id: 'global_config', api_key: 'sk-llm-123', base_url: 'https://api.llm.com', model_name: 'gpt-4o' }
    ];
    db.collections.families = [
      { _id: 'fam_1', creator_openid: 'creator_1', preferences: '无', ai_config: { adults: 2, kids: 1 } }
    ];
    db.collections.menus = [
      { _id: 'fam_1_2026-06-25', family_id: 'fam_1', date: '2026-06-25', dishes: [{ name: 'Steamed Chicken' }] }
    ];

    mockAxios.mockContent = '### 💡 简要提示\nBuy some chicken.\n### 📋 详细采购建议\nChicken: 500g';

    mockSdk.openid = 'creator_1';
    db.resetOpsCount();

    const res = await llmService.main({
      action: 'generateShoppingList',
      familyId: 'fam_1',
      date: '2026-06-25'
    }, {});

    assert(res.success === true, 'should generate shopping list');
    assert(res.shoppingList.includes('Buy some chicken'), 'should contain the content');

    // Verify DB operations: Parallel read (1 get for family, 1 get for menu -> 2 gets). Plus config fetch (already cached in LLMConfig, so 0 gets).
    // Plus update operation (1 update call).
    assert(db.opsCount.get <= 2, `should parallelize reads, got ${db.opsCount.get} gets`);
    assert(db.opsCount.update === 1, 'should update menu with shopping list');

    // Verify shopping list is saved in DB
    const savedMenu = db.collections.menus.find(x => x._id === 'fam_1_2026-06-25');
    assert(savedMenu.shopping_list.includes('Buy some chicken'), 'shopping list should be persisted');
  });

  console.log('\n================================================');
  console.log(`Test Execution Finished: ${passedTests} passed, ${failedTests} failed.`);
  console.log('================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal testing error:', err);
  process.exit(1);
});
