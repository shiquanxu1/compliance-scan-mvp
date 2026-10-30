# ComplianceScan MVP

> 面向欧盟 / 英国中小网站的「合规即服务」微型 SaaS
> 免费域名合规扫描 + 用户注册/历史 + 持续监控订阅（Creem 结账 + Webhook）

## 已实现功能

1. **免费合规扫描**（服务真实抓取 + 规则评估），输出**两个独立维度**评分：
   - **GDPR / ePrivacy 基础合规**：HTTPS、隐私政策、Cookie 同意、追踪脚本、法律实体信息 5 项检查
   - **WCAG 2.1 无障碍**：`<html lang>`、页面标题、图片 alt、表单标签、链接/按钮文本、标题结构 6 项检查（对应欧盟 Web Accessibility Directive / EN 301 549）
   - 各自 0–100 评分 + 逐项结果 + 整改建议
   - 引擎可切换：**正则**（零依赖）或 **Playwright 真浏览器**（覆盖 JS 渲染的横幅与动态追踪）
2. **多站点套餐**：Free / Starter(¥19) / Pro(¥49) / Agency(¥149) 四档，按监控站点数分级；结账携带 `plan` 参数，Webhook 回写订阅档位
3. **用户体系（Supabase）**：注册 / 登录，扫描结果自动存入 `scans` 表（RLS 隔离，只看自己的）
4. **支付（MoR，支持多通道切换）**：默认 **Creem**（无需海外主体收全球钱）；可切 **Paddle**（同为 MoR，大陆个人可用，前端用 Paddle.js 拉起 checkout）；**Stripe** 仅提供骨架（需海外公司主体，大陆个人不开放）。均支持 **test 模式** 与 **Webhook 验签** 自动更新订阅状态
5. **合规文档一键生成**：基于扫描结果 + 公司信息，生成**隐私政策 / Cookie 声明 / DPA（数据处理协议）**草稿（Markdown，可复制/下载）
6. **每日监控 + 邮件告警**：用户把站点加入 `monitors` 表，定时任务每日重扫，合规评分回退或新增违规时通过 **Resend** 发告警邮件；订阅失效自动暂停监控
7. **监控评分趋势图**：每次扫描后追加历史评分（`score_history` jsonb），前端一键展开 **SVG 折线图**（含及格线 80、近 30 次），直观看到合规漂移
8. **告警邮件模板美化**：响应式 HTML 邮件，含品牌头、新增/恢复违规清单、近期趋势缩略图与「查看详情」按钮
9. 零硬后端依赖：Node 原生 http + 全局 fetch；Playwright 动态加载，未装自动降级

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

## ④ 合规文档一键生成（已内置）

扫描完成后点「📄 生成合规文档」→ 填写文档类型 / 公司名 / 邮箱 / 国家 → 基于本次**真实扫描结果**（检测到的追踪脚本、合规缺口）生成对应草稿：

- **隐私政策 (Privacy Policy)**：含控制者信息、数据收集、第三方处理者、GDPR 第 6 条法律依据、用户权利等
- **Cookie 声明 (Cookie Declaration)**：列出检测到的第三方脚本与同意状态提示
- **DPA（数据处理协议）**：依 GDPR 第 28 条，含子处理者清单（基于扫描到的追踪工具）

后端 `POST /api/generate-doc`，模板在 `lib/docs.js`。生成的是**可编辑草稿，非法律意见**——正式发布前建议律师审阅。无需配置任何密钥即可体验。

## ⑤ 每日监控 + 邮件告警（Resend）

**架构**：前端把站点加入 `monitors` 表（Supabase 客户端直写，RLS 隔离）→ 定时任务读取 active 监控项 → 校验订阅 → 重扫 → 对比变化 → 违规邮件告警 → 回写。

**配置步骤**：

1. 已在 Supabase 跑过 `supabase-schema.sql`（含新增的 `monitors` 表）
2. 配 Resend：resend.com 注册 → 验证发件域名 → 拿 API Key，填入 `.env` 的 `RESEND_API_KEY` / `FROM_EMAIL`
3. 设 `CRON_SECRET`（任意强随机串），用于保护 `POST /api/cron/monitor`
4. 重启服务

**触发方式（任选其一）**：

- **GitHub Actions（推荐，免费）**：仓库根已含 `.github/workflows/monitor.yml`，每天 UTC 02:00 触发。在仓库 **Settings → Secrets** 添加 `SITE_URL`（你的域名，不含 https://）与 `CRON_SECRET`，Actions 自动运行。也可在 Actions 页面手动 `Run workflow` 测试。
- **本地 / 系统 cron**：`node scripts/monitor.js`（需 SUPABASE_* 与 RESEND_* 环境变量），或加到 crontab：`0 2 * * * cd /path/to/compliance-mvp && node scripts/monitor.js >> monitor.log 2>&1`
- **手动触发**：`curl -X POST https://你的域名/api/cron/monitor -H "Authorization: Bearer $CRON_SECRET"`

未配 `SUPABASE_SERVICE_KEY` 时监控自动跳过；未配 `RESEND_API_KEY` 时告警仅打印日志不真实发信（便于本地调试）。

## ⑥ 监控评分趋势图

每次定时监控回写时，`lib/monitor.js` 会把 `{ts, score}` 追加进 `monitors.score_history`（保留最近 30 条）。前端在「每日监控站点」列表点「📈 查看趋势」即渲染纯 SVG 折线图：

- 紫色折线 = 历史评分；绿色虚线 = 及格线 80
- 横轴为日期刻度，无需任何图表库
- 数据由前端 Supabase 客户端直读（RLS 隔离，只看自己的）

> 趋势至少需要 2 次监控记录才会绘制；新加的监控站点跑满 2 天后即出现。

## ⑦ 备选支付通道（Stripe / Paddle）

通过环境变量 `PAYMENT_PROVIDER` 切换，无需改代码：

| 值 | 平台 | 大陆个人可行性 | 说明 |
|---|---|---|---|
| `creem`（默认） | Creem (MoR) | ✅ 可用 | 无需海外主体，代缴 VAT，test mode + webhook |
| `paddle` | Paddle (MoR) | ✅ 可用 | 同为 MoR，无需 VAT 注册；前端用 Paddle.js 拉起 checkout |
| `stripe` | Stripe (PSP) | ❌ 不可 | 需香港/海外公司主体 + 港卡，**仅代码骨架**，不建议起步使用 |

切换示例：

```bash
# .env
PAYMENT_PROVIDER=paddle
PADDLE_API_KEY=your_paddle_key
PADDLE_PRICE_ID=pri_xxx
PADDLE_SANDBOX=true       # 先用沙箱测试
PADDLE_CLIENT_TOKEN=your_client_token   # Paddle.js 前端令牌（Developer Tools 获取），用于前端打开 hosted checkout
```

前端 `goCheckout` 会：创建 Paddle 交易 → 加载 `Paddle.js` → `Paddle.Initialize({ token })` → `Paddle.Checkout.open({ transactionId })`；沙箱自动切换 `Paddle.Environment.set('sandbox')`。

- Creem / Paddle 都是 MoR（Merchant of Record），把全球增值税/GST 合规甩给平台，个人最省心。
- Stripe 是 PSP，自己承担税务合规，且对中国大陆个人不开放——除非你有海外主体，否则别碰。

## ⑧ 端到端验证（一键跑通整站链路）

部署 / 配好密钥后，一条命令验证每一环真实可用：

```bash
node server.js                 # 先启动（已加载 .env）
node scripts/e2e-verify.js     # 另开终端运行验证
# 或指定线上地址：BASE_URL=https://你的域名 node scripts/e2e-verify.js
```

脚本依次检查：① 配置能力 → ② 合规扫描(含 WCAG) → ③ 结账链路(含 Paddle/Stripe 分发) → ④ 每日监控 cron → ⑤ 合规文档生成，并在结尾列出**仍需你亲自在第三方后台完成**的待办（脚本无法替你登录 Creem/Supabase 等账号）。

> 说明：结账仅创建 checkout，不会真扣款；真实扣款 + Webhook 订阅回写需你用浏览器走完支付并配置后台 Webhook。

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | Node 原生 http + fetch | 零硬依赖；Playwright 动态加载降级 |
| 前端 | 原生 HTML/CSS/JS + Supabase JS | 无构建步骤 |
| 支付 | Creem / Paddle (MoR) / Stripe(骨架) | 可切换；MoR 无需海外主体，支持 test mode + webhook |
| 数据 | Supabase Postgres + RLS | 注册、历史、`monitors`、订阅状态 |
| 扫描 | 正则 / Playwright | 可切换，真浏览器覆盖 JS 渲染 |
| 邮件 | Resend | 监控告警；未配置则降级为日志 |
| 定时 | GitHub Actions / 系统 cron | 每日触发 `/api/cron/monitor`（CRON_SECRET 保护） |

## 升级路线（产品化）

- ✅ 持续监控：定时任务每日重扫 + Resend 邮件告警（多档套餐对应）
- ✅ 监控趋势图：历史评分 SVG 折线，运营可视化
- ✅ 告警邮件模板：响应式精美 HTML
- ✅ 合规文档生成：基于扫描结果一键生成隐私政策 / DPA / Cookie 声明
- ✅ 支付多通道：Creem 默认，Paddle（含 Paddle.js 前端集成）备选，Stripe 骨架
- ✅ WCAG 无障碍维度：与 GDPR 并列的第二评分，覆盖欧盟无障碍指令
- ✅ 多站点套餐：Free/Starter/Pro/Agency 四档，结账带 plan，Webhook 回写档位
- ✅ 端到端验证脚本：一键跑通整站链路 + 待办清单
- 部署：Railway / Render / VPS（`node server.js`）；上 Vercel 需改 serverless function

## 合规提示（给运营者自己）

本站点上线前也应补齐：隐私政策、服务条款、退款政策页（MoR 通常提供模板）。
