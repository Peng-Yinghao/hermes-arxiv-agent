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
    const mdBtn = node.querySelector(".md-btn");
    if (!mdBtn) { console.error("MD button not found in template"); return; }
    mdBtn.addEventListener("click", async () => {
      mdBtn.disabled = true;
      mdBtn.textContent = "⏳";
      try {
        await showMarkdownModal(p);
      } catch (err) {
        console.error("MD load error:", err);
        alert("加载失败: " + (err.message || err));
      } finally {
        mdBtn.disabled = false;
        mdBtn.textContent = "MD";
      }
    });

    // Review button — AI deep analysis from different LLM
    const reviewBtn = node.querySelector(".review-btn");
    if (reviewBtn) {
      reviewBtn.addEventListener("click", async () => {
        reviewBtn.disabled = true;
        reviewBtn.textContent = "⏳";
        try {
          await showReviewModal(p);
        } catch (err) {
          console.error("Review load error:", err);
          if (err.message === "NOT_FOUND") {
            alert("该论文的 AI 精读尚未生成，请稍后再试。");
          } else {
            alert("加载失败: " + (err.message || err));
          }
        } finally {
          reviewBtn.disabled = false;
          reviewBtn.textContent = "🤖 精读";
        }
      });
    }

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

    // Classification tags
    const clsContainer = document.createElement("div");
    clsContainer.className = "cls-tags";
    if (p.scene) clsContainer.appendChild(makeClsTag("🎯 " + p.scene, "scene"));
    if (p.form) clsContainer.appendChild(makeClsTag("💾 " + p.form, "form"));
    if (p.mem_type) clsContainer.appendChild(makeClsTag("🧠 " + p.mem_type, "mem"));
    if (p.peer_reviewed && p.peer_reviewed.startsWith("✓")) {
      clsContainer.appendChild(makeClsTag("✓ 同行评议", "peer"));
    }
    if (clsContainer.children.length) {
      node.querySelector(".section").before(clsContainer);
    }

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

function makeClsTag(text, kind) {
  const s = document.createElement("span");
  s.className = `cls-tag cls-${kind}`;
  s.textContent = text;
  return s;
}

// ── Filter ──
function applyFilter() {
  const dateMode = document.getElementById("dateMode").value;
  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;
  const keyword = document.getElementById("keyword").value.trim();
  const favoriteOnly = document.getElementById("favoriteOnly").checked;
  const showDeleted = document.getElementById("showDeleted").checked;
  const peerReviewOnly = document.getElementById("peerReviewOnly").checked;
  const scene = document.getElementById("sceneFilter").value;
  const form = document.getElementById("formFilter").value;
  const memType = document.getElementById("memTypeFilter").value;

  const papers = allPapers.filter(p =>
    inRange(text(p[dateMode]), start, end) &&
    matchesKeyword(p, keyword) &&
    (!favoriteOnly || isFavorite(p.arxiv_id)) &&
    (showDeleted || !isDeleted(p.arxiv_id)) &&
    (!peerReviewOnly || (p.peer_reviewed || "").startsWith("✓")) &&
    (!scene || (p.scene || "").includes(scene)) &&
    (!form || (p.form || "").includes(form)) &&
    (!memType || (p.mem_type || "").includes(memType))
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
  document.getElementById("peerReviewOnly").checked = false;
  document.getElementById("sceneFilter").value = "";
  document.getElementById("formFilter").value = "";
  document.getElementById("memTypeFilter").value = "";
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
  document.getElementById("peerReviewOnly").addEventListener("change", applyFilter);
  document.getElementById("sceneFilter").addEventListener("change", applyFilter);
  document.getElementById("formFilter").addEventListener("change", applyFilter);
  document.getElementById("memTypeFilter").addEventListener("change", applyFilter);
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
    if (currentMdRaw) {
      navigator.clipboard.writeText(currentMdRaw).then(() => {
        showToast("✓ Markdown 已复制到剪贴板", "success");
      });
    }
  });
  document.getElementById("mdRawBtn").addEventListener("click", () => {
    showMdRaw = !showMdRaw;
    document.getElementById("mdRawBtn").textContent = showMdRaw ? "查看渲染" : "查看源码";
    const body = document.getElementById("mdModalBody");
    if (currentMdRaw) {
      body.innerHTML = showMdRaw
        ? `<pre class="md-raw">${escapeHtml(currentMdRaw)}</pre>`
        : renderMarkdown(currentMdRaw);
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (document.getElementById("reviewModal").style.display === "flex") hideReviewModal();
      else if (document.getElementById("mdModal").style.display === "flex") hideMarkdownModal();
    }
  });

  // Review modal handlers
  document.getElementById("reviewModalClose").addEventListener("click", hideReviewModal);
  document.getElementById("reviewModal").addEventListener("click", e => {
    if (e.target === document.getElementById("reviewModal")) hideReviewModal();
  });
  document.getElementById("reviewCopyBtn").addEventListener("click", () => {
    if (currentReviewRaw) {
      navigator.clipboard.writeText(currentReviewRaw).then(() => {
        showToast("✓ 精读已复制到剪贴板", "success");
      });
    }
  });
  document.getElementById("reviewRawBtn").addEventListener("click", () => {
    showReviewRaw = !showReviewRaw;
    document.getElementById("reviewRawBtn").textContent = showReviewRaw ? "查看渲染" : "查看源码";
    const body = document.getElementById("reviewModalBody");
    if (currentReviewRaw) {
      body.innerHTML = showReviewRaw
        ? `<pre class="md-raw">${escapeHtml(currentReviewRaw)}</pre>`
        : renderMarkdown(currentReviewRaw);
    }
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

// ── Markdown modal ──
let currentMdPaper = null;
let showMdRaw = false;
let currentMdRaw = "";  // raw markdown text

async function showMarkdownModal(p) {
  const modal = document.getElementById("mdModal");
  const title = document.getElementById("mdModalTitle");
  const body = document.getElementById("mdModalBody");
  if (!modal || !title || !body) {
    throw new Error("Markdown 弹窗组件缺失，请刷新页面");
  }

  currentMdPaper = p;
  showMdRaw = false;
  title.textContent = p.title || p.arxiv_id;

  console.log("Loading full MD for", p.arxiv_id);
  const resp = await fetch(`markdown_full/${p.arxiv_id}.md`);
  if (!resp.ok) throw new Error(`全文 Markdown 未部署（HTTP ${resp.status}）。部署后等待 GitHub Actions 完成。`);
  currentMdRaw = await resp.text();
  console.log("Loaded", currentMdRaw.length, "chars");
  body.innerHTML = renderMarkdown(currentMdRaw);

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function hideMarkdownModal() {
  document.getElementById("mdModal").style.display = "none";
  document.body.style.overflow = "";
  currentMdPaper = null;
}

// ── Review modal (AI deep analysis) ──
let currentReviewPaper = null;
let showReviewRaw = false;
let currentReviewRaw = "";

async function showReviewModal(p) {
  const modal = document.getElementById("reviewModal");
  const title = document.getElementById("reviewModalTitle");
  const body = document.getElementById("reviewModalBody");
  if (!modal || !title || !body) {
    throw new Error("精读弹窗组件缺失，请刷新页面");
  }

  currentReviewPaper = p;
  showReviewRaw = false;
  title.textContent = "🤖 " + (p.title || p.arxiv_id);

  console.log("Loading review for", p.arxiv_id);
  const resp = await fetch(`review_md/${p.arxiv_id}.md`);
  if (resp.status === 404) {
    throw new Error("NOT_FOUND");
  }
  if (!resp.ok) throw new Error(`精读加载失败（HTTP ${resp.status}）`);
  currentReviewRaw = await resp.text();
  console.log("Loaded review", currentReviewRaw.length, "chars");
  body.innerHTML = renderMarkdown(currentReviewRaw);

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function hideReviewModal() {
  document.getElementById("reviewModal").style.display = "none";
  document.body.style.overflow = "";
  currentReviewPaper = null;
}

function escapeHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Built-in markdown renderer (no CDN dependency) ──
function renderMarkdown(md) {
  // Remove YAML frontmatter
  md = md.replace(/^---[\s\S]*?---\n*/, "");

  let html = md;

  // Code blocks (must be first)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`);

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Headers
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // Ordered lists
  html = html.replace(/^(\d+)\. (.+)$/gm, (_, num, text) => `<li value="${num}">${text}</li>`);

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");

  // Wrap consecutive <li> in <ol>/<ul>
  html = html.replace(/((?:<li(?: value="\d+")?>.*<\/li>\n?)+)/g, (m) => {
    if (m.includes('value="')) return `<ol>\n${m}</ol>`;
    return `<ul>\n${m}</ul>`;
  });

  // Paragraphs: wrap lines that aren't already HTML tags
  const lines = html.split("\n");
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { out.push(""); continue; }
    if (/^<(h[1-4]|pre|ul|ol|li|blockquote|hr|table|div)/.test(trimmed)) {
      out.push(trimmed);
    } else {
      out.push(`<p>${trimmed}</p>`);
    }
  }
  html = out.join("\n");

  // Tables (simple)
  html = html.replace(/<p>\|(.+)\|<\/p>\n<p>\|[-| :]+\|<\/p>\n((?:<p>\|.+\|<\/p>\n?)+)/g, (_, header, rows) => {
    const hcells = header.split("|").filter(c => c.trim());
    const rlines = rows.match(/<p>\|(.+)\|<\/p>/g) || [];
    let table = "<table><thead><tr>";
    hcells.forEach(c => { table += `<th>${c.trim()}</th>`; });
    table += "</tr></thead><tbody>";
    rlines.forEach(r => {
      const cells = r.replace(/<\/?p>/g, "").split("|").filter(c => c.trim());
      table += "<tr>";
      cells.forEach(c => { table += `<td>${c.trim()}</td>`; });
      table += "</tr>";
    });
    table += "</tbody></table>";
    return table;
  });

  return html;
}
