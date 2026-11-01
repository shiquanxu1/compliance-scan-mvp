# Creem 收钱通道配置指南（手把手）

> 目标：让你（大陆个人，无海外公司）能收欧美客户的订阅款。
> Creem 是 **Merchant of Record（MoR）**——它当名义商家替你收全球的钱、替你算并代缴 VAT 税。你不用注册香港公司、不用开 Stripe、不用自己搞税务。
> 本项目默认支付通道就是 Creem（`PAYMENT_PROVIDER=creem`），按下面填完密钥即可跑通**真实结账**。

---

## 流程一览

```
注册 Creem ──▶ 开 Test Mode ──▶ 拿 API Key ──▶ 建订阅产品(拿 Product ID)
   ──▶ 配 Webhook(拿 Signing Secret) ──▶ 填进 .env ──▶ 本地验证结账
```

---

## 第 1 步：注册 Creem
1. 打开 https://www.creem.io
2. 点 **Sign up**（建议用 GitHub 登录，和 Supabase 同一个账号方便管理）
3. 进到 **Dashboard**

> 提示：Creem 后台有 **Live（正式）** 和 **Test（测试）** 两种模式，右上角切换。**先全程用 Test 模式**，不扣真实钱，跑通后再切 Live。

## 第 2 步：开启 Test Mode（重要）
1. 右上角把环境切到 **Test**
2. 之后拿的 API Key、Product ID、Webhook Secret **都要是 Test 环境下的**（Test 和 Live 的 key 不一样，别混）

## 第 3 步：获取 API Key
1. 左侧 **Developers**（或 Settings → API keys）
2. 复制 **Test 模式的 API Key**（形如 `creem_xxx...`）
3. 这就是 `.env` 里的 `CREEM_API_KEY`

## 第 4 步：创建订阅产品（拿 Product ID）
1. 左侧 **Products** → **New Product**
2. 填写：
   - **Name**：`ComplianceScan Starter`（或你喜欢的名字）
   - **Type**：选 **Subscription**（订阅，按月循环扣款）
   - **Price**：`19`（对应 Starter 套餐 ¥19/月；币种按 Creem 给你开的默认币种）
   - **Billing period**：`Monthly`
3. 保存后，产品详情页会有一个 **Product ID**（形如 `prod_xxx...`）
4. 这就是 `.env` 里的 `CREEM_PRODUCT_ID`

> ⚠️ 当前代码用**单个** `CREEM_PRODUCT_ID`，所以 MVP 先建**一档**（建议 Starter）。
> 想做 4 档各自计费，是后续扩展：在 `.env` 加 `CREEM_PRODUCT_ID_STARTER/PRO/AGENCY`，并在 `server.js` 的 `createCheckoutCreem` 里按 `plan` 映射。先跑通一档再说。

## 第 5 步：配置 Webhook（拿 Signing Secret）
Webhook 用于 Creem 在「客户付款成功」时通知你的服务器，把订阅状态写进 Supabase。

1. 左侧 **Developers → Webhooks** → **Add Endpoint**
2. **Endpoint URL**：填你的回调地址
   - 部署前（本地）：暂时填 `https://your-domain.com/api/webhook/creem`（占位，本地收不到，部署后替换成真实公网地址）
   - 部署后：`https://你的真实域名/api/webhook/creem`
3. **Events**：勾选订阅相关事件，至少包含：
   - `subscription.paid`（付款成功）
   - `subscription.active`
   - `subscription.canceled`
4. 保存后复制 **Signing Secret**（形如 `whsec_xxx...`）
5. 这就是 `.env` 里的 `CREEM_WEBHOOK_SECRET`

> ⚠️ **Webhook 必须公网可达**。本地 `localhost` 收不到 Creem 的推送，所以：
> - 本地只能验证「创建 checkout → 跳到 Creem 收银台」这一步；
> - 「付款后订阅状态自动更新」要等**部署上线、填了真实公网域名**后才生效。

## 第 6 步：填进 `.env`
打开项目根目录的 `.env`，把这几行替换成你刚拿到的值（第 8–13 行附近）：

```env
CREEM_API_KEY=creem_你刚复制的test_api_key
CREEM_PRODUCT_ID=prod_你刚复制的product_id
CREEM_TEST_MODE=true
CREEM_WEBHOOK_SECRET=whsec_你刚复制的signing_secret
```

`PAYMENT_PROVIDER` 保持 `creem`（默认值，不用改）。

## 第 7 步：验证结账接通

### A. 本地验证（不扣真实钱）
1. 重启本地服务（让新 `.env` 生效）
2. 浏览器开 `http://localhost:3000/` → 点任一付费套餐的「订阅 / 结账」
3. 预期：后端返回真实 `checkout_url`（不再是「演示跳转」），浏览器跳到 Creem 的 **Test 收银台**
4. Test 模式下用 Creem 提供的**测试卡**完成一笔支付（不扣真钱），验证能跳回 success 页

> ⚠️ **如果本地验证报错**（例如返回 `Creem HTTP 404/500`，且错误体是 `{"statusCode":500,"timestamp":...,"path":...}` 这种格式），通常是**本地网络环境拦截/代理了对 Creem 的对外 API 调用**，并非你配置有误。本项目已把 Creem 真实报错原样暴露出来，方便排查——若错误体带 `message` 字段才是 Creem 原生业务错误（如字段问题）；若只是上面的代理层 404/500，则属于网络环境限制。遇到这种情况**跳过本地验证，直接走下面 B 的部署后验证**即可。

### B. 部署后验证（SOP，推荐）
把项目部署到 Railway / Render（配置见 `DEPLOY.md` / `deploy-guide.html`）后：
1. 在平台的环境变量里填与 `.env` 相同的 4 个值：`CREEM_API_KEY` / `CREEM_PRODUCT_ID` / `CREEM_TEST_MODE=true` / `CREEM_WEBHOOK_SECRET`
2. 访问 `https://你的域名/api/config` → 应显示 `paymentDemo:false`、`creemTest:true`
3. 首页点「订阅 Starter」→ 应跳到 Creem 收银台（不再是演示）
4. 用 Creem 测试卡 `4111 1111 1111 1111` 完成一笔测试付款（不扣真钱）
5. 查看服务端日志 / Supabase `subscriptions` 表，确认 Webhook 把订阅状态写成 `active`

---

## 跑通后切 Live（正式收钱）
1. Creem 后台右上角切到 **Live**
2. 重新拿 **Live 的** API Key / Product ID / Webhook Secret（和 Test 不同！）
3. 把 `.env` 里的三个值换成 Live 的，并把 `CREEM_TEST_MODE` 改为 `false`
4. 重启服务 → 真实收款生效

## 常见问题
- **Q：提示「未配置 Creem API Key，当前为演示跳转」？** → `.env` 没填或没重启服务。填完重启即可。
- **Q：localStorage 里之前的演示订单？** → 访客模式数据在浏览器本地，不影响真实结账。
- **Q：4 档套餐怎么各自收费？** → 当前单 Product ID 模式，先跑通一档；多档映射见第 4 步说明。
- **Q：Webhook 本地收不到？** → 正常，本地 `localhost` 不可公网访问；部署后配真实域名即可。
- **Q：本地验证一直报 `Creem HTTP 404/500`、错误体是 `{"statusCode":500,...}`？** → 多为本地网络环境拦截了对 Creem 的对外 API 调用（沙箱/代理），**不是你配置错了**。本地 `.env` 四项填对即可，到 Railway/Render 用真实 key 部署就能正常接通；若部署后仍报错且错误体带 `message` 字段，再按该 message 排查请求字段。
