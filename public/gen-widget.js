/* ComplianceScan — 政策页「生成你自己的版本」小组件（自包含，不依赖 app.js） */
(function () {
  var DOCS = {
    privacy: { title: '隐私政策', cta: '生成你自己的隐私政策', file: 'privacy-policy' },
    terms: { title: '服务条款', cta: '生成你自己的服务条款', file: 'terms' },
    refund: { title: '退款政策', cta: '生成你自己的退款政策', file: 'refund-policy' },
  };

  var STYLE = `
.gw-zone{margin:26px 0;padding:18px 20px;border:1px solid var(--border);border-radius:14px;background:rgba(109,94,252,.06);}
.gw-zone p{color:var(--muted);margin:0 0 12px;font-size:14px;}
.gw-btn{background:linear-gradient(135deg,var(--primary),var(--primary-2));color:#fff;border:none;padding:11px 18px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;}
.gw-btn:hover{opacity:.92;}
.gw-modal{position:fixed;inset:0;background:rgba(4,8,18,.72);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px;}
.gw-modal.gw-hidden{display:none;}
.gw-card{background:var(--card);border:1px solid var(--border);border-radius:16px;max-width:620px;width:100%;max-height:90vh;overflow:auto;padding:24px;position:relative;}
.gw-close{position:absolute;top:14px;right:16px;background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;line-height:1;}
.gw-title{font-size:20px;margin-bottom:4px;}
.gw-sub{color:var(--muted);font-size:13px;margin-bottom:16px;}
.gw-form label{display:block;font-size:13px;color:var(--muted);margin:12px 0 4px;}
.gw-form input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text);font-size:14px;outline:none;box-sizing:border-box;}
.gw-submit{margin-top:16px;width:100%;background:linear-gradient(135deg,var(--primary),var(--primary-2));color:#fff;border:none;padding:12px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;}
.gw-submit:disabled{opacity:.6;cursor:default;}
.gw-msg{font-size:13px;margin-top:10px;min-height:18px;}
.gw-msg.err{color:var(--red);}
.gw-result{border-top:1px solid var(--border);margin-top:18px;padding-top:16px;}
.gw-result.gw-hidden{display:none;}
.gw-result-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:10px;}
.gw-result-title{font-weight:600;font-size:14px;}
.gw-result-bar button{background:var(--bg);border:1px solid var(--border);color:var(--text);padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;margin-left:6px;}
.gw-preview{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;max-height:320px;overflow:auto;font-size:12.5px;line-height:1.5;white-space:pre-wrap;color:var(--text);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
`;

  function injectStyle() {
    if (!document.getElementById('gw-style')) {
      var s = document.createElement('style');
      s.id = 'gw-style';
      s.textContent = STYLE;
      document.head.appendChild(s);
    }
  }

  function h(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function buildModal(doc, meta) {
    var overlay = h(
      '<div class="gw-modal gw-hidden"><div class="gw-card">' +
      '<button class="gw-close" aria-label="关闭">×</button>' +
      '<h3 class="gw-title">生成' + meta.title + '</h3>' +
      '<p class="gw-sub">填写信息，基于合规最佳实践生成可编辑草稿（非法律意见，建议律师审阅）。</p>' +
      '<form class="gw-form">' +
      '<label>公司 / 站点主体名称<input name="company" placeholder="如 Acme Ltd." required></label>' +
      '<label>联系邮箱<input name="email" type="email" placeholder="legal@yourcompany.com" required></label>' +
      '<label>注册国家 / 地区<input name="country" value="United Kingdom"></label>' +
      '<label>网站网址（可选，用于结合扫描）<input name="url" placeholder="https://example.com"></label>' +
      '<button type="submit" class="gw-submit">生成草稿</button>' +
      '<p class="gw-msg"></p>' +
      '</form>' +
      '<div class="gw-result gw-hidden">' +
      '<div class="gw-result-bar"><span class="gw-result-title"></span>' +
      '<span><button class="gw-copy">复制</button><button class="gw-download">下载 .md</button></span></div>' +
      '<pre class="gw-preview"></pre>' +
      '</div>' +
      '</div></div>'
    );

    var form = overlay.querySelector('.gw-form');
    var msg = overlay.querySelector('.gw-msg');
    var result = overlay.querySelector('.gw-result');
    var preview = overlay.querySelector('.gw-preview');
    var rtitle = overlay.querySelector('.gw-result-title');
    var submit = overlay.querySelector('.gw-submit');

    overlay.querySelector('.gw-close').addEventListener('click', function () {
      overlay.classList.add('gw-hidden');
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.classList.add('gw-hidden');
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.textContent = '';
      msg.className = 'gw-msg';
      var payload = {
        docType: doc,
        companyName: form.querySelector('[name=company]').value.trim(),
        email: form.querySelector('[name=email]').value.trim(),
        country: form.querySelector('[name=country]').value.trim(),
        url: form.querySelector('[name=url]').value.trim(),
      };
      submit.disabled = true;
      submit.textContent = '生成中…';
      fetch('/api/generate-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, d: d };
          });
        })
        .then(function (o) {
          if (!o.ok) throw new Error(o.d.error || '生成失败');
          rtitle.textContent = meta.title + ' · 草稿';
          preview.textContent = o.d.markdown;
          result.classList.remove('gw-hidden');
        })
        .catch(function (err) {
          msg.className = 'gw-msg err';
          msg.textContent = '⚠️ ' + err.message;
        })
        .finally(function () {
          submit.disabled = false;
          submit.textContent = '生成草稿';
        });
    });

    overlay.querySelector('.gw-copy').addEventListener('click', function () {
      navigator.clipboard
        .writeText(preview.textContent)
        .then(function () {
          var b = overlay.querySelector('.gw-copy');
          b.textContent = '已复制 ✓';
          setTimeout(function () {
            b.textContent = '复制';
          }, 1500);
        })
        .catch(function () {
          alert('复制失败，请手动选择文本复制。');
        });
    });

    overlay.querySelector('.gw-download').addEventListener('click', function () {
      var blob = new Blob([preview.textContent], { type: 'text/markdown;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'compliance-' + meta.file + '-' + Date.now() + '.md';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    return overlay;
  }

  function init() {
    injectStyle();
    var mounts = document.querySelectorAll('.gen-widget');
    Array.prototype.forEach.call(mounts, function (mount) {
      var doc = mount.getAttribute('data-doc') || 'privacy';
      var meta = DOCS[doc] || DOCS.privacy;
      var zone = h(
        '<div class="gw-zone"><p>不想手动替换占位符？填好信息，一键生成你的 ' +
          meta.title +
          ' 草稿：</p></div>'
      );
      var btn = h('<button class="gw-btn">📄 ' + meta.cta + '</button>');
      zone.appendChild(btn);
      mount.appendChild(zone);
      var modal;
      btn.addEventListener('click', function () {
        if (!modal) {
          modal = buildModal(doc, meta);
          mount.appendChild(modal);
        }
        modal.classList.remove('gw-hidden');
      });
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
