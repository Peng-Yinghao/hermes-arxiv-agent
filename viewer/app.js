let allPapers = [];
let favorites = new Set();
let deleted = new Set();
const STORAGE_FAVORITES = "hermes-arxiv-agent:favorites";
const STORAGE_DELETED = "hermes-arxiv-agent:deleted";

function loadSet(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const payload = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(payload) ? payload : [];
    return new Set(arr.map((x) => String(x)));
  } catch (err) {
    console.warn(`加载 ${key} 失败`, err);
    return new Set();
  }
}

function saveSet(key, setObj) {
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(setObj)));
  } catch (err) {
    throw new Error(`保存失败: ${err.message || err}`);
  }
}

function loadFavorites() { favorites = loadSet(STORAGE_FAVORITES); }
function saveFavorites() { saveSet(STORAGE_FAVORITES, favorites); }
function loadDeleted() { deleted = loadSet(STORAGE_DELETED); }
function saveDeleted() { saveSet(STORAGE_DELETED, deleted); }

function isFavorite(arxivId) { return favorites.has(String(arxivId)); }
function isDeleted(arxivId) { return deleted.has(String(arxivId)); }

async function toggleFavorite(arxivId) {
  const key = String(arxivId);
  favorites.has(key) ? favorites.delete(key) : favorites.add(key);
  await saveFavorites();
}

async function deletePaper(arxivId) {
  const key = String(arxivId);
  if (deleted.has(key)) {
    deleted.delete(key);
    await saveDeleted();
    return false;
  } else {
    deleted.add(key);
    favorites.delete(key);
    await saveDeleted();
    await saveFavorites();
    return true;
  }
}

function text(v) {
  return (v || "").toString();
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysAgo(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() - days);
  return d;
}

function inRange(dateValue, start, end) {
  if (!dateValue) {
    return false;
  }
  if (start && dateValue < start) {
    return false;
  }
  if (end && dateValue > end) {
    return false;
  }
  return true;
}

function matchesKeyword(paper, keyword) {
  if (!keyword) {
    return true;
  }
  const target = [
    paper.arxiv_id,
    paper.title,
    paper.authors,
    paper.categories,
    paper.summary_cn,
    paper.abstract,
  ].join(" ").toLowerCase();
  return target.includes(keyword.toLowerCase());
}

function renderCards(papers) {
  const container = document.getElementById("cards");
  container.innerHTML = "";

  if (!papers.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = "当前筛选条件下没有论文。";
    container.appendChild(div);
    return;
  }

  const tpl = document.getElementById("paperTpl");
  papers.forEach((p) => {
    const node = tpl.content.cloneNode(true);

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
      try {
        await toggleFavorite(p.arxiv_id);
        applyFilter();
      } catch (err) {
        alert(err.message || "保存收藏失败");
      } finally {
        favBtn.disabled = false;
      }
    });

    const delBtn = node.querySelector(".delete-btn");
    const removed = isDeleted(p.arxiv_id);
    delBtn.classList.toggle("active", removed);
    delBtn.textContent = removed ? "↩" : "✕";
    delBtn.title = removed ? "恢复此论文" : "删除此论文";
    if (removed) {
      node.querySelector(".card").classList.add("deleted");
    }
    delBtn.addEventListener("click", async () => {
      delBtn.disabled = true;
      try {
        await deletePaper(p.arxiv_id);
        applyFilter();
      } catch (err) {
        alert(err.message || "操作失败");
      } finally {
        delBtn.disabled = false;
      }
    });

    node.querySelector(".meta").textContent =
      `抓取: ${text(p.crawled_date) || "-"} | 发表: ${text(p.published_date) || "-"}` +
      `\n作者: ${text(p.authors) || "-"}`;

    const tags = node.querySelector(".tags");
    const cats = text(p.categories)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    cats.forEach((cat) => {
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

function applyFilter() {
  const dateMode = document.getElementById("dateMode").value;
  const start = document.getElementById("startDate").value;
  const end = document.getElementById("endDate").value;
  const keyword = document.getElementById("keyword").value.trim();
  const favoriteOnly = document.getElementById("favoriteOnly").checked;
  const showDeleted = document.getElementById("showDeleted").checked;

  const papers = allPapers.filter((p) =>
    inRange(text(p[dateMode]), start, end) &&
    matchesKeyword(p, keyword) &&
    (!favoriteOnly || isFavorite(p.arxiv_id)) &&
    (showDeleted || !isDeleted(p.arxiv_id))
  );
  renderCards(papers);

  const totalDeleted = deleted.size;
  const summary = document.getElementById("summary");
  summary.textContent =
    `共 ${allPapers.length} 篇，收藏 ${favorites.size} 篇，已删 ${totalDeleted} 篇，当前展示 ${papers.length} 篇（按 ${dateMode === "crawled_date" ? "抓取日期" : "发表日期"} 筛选）`;
}

function resetFilter(defaultMin, defaultMax) {
  document.getElementById("dateMode").value = "crawled_date";
  document.getElementById("startDate").value = defaultMin || "";
  document.getElementById("endDate").value = defaultMax || "";
  document.getElementById("keyword").value = "";
  document.getElementById("favoriteOnly").checked = false;
  document.getElementById("showDeleted").checked = false;
  applyFilter();
}

function applyQuickRange(range) {
  const startDate = document.getElementById("startDate");
  const endDate = document.getElementById("endDate");
  const today = new Date();
  const end = formatDate(today);

  if (range === "all") {
    startDate.value = "";
    endDate.value = "";
    applyFilter();
    return;
  }

  if (range === "today") {
    startDate.value = end;
    endDate.value = end;
    applyFilter();
    return;
  }

  if (range === "3d") {
    startDate.value = formatDate(daysAgo(today, 2));
    endDate.value = end;
    applyFilter();
    return;
  }

  if (range === "7d") {
    startDate.value = formatDate(daysAgo(today, 6));
    endDate.value = end;
    applyFilter();
  }
}

async function init() {
  const res = await fetch("papers_data.json", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`加载 papers_data.json 失败: HTTP ${res.status}`);
  }

  const payload = await res.json();
  allPapers = payload.papers || [];
  loadFavorites();
  loadDeleted();

  const defaultMin = payload.crawled_date_min || "";
  const defaultMax = payload.crawled_date_max || "";

  document.getElementById("metaText").textContent =
    `收录 ${payload.count || allPapers.length} 篇 | 抓取区间 ${defaultMin || "-"} ~ ${defaultMax || "-"}`;

  const startDate = document.getElementById("startDate");
  const endDate = document.getElementById("endDate");
  startDate.value = defaultMin;
  endDate.value = defaultMax;

  document.getElementById("applyBtn").addEventListener("click", applyFilter);
  document.getElementById("resetBtn").addEventListener("click", () => resetFilter(defaultMin, defaultMax));
  document.getElementById("favoriteOnly").addEventListener("change", applyFilter);
  document.getElementById("showDeleted").addEventListener("change", applyFilter);
  document.getElementById("quickRange").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-range]");
    if (!btn) {
      return;
    }
    applyQuickRange(btn.dataset.range);
  });
  document.getElementById("keyword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      applyFilter();
    }
  });

  applyFilter();
}

init().catch((err) => {
  const summary = document.getElementById("summary");
  summary.textContent = err.message;
});
