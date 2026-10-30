# Supabase 配置指南（手把手）

> 目标：新建 Supabase 项目 → 建表 → 拿到 3 个密钥 → 填进 `.env` → 跑通验证。
> 完成后，网站就能支持**用户注册/登录、扫描历史云端保存、每日监控**。

---

## 0. 前置：需要翻墙

Supabase 官网 `supabase.com` 在国内打不开。配置期间（注册、开后台、复制密钥）你需要翻墙。
配置好之后，网站本身运行在境外，**你的海外用户不需要翻墙**。

---

## 第 1 步：注册并新建项目

1. 翻墙后打开 <https://supabase.com> → 点 **Start your project** / **Sign up**。
   - 推荐直接用 **GitHub 账号登录**（更快；GitHub 登录同样需要翻墙）。
2. 登录后点 **New project**：
   - **Name**：随便起，如 `compliancescan`
   - **Database Password**：**务必记牢**（丢了要重置，麻烦）
   - **Region（区域）**：
     - 你的用户主要在欧美 → 选 `us-east-1`（美东）或 `eu-west-1`（西欧）
     - 你自己访问方便 → 选 `ap-southeast-1`（新加坡）
   - 价格选 **Free**（免费层够 MVP 用）
3. 点 **Create project**，等 1–2 分钟初始化完成。

---

## 第 2 步：执行建表 SQL

1. 左侧菜单点 **SQL Editor** → **New query**（新建查询）。
2. 把本项目里的 **`supabase-schema.sql`** 整个文件内容粘贴进去。
   - 也可在编辑器里点 **Open file** 直接选中项目里的 `supabase-schema.sql`。
3. 点 **Run**（右上角 ▶）执行。
4. 成功后会建好 3 张表，并自动开启行级安全（RLS）：
   - `scans`：扫描历史（按用户隔离）
   - `subscriptions`：订阅状态（由支付 Webhook 写入，前端不可见）
   - `monitors`：监控项（含 `score_history` 趋势历史）

> 这步只需做一次。以后重跑同一段 SQL 也是安全的（用了 `if not exists`）。

---

## 第 3 步：复制 3 个密钥

1. 左下角点齿轮 **⚙️ Project Settings** → 选 **API**。
2. 在页面里找到并复制以下三项：
   - **Project URL**：形如 `https://xxxx.supabase.co` → 对应 `SUPABASE_URL`
   - **Project API keys → `anon` `public`**：一長串 `eyJ...` → 对应 `SUPABASE_ANON_KEY`
   - **Project API keys → `service_role` `secret`**：另一長串 `eyJ...` → 对应 `SUPABASE_SERVICE_KEY`
3. ⚠️ **`service_role` 密钥权限极高**（能绕过所有权限限制），不要泄露、不要提交到 git（本项目 `.env` 已被 git 忽略）。

---

## 第 4 步：填进 `.env`

本项目已为你生成好 `.env`（由 `.env.example` 复制）。
用任意编辑器打开项目根目录的 **`.env`**，找到这三行，把第 3 步复制的值替换进去：

```env
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_ANON_KEY=你的_anon_公钥_eyJ...
SUPABASE_SERVICE_KEY=你的_service_role_私钥_eyJ...
```

> 其他行（Creem / Paddle / Resend 等）先留着占位，后面各步再填。

---

## 第 5 步：验证连通

在项目目录下打开终端（无需翻墙，脚本直连你的 Supabase）：

```bash
node scripts/test-supabase.js
```

看到类似输出即成功：

```
Supabase URL : https://xxxx.supabase.co
✓ 连通成功，scans 表可访问（anon 返回行数: 0 ）
  → 返回为空属正常：RLS 默认仅当前登录用户可见自己的数据。
✓ 写入测试行成功，id = ...
✓ 已清理测试行。
```

- 若提示 **缺少 SUPABASE_URL 或 SUPABASE_ANON** → 回到第 4 步检查 `.env` 三行。
- 若写入测试失败 → 确认第 2 步 SQL 已成功执行。

---

## 第 6 步：重启服务确认

重启本地服务（让 `.env` 生效），打开首页，控制台/底部状态应显示：

```
Supabase: 已启用 | 监控: 可用
```

（本步可由助手协助重启。）

---

## 配置完成后能得到什么

| 能力 | 状态 |
|---|---|
| 用户邮箱+密码注册 / 登录（Supabase Auth） | ✅ 可用 |
| 扫描历史云端保存，多设备同步 | ✅ 可用 |
| 每日监控定时任务（依赖 service key） | ✅ 可用 |
| 支付 / 订阅回写 | 待第 2 步 Creem/Paddle 配置 |

---

## 可选：关闭邮箱验证（仅自用测试时）

Supabase Auth 默认注册后需点击邮件里的验证链接才能登录。
- 自己测试嫌麻烦：左侧 **Authentication → Providers → Email** → 关闭 **Confirm email**。
- **生产环境建议保持开启**，否则任何人可随意注册。

---

## 常见问题

**Q：免费层够用吗？**
够。Free 层有 500MB 数据库、5 万月活用户上限，MVP 阶段完全够。

**Q：Region 选错能改吗？**
建好后不能改区域，只能删掉重建。所以第 1 步选区域要想好（面向欧美就选美东/西欧）。

**Q：service_role 密钥泄露了怎么办？**
立刻到 Project Settings → API 点 **roll key** 轮换，并更新 `.env`。
