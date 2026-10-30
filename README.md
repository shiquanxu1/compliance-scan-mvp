# ComplianceScan MVP

> 面向欧盟 / 英国中小网站的「合规即服务」微型 SaaS
> 免费域名合规扫描 + 用户注册/历史 + 持续监控订阅（Creem 结账 + Webhook）

## 已实现功能

1. **免费合规扫描**（服务真实抓取 + 规则评估）
   - HTTPS、隐私政策、Cookie 同意、追踪脚本、法律实体信息 5 项检查
   - 0–100 评分 + 逐项结果 + 整改建议
   - 引擎可切换：**正则**（零依赖）或 **Playwright 真浏览器**（覆盖 JS 渲染的横幅与动态追踪）
2. **用户体系（Supabase）**：注册 / 登录，扫描结果自动存入 `scans` 表（RLS 隔离，只看自己的）
3. **支付（Creem，MoR）**：无需海外主体即可收全球钱；支持 **test 模式** 与 **Webhook 验签** 自动更新订阅状态
4. 零硬后端依赖：Node 原生 http + 全局 fetch；Playwright 动态加载，未装自动降级

## 运行

```bash
cd compliance-mvp
npm install                 # 安装 playwright（如不需要可跳过，自动降级正则）
npm start                  # 或 node server.js
# 打开 http://localhost:3000
```

未配置任何密钥时：扫描可用（正则，或 `USE_PLAYWRIGHT=true` 用真浏览器）、结账走演示模拟、**登录/历史进入「访客体验模式」**——扫描历史存浏览器本地、订阅在本地模拟，无需任何外部账号即可走通完整产品 UX。配好 Supabase + Creem 后自动切换为真实云端版。

## ① 接入真实 Creem（你的测试账号）

1. 注册 https://www.creem.io，Dashboard 创建**订阅型**产品（如 Monitor Monthly ¥19/月）
2. 复制 `API Key` 与 `Product ID`
3. `cp .env.example .env`，填入 `CREEM_API_KEY` / `CREEM_PRODUCT_ID`
4. 先用测试模式验证（不扣真钱）：
   - 在 Creem 切换/申请测试 key，`CREEM_TEST_MODE=true`
5. Webhook（可选，用于自动更新订阅状态）：
   - Creem Dashboard 配置 Webhook 指向 `https://你的域名/api/webhook/creem`
   - 复制 Webhook Secret 填入 `CREEM_WEBHOOK_SECRET`
   - 本服务会验签并将 `email / status / plan` 写入 Supabase `subscriptions` 表

> 没有你的真实 key 我无法替你填写——把 key 填进 `.env` 后即为真实可用（test mode 用测试 key 即可在测试环境跑通，不扣款）。

### 一键验证 Creem 测试链路（无需启动整站）

```bash
# 在 .env 填好 CREEM_API_KEY / CREEM_PRODUCT_ID，并设 CREEM_TEST_MODE=true
node scripts/test-creem.js
```

脚本会直接调用 Creem（沙箱）创建一笔结账并返回 `checkout_url`，你打开即可用测试卡完成支付，验证「测试 key → 结账 → 回调」整条链路。日常启动应用用 `CREEM_TEST_MODE=true node server.js`。

> 想更省事？先用测试模式把链路跑通，再切换到生产 key。生产环境会真实扣款。

## ② 接入 Supabase（注册 + 历史留存）

1. supabase.com 建项目 → SQL Editor 执行 `supabase-schema.sql`（建 `scans` / `subscriptions` 表 + RLS）
2. Project Settings → API 复制 `URL`、`anon key`、`service_role key`
3. 填入 `.env` 的 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_KEY`
4. 重启服务：前端出现「登录/注册」，登录后扫描自动留存历史

> anon key 可公开（前端直连，靠 RLS 隔离）；service_role key 仅服务端用，切勿暴露到浏览器。

### 一键验证 Supabase 连通性（无需启动整站）

```bash
# 在 .env 填好 SUPABASE_URL / SUPABASE_ANON（可选 SUPABASE_SERVICE_ROLE 用于写测试行）
node scripts/test-supabase.js
```

脚本会：① 用 anon key 连通并读取 `scans` 表（验证 RLS 生效，正常返回空数组）；② 若提供了 `service_role` key，自动写入并清理一条测试扫描，验证表结构与写入能力。跑通后即可在应用里启用登录与历史云端同步。

## ③ 启用 Playwright 真浏览器扫描

```bash
npm install playwright
npx playwright install chromium   # 下载浏览器（首次）
USE_PLAYWRIGHT=true npm start
```

未安装或启动失败时自动回退正则模式，服务照常运行。

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | Node 原生 http + fetch | 零硬依赖；Playwright 动态加载降级 |
| 前端 | 原生 HTML/CSS/JS + Supabase JS | 无构建步骤 |
| 支付 | Creem (MoR) | 个人收全球钱，代缴 VAT，支持 test mode + webhook |
| 数据 | Supabase Postgres + RLS | 注册、历史、订阅状态 |
| 扫描 | 正则 / Playwright | 可切换，真浏览器覆盖 JS 渲染 |

## 升级路线（产品化）

- 持续监控：定时任务每日重扫 + Resend 邮件告警（对应 ¥19/月档）
- 合规文档生成：基于扫描结果一键生成隐私政策 / DPA / Cookie 声明
- 部署：Railway / Render / VPS（`node server.js`）；上 Vercel 需改 serverless function

## 合规提示（给运营者自己）

本站点上线前也应补齐：隐私政策、服务条款、退款政策页（MoR 通常提供模板）。
