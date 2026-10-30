/**
 * 本地 / 备用监控运行器
 * 用法（在项目根目录）：node scripts/monitor.js
 * 需配置环境变量：SUPABASE_URL, SUPABASE_SERVICE_KEY, （可选）RESEND_API_KEY, FROM_EMAIL
 *
 * 与 POST /api/cron/monitor 共用 lib/monitor.js 的 runMonitor()。
 * 若你不想用 GitHub Actions，也可用系统 cron 每天调用本脚本：
 *   0 2 * * * cd /path/to/compliance-mvp && node scripts/monitor.js >> monitor.log 2>&1
 */

const path = require('path');

(async () => {
  // require 相对于本脚本所在目录，可正确解析 ../lib/monitor
  const { runMonitor } = require(path.join(__dirname, '..', 'lib', 'monitor'));
  try {
    console.log('[monitor] 开始每日监控', new Date().toISOString());
    const summary = await runMonitor();
    console.log('[monitor] 完成:', JSON.stringify(summary));
    process.exit(0);
  } catch (e) {
    console.error('[monitor] 失败:', e.message);
    process.exit(1);
  }
})();
