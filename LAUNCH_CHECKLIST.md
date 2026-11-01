# ComplianceScan 上线前检查清单

> 按顺序勾选。所有项完成后再部署。每项标注了对应的文件或命令，方便照做。

## 0. 本地冒烟（开发机）

- [ ] 依赖已清理：部署无需安装任何 npm 包（扫描用正则引擎；Playwright 仅本地可选，不参与部署）
- [ ] 复制 `.env.example` 为 `.env` 并按需填写
- [ ] `node server.js` 本地启动，`http://localhost:3000` 能打开
- [ ] `node scripts/e2e-verify.js` 跑通（依次验证 config / scan / checkout / monitor / generate-doc）

## 1. 数据库 — Supabase

- [ ] 新建 Supabase 项目
- [ ] 在 SQL Editor 执行 `supabase-schema.sql`（建 `scans` / `subscriptions` / `monitors` 表 + RLS 行级安全）
- [ ] 复制 Project URL → 写入 `.env` 的 `SUPABASE_URL`
- [ ] 复制 anon key → `SUPABASE_ANON_KEY`（前端公开，安全）
- [ ] 复制 service_role key → `SUPABASE_SERVICE_KEY`（**仅服务端**，切勿暴露到前端）
- [ ] 确认 `monitors` 表的 `score_history`(jsonb) 与 `plan` 列已存在

## 2. 支付 — Creem / Paddle（二选一，或都接）

> Merchant of Record 方案，绕过 Stripe 对中国大陆个人的主体/港卡限制。

- [ ] 注册 Creem 或 Paddle（推荐先其一跑通）
- [ ] 在后台创建订阅产品，拿到各档 Price ID（Free / Starter / Pro / Agency）  
  |  |  |  |  
  | --- | --- | --- |
- [ ] `.env` 设置 `PAYMENT_PROVIDER=creem|paddle|stripe`
- [ ] Creem：`CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` / 产品 ID
- [ ] Paddle：`PADDLE_API_KEY` / `PADDLE_CLIENT_TOKEN` / `PADDLE_PRICE_ID_*`（sandbox 用测试 token）
- [ ] Stripe（备选通道）：`STRIPE_SECRET` / `STRIPE_PRICE_ID_*`
- [ ] `node scripts/test-creem.js` 验证结账创建成功（test 模式）

## 3. 邮件 — Resend

- [ ] 注册 Resend，验证发信域名（如 yourdomain.com）
- [ ] `.env` 写入 `RESEND_API_KEY`
- [ ] 确认监控告警发件地址已在 Resend 验证通过

## 4. 监控定时任务

- [ ] `.env` 设置 `CRON_SECRET`（随机长串，例如 `openssl rand -hex 32`）
- [ ] GitHub 仓库 Settings → Secrets 添加同名 `CRON_SECRET`
- [ ] 在 `.github/workflows/monitor.yml` 填入 `SITE_URL` 与 secrets 引用
- [ ] 手动触发一次 Action，确认 `/api/cron/monitor` 返回 200 且正确重扫站点

## 5. 站点内容

- [ ] 把 `privacy.html` / `terms.html` / `refund.html` 里的 `[方括号]` 占位替换为你的真实信息（公司主体、邮箱、退款天数、管辖地）
- [ ] 在政策页点击「生成你自己的版本」核对生成的草稿无误
- [ ] 首页文案如有品牌占位，一并替换

## 6. 部署 — Railway / Render

- [ ] 参考 `DEPLOY.md` 与 `deploy-guide.html` / `setup-guide.html`
- [ ] 仓库已推送到 GitHub（Railway / Render 从 Git 拉代码）
- [ ] 连接仓库，设置环境变量（与 `.env` 一致，注意 `SITE_URL` 填线上域名）
- [ ] 部署后访问线上域名，走一遍完整闭环：扫描 → 生成文档 → 结账 → Webhook 回写订阅

## 7. 上线后验证（生产环境）

- [ ] 真实支付一笔（先用 test / sandbox 模式），确认 Webhook 把订阅状态写回 Supabase
- [ ] 次日检查监控 Action 是否自动运行并发送告警邮件
- [ ] 确认 Footer 三个政策页可访问且内容正确

---

完成以上即具备可对外推广的最小闭环（MVP）。后续可迭代：更多扫描维度、团队席位、白标导出等。
