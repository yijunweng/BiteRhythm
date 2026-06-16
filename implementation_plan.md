# 胃口周刊 (Appetite Weekly) - 实现计划

本项目是一个基于微信小程序云开发 (CloudBase) 和大模型 (LLM) 构建的家庭周菜单规划系统。本项目旨在免除传统后端运维的前提下，利用云数据库和云函数完成权限控制与大模型排餐功能。

---

## 1. 用户审查与决策 (User Review Required)

> [!IMPORTANT]
> **超级管理员 OpenID 的绑定方式**
> 为确保系统的绝对安全且只有您是超级管理员，我们需要将您的微信 OpenID 绑定在系统中：
> 1. 我们会在前端和云函数的代码配置项中留出 `SUPER_ADMIN_OPENID` 占位符。
> 2. 小程序初次运行后，您可以在微信开发者工具的云开发控制台，或者小程序界面的“关于我/我的”页面复制您的 OpenID，并填写到配置文件中重新部署，以此锁定超级管理员权限。
> 
> 请您知悉此配置步骤。

> [!TIP]
> **UI 风格设计**
> 我们将采用手写精美 Vanilla CSS，结合 Glassmorphism (毛玻璃) 效果、顺滑的卡片过渡动画，配置高级深色模式/莫兰迪暖色调，从而呈现出远超传统 Vant/WeUI 等组件库的 Premium (高端) 视觉质感。

---

## 2. 数据库设计 (Database Schema)

我们将使用微信云数据库 (NoSQL) 创建以下集合 (Collections)：

| 集合名称 | 说明 | 核心字段描述 |
| :--- | :--- | :--- |
| `system_config` | 系统全局配置（仅超级管理员可读写） | `_id`, `llm_provider` (如 deepseek/openai), `api_key`, `base_url`, `model_name` |
| `families` | 家庭基本信息表 | `_id`, `name` (家庭名称), `members_count` (人数), `preferences` (饮食偏好/忌口), `creator_openid` |
| `family_members` | 成员权限关系表 | `_id`, `family_id`, `openid`, `nickname`, `avatar_url`, `role` (`'admin'`/`'write'`/`'read'`), `status` (`'pending'`/`'approved'`) |
| `dishes` | 收藏的菜品库 | `_id`, `family_id`, `name` (菜名), `category` (肉类/素菜/汤等), `tags` (口味/主料), `creator_openid` |
| `menus` | 每日菜谱计划表 | `_id` (格式: `familyId_yyyy-MM-dd`), `family_id`, `date` (形如 `2026-06-17`), `dishes` (菜品数组: `[{name: '辣椒炒肉', id: 'xxx'}]`), `updated_at` |

---

## 3. 拟做出的修改与目录结构 (Proposed Changes)

为了实现该小程序，我们将初始化一个符合微信小程序云开发规范的项目目录：

```
myProject/
├── cloudfunctions/             # 云函数目录
│   ├── login/                  # 登录并获取 OpenID 的云函数 [NEW]
│   ├── adminService/           # 超级管理员服务 (修改 LLM 配置, 审核成员) [NEW]
│   ├── menuService/            # 菜单与菜品管理服务 (包含权限校验) [NEW]
│   └── llmService/             # 大模型对接与智能推荐服务 [NEW]
├── miniprogram/                # 小程序前端代码目录
│   ├── app.js                  # 小程序入口，初始化云开发环境 [NEW]
│   ├── app.json                # 全局配置，定义页面路由 [NEW]
│   ├── app.wxss                # 全局样式，定义莫兰迪色系与毛玻璃设计变量 [NEW]
│   ├── config.js               # 前端配置文件 (存放 SUPER_ADMIN_OPENID) [NEW]
│   ├── pages/
│   │   ├── index/              # 首页：日历展示与家庭切换 [NEW]
│   │   ├── edit-menu/          # 菜谱编辑页：手动编辑及 LLM 推荐 [NEW]
│   │   ├── dishes/             # 菜品库管理：增删改查及分类收藏 [NEW]
│   │   ├── members/            # 成员加入落地页：用于接收邀请并录入姓名 [NEW]
│   │   └── admin-settings/     # 系统设置页（超管专属）：包含成员管理（审批、改名、调权）与大模型配置子菜单 [NEW]
│   └── components/             # 自定义 UI 组件 (日历卡片等) [NEW]
└── project.config.json         # 微信开发者工具配置文件 [NEW]
```

### 3.1 核心云函数设计

#### [NEW] `cloudfunctions/login/index.js`
*   获取当前请求用户的 `OPENID` 和微信上下文，用于前端初始化判定。

#### [NEW] `cloudfunctions/adminService/index.js`
*   功能：配置 LLM (保存 API Key 至 `system_config`)、审核成员。
*   安全：在代码入口校验 `event.userInfo.openId === SUPER_ADMIN_OPENID`，非法请求直接拦截。

#### [NEW] `cloudfunctions/menuService/index.js`
*   功能：保存/编辑某一天的菜谱、增删改查菜品库。
*   安全：每次写入操作前，查询 `family_members` 表中该用户在该家庭的 role 是否为 `'admin'` 或 `'write'`。若为 `'read'`（阿姨），则拒绝写入。

#### [NEW] `cloudfunctions/llmService/index.js`
*   功能：读取 `system_config` 中的 API Key，根据提示词模板组装 Prompt（包含收藏的菜、最近几天的菜单、忌口要求等），请求大模型并解析输出格式（JSON 格式菜谱）。

---

## 4. 验证计划 (Verification Plan)

### 开发与部署验证
1.  **初始化本地开发环境**：在本地创建微信小程序项目脚手架与云函数空模版。
2.  **云函数本地联调**：使用微信开发者工具模拟超级管理员与其他成员（只读）身份，测试云函数权限控制是否准确拦截非法写入。
3.  **LLM 模拟调用**：在云函数中注入测试 API Key，模拟生成周菜单，验证 Prompt 约束（去重、荤素搭配）是否生效。

### 权限与场景校验
1.  **场景 A（超级管理员）**：
    - 能否正常访问“系统设置”页面，进入“成员与协作管理”子菜单查看成员列表、审批申请、行内编辑名字与调权。
    - 能否进入“大模型参数配置”子菜单并成功保存配置。
    - 能否正常修改日历菜单、添加菜品。
2.  **场景 B（家人 - 读写权限）**：
    - 点击或访问“系统设置”页面时，是否被全额拦截锁定（提示“系统配置已锁定保护”）。
    - 能否在日历页和单日编辑页自由修改菜单和收藏菜品。
3.  **场景 C（阿姨 - 只读权限）**：
    - 点击或访问“系统设置”页面时，是否同样被全额拦截锁定。
    - 在日历页和菜单页仅能查看，点击编辑或提交修改时是否均被提示“只读成员无法修改菜单”。
