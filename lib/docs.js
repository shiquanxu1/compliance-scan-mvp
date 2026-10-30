/**
 * ComplianceScan — 合规文档模板生成器
 *
 * generateDoc({ docType, url, companyName, email, country, scan }) → Markdown 字符串
 * docType: 'privacy' | 'cookie' | 'dpa'
 *
 * 说明：生成的是「可编辑草稿」，并非法律意见。用户应请律师定稿。
 * 内容会结合扫描结果（检测到的追踪脚本、合规缺口）动态生成，提升可用性。
 */

const { describeTrackers } = require('./scanner');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function trackerSection(scan) {
  const list = describeTrackers(scan?.foundTrackers || []);
  if (!list.length) {
    return '经 ComplianceScan 扫描，本站点未检测到常见第三方追踪脚本。一旦接入分析/广告工具，请在本声明中补充。';
  }
  const rows = list
    .map((t) => `| ${t.name} | 第三方分析/追踪 | ${t.purpose} | 见各服务商隐私政策 |`)
    .join('\n');
  return (
    '经 ComplianceScan 扫描，本站点检测到以下第三方脚本，可能设置 Cookie 并收集个人数据：\n\n' +
    '| 工具 | 类别 | 用途 | 隐私政策 |\n|---|---|---|---|\n' +
    rows
  );
}

function privacyPolicy({ url, companyName, email, country, scan }) {
  const gap = (scan?.recommendations || []).filter((r) => !/HTTPS/.test(r));
  const gapNote = gap.length
    ? `\n\n> ⚠️ 合规提示：扫描发现以下缺口，建议尽快整改后再发布本政策——${gap.join('；')}。`
    : '';
  return `# 隐私政策（草案）

**生效日期**：${today()}
**数据控制者**：${companyName}
**注册地**：${country}
**联系邮箱**：${email}
**适用站点**：${url}

---

## 1. 我们是谁
${companyName}（以下简称「我们」）运营 ${url}。我们是 GDPR / 英国 GDPR 项下的数据控制者（data controller），负责决定个人数据的处理目的与方式。

## 2. 我们收集哪些数据
- **你主动提供的信息**：如注册、订阅、联系表单中提交的邮箱与姓名。
- **自动收集的信息**：通过以下工具收集的访问数据、设备与大致地理位置。
- **Cookie 与同类技术**：见下方「Cookie 声明」。

## 3. 我们使用的第三方处理者
${trackerSection(scan)}

请确认上述第三方均已签署数据处理协议（DPA，见本文档第三节模板），并在设置非必要 Cookie 前取得用户同意。

## 4. 处理的法律依据（GDPR 第 6 条）
- **履行合同**：为向你提供所请求的服务（如发送你订阅的告警）。
- **合法利益**：保障站点安全、分析使用情况以改进服务。
- **同意**：在非必要 Cookie 与营销通信场景下，经你明确同意后处理。

## 5. 你的权利（GDPR 第 15–22 条）
你有权：访问、更正、删除你的个人数据；限制或反对处理；数据可携；以及向监管机构投诉。行使权利请邮件至 ${email}。

## 6. Cookie 与同意
我们在设置任何非必要 Cookie 前，会通过 Cookie 横幅取得你的明确同意（符合 ePrivacy 指令）。你可随时在站点底部撤回同意。

## 7. 数据保留
我们仅在实现上述目的所需的期限内保留个人数据，通常不超过账号注销后 12 个月。

## 8. 联系我们
如对本政策有疑问，或欲行使上述权利，请联系：${email}。
${gapNote}

---
*本文件由 ComplianceScan 依据站点扫描结果自动生成，为可编辑草稿，不构成法律意见。正式发布前建议交由律师审阅。*`;
}

function cookieDeclaration({ url, companyName, email, scan }) {
  const list = describeTrackers(scan?.foundTrackers || []);
  const consentOk = scan?.checks?.some((c) => c.key === 'consent' && c.pass);
  const statusLine = consentOk
    ? '扫描显示站点已部署 Cookie 同意机制。请确认下方工具均在用户同意后才加载。'
    : '⚠️ 扫描**未**检测到有效的 Cookie 同意横幅。在欧盟/英国，设置非必要 Cookie 前必须取得同意，请先部署同意管理工具。';
  const rows = list.length
    ? list
        .map(
          (t) =>
            `| ${t.name} | 非必要（分析/广告） | ${t.purpose} | 需同意 | 见 ${t.name} 隐私政策 |`
        )
        .join('\n')
    : '| （未检测到第三方脚本） | — | — | — | — |';
  return `# Cookie 声明（草案）

**适用站点**：${url}
**运营者**：${companyName}
**更新日期**：${today()}

${statusLine}

## 我们使用的 Cookie

| 名称 / 工具 | 类别 | 用途 | 是否需同意 | 有效期 / 来源 |
|---|---|---|---|---|
| 必要 Cookie | 必要 | 维持会话、安全 | 否（豁免） | 会话 / 12 个月 |
${rows}

## 如何管理 Cookie
你可通过浏览器设置或站点 Cookie 横幅管理偏好。撤回同意不影响此前基于同意的处理合法性。

---
*本声明由 ComplianceScan 自动生成，为可编辑草稿，正式发布前建议交由律师审阅。*`;
}

function dpa({ companyName, email, scan }) {
  const subs = describeTrackers(scan?.foundTrackers || []);
  const subRows = subs.length
    ? subs.map((t) => `- **${t.name}**（${t.purpose}）`).join('\n')
    : '- （当前未检测到第三方处理者；接入后请在此补充）';
  return `# 数据处理协议（DPA，草案）

**甲方（控制者）**：${companyName}
**乙方（处理者）**：[填写你的云/分析/SaaS 供应商]
**生效日期**：${today()}

本 DPA 依据 GDPR 第 28 条订立，规范乙方代表甲方处理个人数据的行为。

## 1. 处理范围与目的
乙方仅在处理甲方用户数据以交付约定服务（如托管、分析、邮件发送）的必要范围内处理数据，目的限于：提供合规扫描、监控告警与文档生成服务。

## 2. 乙方的义务
- 仅按甲方书面指令处理数据；
- 确保人员保密；
- 采取适当技术与组织措施（加密、访问控制）；
- 发生个人数据泄露 72 小时内通知甲方；
- 配合监管审计。

## 3. 子处理者（Sub-processors）
甲方当前技术栈可能涉及的子处理者（基于扫描）：
${subRows}

乙方启用任何新子处理者前须书面通知甲方，甲方有权反对。

## 4. 数据留存与返还
服务终止后，乙方应按甲方指令删除或返还全部个人数据。

## 5. 联系方式
数据保护事宜请联系：${email}

---
*本 DPA 为通用模板草案，不构成法律意见。正式签署前建议交由律师审阅。*`;
}

function termsAgreement({ companyName, email, country, scan }) {
  const subs =
    (scan?.foundTrackers || []).map((t) => `- **${t.name}**：${t.purpose}`).join('\n') ||
    '- （未检测到第三方处理者）';
  return `# 服务条款（草案）

**生效日期**：${today()}
**运营者**：${companyName}
**注册地**：${country}

本条款约束你对本站点及 ComplianceScan 服务的使用。

## 1. 服务说明
本服务为网站提供合规扫描、文档生成与每日监控。扫描结果与生成文档均为辅助性草稿，不构成法律意见。

## 2. 账户
你须提供真实邮箱，对账户活动负责，并妥善保管密码。

## 3. 可接受使用
不得利用本服务从事违法活动、滥用性扫描无权检测的站点，或逆向工程本系统。

## 4. 订阅与付费
付费通过 Creem / Paddle 作为 Merchant of Record 处理，按周期自动续费，可在对应平台取消。

## 5. 免责声明
服务按「现状」提供，我们对扫描结果的完整性、准确性不作明示或暗示担保。

## 6. 责任限制
在适用法律允许范围内，我们对间接或后果性损失不承担责任，累计责任不超过你已付费用。

## 7. 适用法律
本条款受 ${country} 法律管辖，争议优先友好协商，协商不成提交有管辖权的法院。

## 8. 第三方处理者
本服务使用的处理者包括：
${subs}

## 9. 联系
条款疑问请联系：${email}

---
*本条款由 ComplianceScan 自动生成，为可编辑草案，不构成法律意见。*`;
}

function refundPolicy({ companyName, email }) {
  return `# 退款政策（草案）

**运营者**：${companyName}
**更新日期**：${today()}

## 1. 支付方式
你的付款由 Creem / Paddle 作为 Merchant of Record 代我们收取并处理，发票由 MoR 出具，退款亦由原路退回。

## 2. 数字服务退款例外
依据欧盟消费者权利指令，数字内容一经交付通常不适用 14 天无理由退款。但在以下情形支持退款：
- 付款后 14 天内从未实际使用任何付费功能；
- 重复扣款或技术故障导致服务未实际交付；
- 我们单方面停止向你所在地区提供服务。

## 3. 如何申请
邮件至 ${email}（主题「退款申请」并附订单号），或在 Creem / Paddle 客户门户发起。

## 4. 处理时效
审核通过后原路退回，通常 5–10 个工作日到账（视 MoR 与支付机构）。

## 5. 订阅取消
取消后不再续费，当前已付周期仍可使用至到期，不自动退款。

## 6. 联系
退款疑问请联系：${email}

---
*本政策由 ComplianceScan 自动生成，为可编辑草案，不构成法律意见。*`;
}

function generateDoc({ docType, url, companyName, email, country, scan }) {
  const ctx = { url, companyName, email, country, scan };
  if (docType === 'cookie') return cookieDeclaration(ctx);
  if (docType === 'dpa') return dpa(ctx);
  if (docType === 'terms') return termsAgreement(ctx);
  if (docType === 'refund') return refundPolicy(ctx);
  return privacyPolicy(ctx); // 默认隐私政策
}

const LABELS = {
  privacy: '隐私政策',
  cookie: 'Cookie 声明',
  dpa: '数据处理协议 (DPA)',
  terms: '服务条款',
  refund: '退款政策',
};

module.exports = { generateDoc, LABELS };
