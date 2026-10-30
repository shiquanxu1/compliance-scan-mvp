# 部署指南（ComplianceScan MVP）

> 把 Demo 变成公网可访问的真实站点，并接通 Creem 收款回调。
> 两种平台任选其一，**都不需要信用卡也能用免费档起步**（Railway 免费额度需绑卡验证但不扣费；Render 有免费档）。

---

## 0. 先把仓库准备好

```bash
cd compliance-mvp
git init
git add -A
git commit -m "ComplianceScan MVP"
# 推到 GitHub（新建一个私有/公开仓库）
```

部署平台都是从 Git 仓库拉代码构建的，所以先有仓库。

---

## 方案一：Railway（推荐，节点自动分配、自带 HTTPS 域名）

1. 打开 https://railway.app → 用 GitHub 登录 → 「New Project」→「Deploy from GitHub repo」选本仓库。
2. Railway 会自动识别 `railway.json` 并用 `node server.js` 启动。
3. 进入项目 → 「Variables」添加环境变量（见下方「环境变量清单」）。
4. 进入「Settings」→「Domains」→ 点 Generate 拿到一个 `xxx.up.railway.app` 的公网域名（自带 HTTPS）。
5. 打开域名即上线。免费档每月 500 小时足够个人试水。

> 想要自己的域名（如 compliancescan.com）：在 Domains 里填自定义域名，按提示去 DNS 加一条 CNAME 即可。

---

## 方案二：Render（免费档，冷启动稍慢）

1. 打开 https://render.com → 用 GitHub 登录 → 「New」→「Blueprint」→ 连接仓库，选本目录（会自动读取 `render.yaml`）。
2. 或手动「New Web Service」：Build Command 填 `npm install`，Start Command 填 `node server.js`。
3. 在创建/设置页填入环境变量（见下方清单）。
4. 部署完成后 Render 给一个 `xxx.onrender.com` 域名（自带 HTTPS）。

> Free 档实例闲置后会休眠，首次访问需几秒唤醒；付费档（$7/月起）常驻。

---

## 环境变量清单

| 变量 | 是否必填 | 说明 |
|---|---|---|
| `NODE_ENV` | 建议 | 填 `production` |
| `USE_PLAYWRIGHT` | 可选 | `false`（默认，免费实例无需 Chromium）；`true` 需额外 build 下载浏览器 |
| `CREEM_API_KEY` | 收款必填 | Creem 后台 Developers → API Keys 的 Secret Key |
| `CREEM_PRODUCT_ID` | 收款必填 | 你创建的订阅产品 ID |
| `CREEM_TEST_MODE` | 建议 | `true` 走沙箱不扣费；真实收款改 `false` |
| `CREEM_WEBHOOK_SECRET` | 建议 | Creem Webhook 的签名密钥，用于验签回调 |
| `SUPABASE_URL` | 历史必填 | Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | 历史必填 | anon key（前端直连，安全） |
| `SUPABASE_SERVICE_KEY` | 可选 | service_role key（仅服务端写订阅状态用） |

> 不填任何密钥也能跑：扫描可用、结账走模拟、登录/历史为访客模式。按需在平台后台逐个补即可。

---

## 接通 Creem 收款回调（上线后必做）

1. 在 Creem 后台「Developers → Webhooks」新建一个 Webhook：
   - **Endpoint URL** 填：`https://你的域名/api/webhook/creem`
     （例如 `https://compliancescan.up.railway.app/api/webhook/creem`）
   - 订阅事件：`subscription.paid`、`subscription.canceled` 等
2. 复制 Webhook 的 **Signing Secret** → 填到平台环境变量的 `CREEM_WEBHOOK_SECRET`。
3. 服务端（`server.js`）已实现对原始 body 做 HMAC-SHA256 验签，验签通过后才把 `email / status / plan` 写入 Supabase `subscriptions` 表。**未配密钥时 Webhook 直接拒绝**，安全。
4. 本地联调 Webhook 可用 [Creem 官方 CLI / ngrok] 把 `localhost:3000` 暴露成公网地址再指向它。

---

## 本地冒烟测试（部署前）

```bash
# 验 Creem 沙箱结账链路
node scripts/test-creem.js
# 验 Supabase 连通 + RLS
node scripts/test-supabase.js
```

两个脚本都通过，再把仓库推上去部署，基本一次成功。

---

## 上线前别忘的合规页（运营你自己的站点也要）

- 隐私政策、服务条款、退款政策（页脚已留占位链接）。
- MoR（Creem）通常会提供这些页面的模板，直接套用即可。
- 若有欧盟用户，确保 Cookie 同意与 GDPR 文案到位（你这个产品本身就是干这个的 😉）。
