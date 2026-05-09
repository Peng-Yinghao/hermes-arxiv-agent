let allPapers = [];
let favorites = new Set();
let deleted = new Set();
const STORAGE_FAVORITES = "hermes-arxiv-agent:favorites";
const STORAGE_DELETED = "hermes-arxiv-agent:deleted";
const STORAGE_TOKEN = "hermes-arxiv-agent:gh-token";
const REPO_OWNER = "Peng-Yinghao";
const REPO_NAME = "hermes-arxiv-agent";
const DELETED_PATH = "deleted_ids.txt";
let ghToken = "";

// ── Storage helpers ──
function loadSet(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const payload = raw ? JSON.parse(raw) : [];
    return new Set((Array.isArray(payload) ? payload : []).map(String));
  } catch { return new Set(); }
}
function saveSet(key, setObj) {
  window.localStorage.setItem(key, JSON.stringify([...setObj]));
}
function loadFavorites() { favorites = loadSet(STORAGE_FAVORITES); }
function saveFavorites() { saveSet(STORAGE_FAVORITES, favorites); }
function loadDeleted() { deleted = loadSet(STORAGE_DELETED); }
function saveDeleted() { saveSet(STORAGE_DELETED, deleted); }
function loadToken() {
  ghToken = window.localStorage.getItem(STORAGE_TOKEN) || "";
}
function saveToken(t) {
  ghToken = t;
  window.localStorage.setItem(STORAGE_TOKEN, t);
}

function isFavorite(id) { return favorites.has(String(id)); }
function isDeleted(id) { return deleted.has(String(id)); }

async function toggleFavorite(arxivId) {
  const key = String(arxivId);
  favorites.has(key) ? favorites.delete(key) : favorites.add(key);
  saveFavorites();
}

// ── GitHub API deletion ──
async function githubApi(path, method, body) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${ghToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function deleteViaGitHub(arxivId) {
  // 1) Read current deleted_ids.txt
  let sha = "", content = "";
  try {
    const data = await githubApi(DELETED_PATH, "GET");
    sha = data.sha;
    content = atob(data.content.replace(/\n/g, ""));
  } catch (e) {
    // File might not exist or be empty — create fresh
    content = "";
  }

  // 2) Check if already deleted
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.includes(arxivId)) {
    // Remove it (undelete)
    const newContent = lines.filter(l => l !== arxivId).join("\n") + (lines.length > 1 ? "\n" : "");
    await githubApi(DELETED_PATH, "PUT", {
      message: `undelete: remove ${arxivId} from deleted_ids.txt`,
      content: btoa(unescape(encodeURIComponent(newContent))),
      sha,
    });
    return { action: "restored" };
  }

  // 3) Append new ID
  const newContent = (content ? content + "\n" : "") + arxivId + "\n";
  const body = {
    message: `delete: add ${arxivId} to deleted_ids.txt`,
    content: btoa(unescape(encodeURIComponent(newContent))),
  };
  if (sha) body.sha = sha;
  await githubApi(DELETED_PATH, "PUT", body);
  return { action: "deleted" };
}

// ── Token setup modal ──
function showTokenSetup(callback) {
  const existing = document.querySelector(".token-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "token-modal";
  modal.innerHTML = `
    <div class="token-modal-box">
      <h3>🔑 设置 GitHub Token</h3>
      <p>删除论文需要 GitHub Personal Access Token。</p>
      <p>1. 访问 <a href="https://github.com/settings/tokens?type=beta" target="_blank">GitHub → Fine-grained tokens</a></p>
      <p>2. 创建 token，选择仓库 <b>${REPO_OWNER}/${REPO_NAME}</b></p>
      <p>3. 权限：<b>Contents: Read and write</b></p>
      <input type="password" id="ghTokenInput" placeholder="github_pat_..." autocomplete="off">
      <div class="token-modal-btns">
        <button id="saveTokenBtn" class="btn btn-primary">保存</button>
        <button id="skipTokenBtn" class="btn">跳过（仅本地隐藏）</button>
      </div>
      <p class="token-hint">Token 仅存储在浏览器 localStorage，不会上传到服务器。</p>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById("saveTokenBtn").addEventListener("click", () => {
    const val = document.getElementById("ghTokenInput").value.trim();
    if (val) {
      saveToken(val);
      modal.remove();
      if (callback) callback(true);
    }
  });
  document.getElementById("skipTokenBtn").addEventListener("click", () => {
    modal.remove();
    if (callback) callback(false);
  });
}

// ── Render ──
function text(v) { return (v || "").toString(); }
function formatDate(d) {
  const y = d.getFullYear(), m = `${d.getMonth()+1}`.padStart(2,"0"), day = `${d.getDate()}`.padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function daysAgo(base, days) { const d = new Date(base); d.setDate(d.getDate()-days); return d; }
function inRange(v, s, e) { if (!v) return false; if (s && v < s) return false; if (e && v > e) return false; return true; }
function matchesKeyword(p, kw) {
  if (!kw) return true;
  const t = [p.arxiv_id, p.title, p.authors, p.categories, p.summary_cn, p.abstract].join(" ").toLowerCase();
  return t.includes(kw.toLowerCase());
}

function renderCards(papers) {
  const container = document.getElementById("cards");
  container.innerHTML = "";
  if (!papers.length) {
    container.innerHTML = '<div class="empty">当前筛选条件下没有论文。</div>';
    return;
  }
  const tpl = document.getElementById("paperTpl");
  papers.forEach(p => {
    const node = tpl.content.cloneNode(true);
    const article = node.querySelector("article");

    node.querySelector(".pill").textContent = p.arxiv_id;
    const title = node.querySelector(".title");
    title.textContent = text(p.title) || p.arxiv_id;
    title.href = `https://arxiv.org/abs/${p.arxiv_id}`;

    const favBtn = node.querySelector(".favorite-btn");
    const favored = isFavorite(p.arxiv_id);
    favBtn.classList.toggle("active", favored);
    favBtn.textContent = favored ? "★ 已收藏" : "☆ 收藏";
    favBtn.addEventListener("click", async () => {
      favBtn.disabled = true;
      try { await toggleFavorite(p.arxiv_id); applyFilter(); }
      finally { favBtn.disabled = false; }
    });

    // Delete button
    const delBtn = node.querySelector(".delete-btn");
    const removed = isDeleted(p.arxiv_id);
    delBtn.classList.toggle("active", removed);
    delBtn.textContent = removed ? "↩" : "✕";
    delBtn.title = removed ? "恢复" : "永久删除";
    if (removed) article.classList.add("deleted");

    delBtn.addEventListener("click", async () => {
      delBtn.disabled = true;
      delBtn.textContent = "⏳";
      try {
        if (!ghToken) {
          showTokenSetup((hasToken) => {
            if (hasToken) delBtn.click();
            else { delBtn.disabled = false; delBtn.textContent = "✕"; }
          });
          return;
        }
        const result = await deleteViaGitHub(p.arxiv_id);
        if (result.action === "deleted") {
          deleted.add(String(p.arxiv_id));
          favorites.delete(String(p.arxiv_id));
          saveDeleted(); saveFavorites();
          showToast(`✓ 已删除「${p.arxiv_id}」`, "success");
        } else {
          deleted.delete(String(p.arxiv_id));
          saveDeleted();
          showToast(`↩ 已恢复「${p.arxiv_id}」`, "info");
        }
        applyFilter();
      } catch (err) {
        showToast(`删除失败: ${err.message}`, "error");
        delBtn.disabled = false;
        delBtn.textContent = "✕";
      }
    });

    // MD button — full markdown from arxiv2md
    node.querySelector(".md-btn").addEventListener("click", async () => {
      const btn = node.querySelector(".md-btn");
      btn.disabled = true;
      btn.textContent = "⏳";
      try {
        await showMarkdownModal(p, "full");
      } catch (err) {
        showToast("加载失败: " + err.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "MD";
      }
    });

    node.querySelector(".meta").textContent =
      `抓取: ${text(p.crawled_date)||"-"} | 发表: ${text(p.published_date)||"-"}\n作者: ${text(p.authors)||"-"}`;

    const tags = node.querySelector(".tags");
    (text(p.categories).split(",").map(x=>x.trim()).filter(Boolean)).forEach(cat => {
      const span = document.createElement("span");
      span.className = "tag";
      span.textContent = cat;
      tags.appendChild(span);
    });

    node.querySelector(".summary-cn").textContent = text(p.summary_cn) || "未提供";
    node.querySelector(".abstract").textContent = text(p.abstract) || "未提供";
    container.appendChild(node);
  });
}

// ── Toast ──
function showToast(msg, type) {
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 3000);
}

// ── Filter ──
function applyFilter() {
  const dateMode = document.getElementById("dateMode").value;
  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;
  const keyword = document.getElementById("keyword").value.trim();
  const favoriteOnly = document.getElementById("favoriteOnly").checked;
  const showDeleted = document.getElementById("showDeleted").checked;

  const papers = allPapers.filter(p =>
    inRange(text(p[dateMode]), start, end) &&
    matchesKeyword(p, keyword) &&
    (!favoriteOnly || isFavorite(p.arxiv_id)) &&
    (showDeleted || !isDeleted(p.arxiv_id))
  );
  renderCards(papers);

  document.getElementById("summary").textContent =
    `共 ${allPapers.length} 篇，收藏 ${favorites.size} 篇，已删 ${deleted.size} 篇，当前展示 ${papers.length} 篇`;
}

function resetFilter(dmin, dmax) {
  document.getElementById("dateMode").value = "crawled_date";
  document.getElementById("startDate").value = dmin || "";
  document.getElementById("endDate").value = dmax || "";
  document.getElementById("keyword").value = "";
  document.getElementById("favoriteOnly").checked = false;
  document.getElementById("showDeleted").checked = false;
  applyFilter();
}

function applyQuickRange(range) {
  const startEl = document.getElementById("startDate");
  const endEl = document.getElementById("endDate");
  const today = new Date();
  const end = formatDate(today);
  if (range === "all") { startEl.value = ""; endEl.value = ""; }
  else if (range === "today") { startEl.value = end; endEl.value = end; }
  else if (range === "3d") { startEl.value = formatDate(daysAgo(today,2)); endEl.value = end; }
  else if (range === "7d") { startEl.value = formatDate(daysAgo(today,6)); endEl.value = end; }
  applyFilter();
}

// ── Init ──
async function init() {
  loadToken();
  const res = await fetch("papers_data.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`加载失败 HTTP ${res.status}`);
  const payload = await res.json();
  allPapers = payload.papers || [];
  loadFavorites();
  loadDeleted();

  document.getElementById("metaText").textContent =
    `收录 ${payload.count||allPapers.length} 篇 | 抓取区间 ${payload.crawled_date_min||"-"} ~ ${payload.crawled_date_max||"-"}`;

  const startEl = document.getElementById("startDate");
  const endEl = document.getElementById("endDate");
  startEl.value = payload.crawled_date_min || "";
  endEl.value = payload.crawled_date_max || "";

  document.getElementById("applyBtn").addEventListener("click", applyFilter);
  document.getElementById("resetBtn").addEventListener("click", () => resetFilter(payload.crawled_date_min, payload.crawled_date_max));
  document.getElementById("favoriteOnly").addEventListener("change", applyFilter);
  document.getElementById("showDeleted").addEventListener("change", applyFilter);
  document.getElementById("quickRange").addEventListener("click", e => {
    const btn = e.target.closest("button[data-range]");
    if (btn) applyQuickRange(btn.dataset.range);
  });
  document.getElementById("keyword").addEventListener("keydown", e => {
    if (e.key === "Enter") applyFilter();
  });

  applyFilter();

  // Settings button
  document.getElementById("settingsBtn").addEventListener("click", () => {
    showTokenSetup((hasToken) => {
      if (hasToken) showToast("✓ Token 已保存，删除功能已启用", "success");
    });
  });

  // Markdown modal handlers
  document.getElementById("mdModalClose").addEventListener("click", hideMarkdownModal);
  document.getElementById("mdModal").addEventListener("click", e => {
    if (e.target === document.getElementById("mdModal")) hideMarkdownModal();
  });
  document.getElementById("mdCopyBtn").addEventListener("click", () => {
    if (currentMdPaper) {
      const md = generateMarkdown(currentMdPaper);
      navigator.clipboard.writeText(md).then(() => {
        showToast("✓ Markdown 已复制到剪贴板", "success");
      });
    }
  });
  document.getElementById("mdRawBtn").addEventListener("click", () => {
    showMdRaw = !showMdRaw;
    document.getElementById("mdRawBtn").textContent = showMdRaw ? "查看渲染" : "查看源码";
    if (currentMdPaper) updateMdBody(generateMarkdown(currentMdPaper));
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") hideMarkdownModal();
  });

  // Show token hint if not set
  if (!ghToken) {
    const hint = document.createElement("div");
    hint.className = "token-hint-bar";
    hint.innerHTML = '💡 <a href="#" id="setupTokenLink">设置 GitHub Token</a> 可启用一键永久删除';
    document.querySelector(".topbar").appendChild(hint);
    document.getElementById("setupTokenLink").addEventListener("click", e => {
      e.preventDefault();
      showTokenSetup(() => { hint.remove(); });
    });
  }
}

init().catch(err => {
  document.getElementById("summary").textContent = err.message;
});

// ── Markdown generation & modal ──
function generateMarkdown(p) {
  const today = new Date().toISOString().slice(0, 10);
  return `# ${p.title || p.arxiv_id}

**arXiv ID**: [${p.arxiv_id}](https://arxiv.org/abs/${p.arxiv_id})  
**Authors**: ${p.authors || "-"}  
**Published**: ${p.published_date || "-"} | **Crawled**: ${p.crawled_date || "-"}  
**Categories**: ${p.categories || "-"}  
**PDF**: [${p.pdf_filename || p.arxiv_id + ".pdf"}](https://arxiv.org/pdf/${p.arxiv_id})

---

## 中文摘要

${p.summary_cn || "（暂未提供）"}

---

## Abstract

${p.abstract || "（暂未提供）"}

---

> Auto-generated on ${today}
`;
}

let currentMdPaper = null;
let showMdRaw = false;

async function showMarkdownModal(p, mode) {
  currentMdPaper = p;
  showMdRaw = false;
  document.getElementById("mdModalTitle").textContent = p.title || p.arxiv_id;

  const resp = await fetch(`markdown_full/${p.arxiv_id}.md`);
  if (!resp.ok) throw new Error(`全文 Markdown 未生成（HTTP ${resp.status}）`);
  const md = await resp.text();

  updateMdBody(md);
  document.getElementById("mdModal").style.display = "flex";
  document.body.style.overflow = "hidden";
}

function hideMarkdownModal() {
  document.getElementById("mdModal").style.display = "none";
  document.body.style.overflow = "";
  currentMdPaper = null;
}

function updateMdBody(md) {
  const body = document.getElementById("mdModalBody");
  if (showMdRaw) {
    body.innerHTML = `<pre class="md-raw">${escapeHtml(md)}</pre>`;
  } else {
    body.innerHTML = marked.parse(md);
  }
}

function escapeHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
