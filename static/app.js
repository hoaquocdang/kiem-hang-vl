// ===== DOM REFERENCES =====
const folderView = document.getElementById("folder-view");
const folderCaption = document.getElementById("folder-caption");
const folderStatus = document.getElementById("folder-status");
const pickFolderBtn = document.getElementById("pick-folder-btn");
const folderLabel = document.getElementById("folder-label");
const changeFolderButton = document.getElementById("change-folder-button");
const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const authTitle = document.getElementById("auth-title");
const authCaption = document.getElementById("auth-caption");
const authStatus = document.getElementById("auth-status");
const loginForm = document.getElementById("login-form");
const setupForm = document.getElementById("setup-form");
const userLabel = document.getElementById("user-label");
const logoutButton = document.getElementById("logout-button");
const adminToggle = document.getElementById("admin-toggle");
const adminPanel = document.getElementById("admin-panel");
const createUserForm = document.getElementById("create-user-form");
const adminStatus = document.getElementById("admin-status");
const accountSheetPath = document.getElementById("account-sheet-path");
const userList = document.getElementById("user-list");
const exportButton = document.getElementById("export-button");
const importForm = document.getElementById("import-form");
const scanForm = document.getElementById("scan-form");
const importStatus = document.getElementById("import-status");
const scanStatus = document.getElementById("scan-status");
const sessionMeta = document.getElementById("session-meta");
const statsGrid = document.getElementById("stats-grid");
const itemsBody = document.getElementById("items-body");
const discrepancyList = document.getElementById("discrepancy-list");
const discrepancySummary = document.getElementById("discrepancy-summary");
const discrepancyCaption = document.getElementById("discrepancy-caption");
const recentScans = document.getElementById("recent-scans");
const recentPagination = document.getElementById("recent-pagination");
const recentPrev = document.getElementById("recent-prev");
const recentNext = document.getElementById("recent-next");
const barcodeInput = document.getElementById("barcode-input");
const previewButton = document.getElementById("preview-button");
const finalizeButton = document.getElementById("finalize-button");
const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");
const searchCount = document.getElementById("search-count");
const itemsPagination = document.getElementById("items-pagination");
const itemsPageInfo = document.getElementById("items-page-info");
const itemsFirst = document.getElementById("items-first");
const itemsPrev = document.getElementById("items-prev");
const itemsNext = document.getElementById("items-next");
const itemsLast = document.getElementById("items-last");
const excessAlert = document.getElementById("excess-alert");

// ===== GLOBAL STATE =====
let discrepancyMode = "compact";
let recentScanPage = 0;
let itemsPage = 0;
let currentUser = null;
let storageMode = null; // "local" | "bridge" | "fs"
let fsData = null;      // in-memory data for FS mode
let dirHandle = null;   // FileSystemDirectoryHandle
let searchQuery = "";
let lastDashboard = null;

const RECENT_SCAN_PAGE_SIZE = 5;
const ITEMS_PAGE_SIZE = 20;
const LOCAL_BRIDGE_URL = "http://127.0.0.1:8020";
const BRIDGE_DETECTION_TIMEOUT_MS = 2500;
const IS_REMOTE_FRONTEND = !["127.0.0.1", "localhost", ""].includes(window.location.hostname);
const USE_LOCAL_BRIDGE = IS_REMOTE_FRONTEND && new URLSearchParams(window.location.search).get("bridge") === "1";
const AUTH_TOKEN_KEY = "stockAuditLocalSessionToken";
const FS_USER_KEY = "stockAuditFSUser";
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1iGzRcG2j7JdWlOyWrmGmTxRwLw9v3S813_6y_fCUsfM/export?format=csv&gid=0";

let authToken = window.localStorage.getItem(AUTH_TOKEN_KEY) || "";
let API_BASE = "";

const reasonOptions = [
  "Chưa có lý do",
  "Thiếu hàng thực tế",
  "Dư hàng thực tế",
  "Sai màu",
  "Sai size",
  "Lệch tác nghiệp",
  "Hàng chưa cập nhật kho",
  "Khác"
];

// ===== UTILITY =====
function setStatus(element, message, type = "") {
  element.textContent = message;
  element.className = `status-line ${type}`.trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortenUserAgent(value) {
  const text = String(value || "").trim();
  if (!text) return "Chưa ghi nhận";
  return text.length > 86 ? `${text.slice(0, 83)}...` : text;
}

function numberFormat(value) {
  return new Intl.NumberFormat("vi-VN").format(value || 0);
}

function badgeClass(status) {
  return ["matched", "over", "short"].includes(status) ? status : "matched";
}

function statusLabel(status) {
  if (status === "over") return "Dư";
  if (status === "short") return "Thiếu";
  return "Khớp";
}

function getErrorMessage(error) {
  if (error instanceof TypeError) {
    if (storageMode === "bridge" || USE_LOCAL_BRIDGE) {
      return "Không kết nối được local bridge. Hãy kiểm tra mạng hoặc mở lại Stock Audit App.exe.";
    }
    if (storageMode === "fs") {
      return "Không kết nối được dịch vụ xử lý file trên Vercel. Hãy kiểm tra mạng hoặc tải lại trang.";
    }
    return "Không kết nối được server. Hãy kiểm tra kết nối mạng hoặc tải lại trang.";
  }
  return error.message || "Có lỗi xảy ra. Vui lòng thử lại.";
}

async function readResponsePayload(response) {
  const rawText = await response.text();
  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    return { detail: rawText || `HTTP ${response.status}` };
  }
}

// ===== API LAYER (bridge/local mode) =====
async function apiJson(url, options = {}) {
  const response = await apiFetch(url, options);
  const data = await readResponsePayload(response);
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
  return data;
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (options.body && typeof options.body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`${API_BASE}${url}`, { ...options, headers });
}

function setAuthToken(token) {
  authToken = token || "";
  if (authToken) window.localStorage.setItem(AUTH_TOKEN_KEY, authToken);
  else window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

// ===== MODE DETECTION =====
async function fetchHealth(baseUrl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/health`, { cache: "no-store", signal: ctrl.signal });
    return res.ok ? await res.json().catch(() => null) : null;
  } finally {
    clearTimeout(timer);
  }
}

async function detectStorageMode() {
  if (!IS_REMOTE_FRONTEND) {
    storageMode = "local";
    API_BASE = "";
    return;
  }

  if (!USE_LOCAL_BRIDGE) {
    storageMode = "cloud";
    API_BASE = "";
    return;
  }

  // Try local bridge if explicitly requested via ?bridge=1
  if (USE_LOCAL_BRIDGE) {
    try {
      const health = await fetchHealth(LOCAL_BRIDGE_URL, BRIDGE_DETECTION_TIMEOUT_MS);
      if (health?.local_bridge && health?.storage?.writes_enabled) {
        storageMode = "bridge";
        API_BASE = LOCAL_BRIDGE_URL;
        return;
      }
    } catch {}
  }

  storageMode = "fs";
  API_BASE = window.location.origin;
}

// ===== INDEXEDDB HELPERS =====
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("stockaudit", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadDirHandleFromIDB() {
  try {
    const db = await openIDB();
    return await new Promise((resolve) => {
      const tx = db.transaction("handles", "readonly");
      const req = tx.objectStore("handles").get("dir");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveDirHandleToIDB(handle) {
  try {
    const db = await openIDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("handles", "readwrite");
      tx.objectStore("handles").put(handle, "dir");
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  } catch {}
}

// ===== FILE SYSTEM API =====
function fsModeSupported() {
  return typeof window.showDirectoryPicker === "function";
}

async function pickFolder() {
  dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  await saveDirHandleToIDB(dirHandle);
  return dirHandle;
}

async function requestFolderPermission(handle) {
  const perm = await handle.queryPermission({ mode: "readwrite" });
  if (perm === "granted") return true;
  const req = await handle.requestPermission({ mode: "readwrite" });
  return req === "granted";
}

function fsFilename(username) {
  return `stockaudit-${username.replace(/[^a-z0-9_-]/gi, "_")}.json`;
}

async function readFSData(username) {
  if (!dirHandle) return null;
  try {
    const fh = await dirHandle.getFileHandle(fsFilename(username));
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

async function writeFSData(username, data) {
  if (!dirHandle) return;
  const fh = await dirHandle.getFileHandle(fsFilename(username), { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

// ===== FS AUTH (WebCrypto PBKDF2 verify against Google Sheets) =====
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
  if (!lines.length) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
}

async function fetchSheetUsers() {
  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) throw new Error("Không tải được danh sách tài khoản.");
  return parseCSV(await res.text());
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPBKDF2(password, storedHash) {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const [, iters, saltHex, digestHex] = parts;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: parseInt(iters) },
    key, 256
  );
  return bytesToHex(new Uint8Array(derived)) === digestHex;
}

async function fsLogin(username, password) {
  const users = await fetchSheetUsers();
  const user = users.find(u => (u.username || "").toLowerCase() === username.trim().toLowerCase());
  if (!user) throw new Error("Tên đăng nhập không tồn tại.");
  if ((user.is_active || "").toUpperCase() === "FALSE") throw new Error("Tài khoản đã bị khóa.");
  const role = String(user.role || "user").trim().toLowerCase() === "admin" ? "admin" : "user";
  setStatus(authStatus, "Đang xác thực (có thể mất vài giây)...");
  const hash = String(user.password_hash || "").trim();
  const temporaryPassword = String(user.password || "");
  let valid = false;
  if (hash) {
    valid = await verifyPBKDF2(password, hash);
  } else if (temporaryPassword) {
    valid = password === temporaryPassword;
  } else {
    throw new Error("Tài khoản chưa được cấp mật khẩu. Hãy điền cột password hoặc password_hash trên Google Sheet.");
  }
  if (!valid) throw new Error("Mật khẩu không đúng.");
  return { username: user.username, display_name: user.display_name || user.username, role, is_admin: role === "admin" };
}

// ===== FS BUSINESS LOGIC =====
function normalizeSizeCode(code) {
  const c = (code || "").trim().toUpperCase();
  if (c.length === 2 && c[0] === "0" && /[A-Z]/.test(c[1])) return c[1];
  return c;
}

function parseScanCode(raw) {
  const code = (raw || "").trim().toUpperCase();
  if (code.length < 15) throw new Error("Mã scan không hợp lệ. Cần ít nhất 15 ký tự theo quy tắc nhóm hàng.");
  const yearCode = code.substring(9, 12);
  const opCode = code.substring(12, 15);
  return {
    raw_code: code,
    color_code: code.substring(3, 7),
    size_code: normalizeSizeCode(code.substring(7, 9)),
    year_code: yearCode,
    operation_code: opCode,
    operation_key: `${parseInt(yearCode)}/${parseInt(opCode)}`,
  };
}

// ===== GOOGLE SHEETS LOOKUP (FS MODE) =====
const SHEET_ID = "1i8EWIOKZDQq9wL7I3uYXMrX-gCED6mJfU7nWbCsT8IA";
const COLOR_SHEET_GID = "209884490";
const TKCT_SHEET_GID = "2128017473";
let _sheetCache = null;
let _sheetCacheTime = 0;
const SHEET_CACHE_TTL = 3600000;

async function fetchSheetCSV(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được sheet ${gid}`);
  return await res.text();
}

function parseSheetCSV(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
  if (!lines.length) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
}

async function loadSheetCache() {
  const now = Date.now();
  if (_sheetCache && (now - _sheetCacheTime) < SHEET_CACHE_TTL) return _sheetCache;
  try {
    const [colorCsv, tkctCsv] = await Promise.all([
      fetchSheetCSV(COLOR_SHEET_GID),
      fetchSheetCSV(TKCT_SHEET_GID),
    ]);
    const colorRows = parseSheetCSV(colorCsv);
    const tkctRows = parseSheetCSV(tkctCsv);
    const colorMap = {};
    for (const row of colorRows) {
      const code = parseInt((row["Mã màu"] || "").trim(), 10);
      if (!isNaN(code)) {
        if (!colorMap[code]) colorMap[code] = [];
        colorMap[code].push({
          color_group: (row["NHÓM MÀU"] || "").trim(),
          color_tone: (row["TONE MÀU"] || "").trim(),
          material: (row["CHẤT LIỆU"] || "").trim(),
          form: (row["FORM"] || "").trim(),
          style: (row["KIỂU"] || "").trim(),
          attributes: (row["THUỘC TÍNH #"] || "").trim(),
          product_name: (row["TÊN HÀNG"] || "").trim(),
        });
      }
    }
    const productMap = {};
    for (const row of tkctRows) {
      const code = parseInt((row["Mã Màu"] || "").trim(), 10);
      if (!isNaN(code)) {
        if (!productMap[code]) productMap[code] = [];
        productMap[code].push({
          pattern: (row["Hoa văn"] || "").trim(),
          material: (row["Chất liệu"] || "").trim(),
        });
      }
    }
    _sheetCache = { colorMap, productMap };
    _sheetCacheTime = now;
    return _sheetCache;
  } catch {
    return _sheetCache || { colorMap: {}, productMap: {} };
  }
}

function getSheetCacheSync() {
  return _sheetCache;
}

function normText(text) {
  return (text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function bestMatch(entries, itemProductName) {
  if (!entries || !entries.length) return null;
  if (entries.length === 1) return entries[0];
  const normItem = normText(itemProductName);

  // 1. Exact product name
  for (const e of entries) {
    if (normText(e.product_name || "") === normItem) return e;
  }
  // 2. Substring match
  for (const e of entries) {
    const en = normText(e.product_name || "");
    if (en && (normItem.includes(en) || en.includes(normItem))) return e;
  }
  // 3. Best word overlap (>=2 words)
  const itemWords = new Set(normItem.split(" "));
  let best = null, bestScore = 0;
  for (const e of entries) {
    const ew = new Set(normText(e.product_name || "").split(" "));
    let score = 0;
    for (const w of itemWords) { if (ew.has(w)) score++; }
    if (score > bestScore) { bestScore = score; best = e; }
  }
  if (bestScore >= 2) return best;
  return entries[0];
}

function lookupColorFS(colorCode, productName, cache) {
  const code = parseInt(colorCode, 10);
  if (isNaN(code)) return {};
  if (cache.colorMap[code]) {
    const match = bestMatch(cache.colorMap[code], productName || "");
    if (match) return match;
  }
  if (cache.productMap[code]) {
    const match = bestMatch(cache.productMap[code], productName || "");
    if (match) {
      return {
        color_group: "",
        color_tone: match.pattern || "",
        material: match.material || "",
        form: "",
        style: "",
        attributes: "",
        product_name: "",
      };
    }
    return {
      color_group: "",
      color_tone: cache.productMap[code][0].pattern || "",
      material: cache.productMap[code][0].material || "",
      form: "",
      style: "",
      attributes: "",
      product_name: "",
    };
  }
  return {};
}

function enrichItemFS(item, cache) {
  const info = lookupColorFS(item.color || "", item.product_name || "", cache);
  item.color_name = info.color_tone || "";
  item.material = info.material || item.material || "";
  item.style = info.style || "";
  item.form = info.form || "";
  item.attributes = info.attributes || "";
  return item;
}

function buildItemSnapshot(item) {
  const difference = (item.scanned_qty || 0) - (item.stock_qty || 0);
  const remaining_qty = (item.stock_qty || 0) - (item.scanned_qty || 0);
  const status = difference > 0 ? "over" : difference < 0 ? "short" : "matched";
  return { ...item, difference, remaining_qty, status };
}

function buildDashboard(data) {
  const session = data.session || null;
  let items = (data.items || []).map(buildItemSnapshot);
  const cache = getSheetCacheSync();
  if (cache) {
    items = items.map(item => enrichItemFS(item, cache));
  }
  const total_stock = items.reduce((s, i) => s + (i.stock_qty || 0), 0);
  const total_scanned = items.reduce((s, i) => s + (i.scanned_qty || 0), 0);
  const matched_lines = items.filter(i => i.status === "matched").length;
  const over_lines = items.filter(i => i.status === "over").length;
  const short_lines = items.filter(i => i.status === "short").length;
  const all_events = [...(data.scan_events || [])].reverse().slice(0, 20);
  return {
    session,
    summary: { total_lines: items.length, total_stock, total_scanned, matched_lines, over_lines, short_lines, difference_total: total_scanned - total_stock },
    items,
    discrepancies: items.filter(i => i.difference !== 0 || i.reason_code),
    unmatched_scans: all_events.filter(s => s.status === "unmatched"),
    recent_scans: all_events,
  };
}

function fsScan(data, barcode, quantity = 1) {
  if (!data.session) throw new Error("Chưa có phiên kiểm hàng. Hãy import file tồn kho trước.");
  const parsed = parseScanCode(barcode);
  const items = data.items || [];
  const item = items.find(i =>
    i.color === parsed.color_code &&
    i.operation_key === parsed.operation_key &&
    (i.size === parsed.size_code || i.size === "SALE")
  );
  const now = new Date().toISOString().replace("T", " ").substring(0, 19);
  data.scan_events = data.scan_events || [];
  if (!item) {
    const note = `CẢNH BÁO: Mã scan không có trong file tồn đã import. Kiểm tra lại hàng hoặc mã vạch: màu ${parsed.color_code}, size ${parsed.size_code}, tác nghiệp ${parsed.operation_key}.`;
    data.scan_events.push({ scan_code: parsed.raw_code, color_code: parsed.color_code, size_code: parsed.size_code, operation_code: parsed.operation_code, operation_key: parsed.operation_key, quantity, status: "unmatched", note, created_at: now });
    return { matched: false, severity: "wrong_item", message: note, scan_parts: parsed };
  }
  item.scanned_qty = (item.scanned_qty || 0) + quantity;
  item.last_scanned_at = now;
  data.scan_events.push({ scan_code: parsed.raw_code, color_code: parsed.color_code, size_code: parsed.size_code, operation_code: parsed.operation_code, operation_key: parsed.operation_key, quantity, status: "matched", note: "", created_at: now });
  const snap = buildItemSnapshot(item);
  const colorDesc = snap.color_name || snap.color;
  const matDesc = snap.material || "";
  const extraInfo = (snap.color_name || matDesc) ? ` (${colorDesc}${matDesc ? " - " + matDesc : ""})` : "";
  return {
    matched: true,
    message: `Đã ghi nhận ${quantity} cho màu ${snap.color}${extraInfo} | size ${snap.size} | tác nghiệp ${snap.operation_key || snap.operation_label} | còn lại ${snap.remaining_qty}`,
    item: snap,
    scan_parts: parsed,
  };
}

// ===== SEARCH FILTERS =====
function filterBySearch(items, query) {
  if (!query) return items;
  const q = query.toLowerCase().trim();
  return items.filter(item =>
    (item.product_name || "").toLowerCase().includes(q) ||
    (item.operation_key || item.operation_label || "").toLowerCase().includes(q) ||
    (item.color || "").toLowerCase().includes(q) ||
    (item.size || "").toLowerCase().includes(q)
  );
}

function filterScansBySearch(scans, query) {
  if (!query) return scans;
  const q = query.toLowerCase().trim();
  return scans.filter(scan =>
    (scan.scan_code || "").toLowerCase().includes(q) ||
    (scan.color_code || "").toLowerCase().includes(q) ||
    (scan.size_code || "").toLowerCase().includes(q) ||
    (scan.operation_key || scan.operation_code || "").toLowerCase().includes(q) ||
    (scan.note || "").toLowerCase().includes(q)
  );
}

function updateSearchUI(query, total, filtered) {
  if (!query) {
    searchCount.classList.add("hidden");
    searchClear.classList.add("hidden");
  } else {
    searchClear.classList.remove("hidden");
    searchCount.classList.remove("hidden");
    searchCount.textContent = `Hiển thị ${filtered}/${total} dòng`;
  }
}

// ===== FS EXPORT =====
function reportRows(data) {
  const items = (data.items || []).map(buildItemSnapshot).filter(i => i.difference !== 0 || i.reason_code);
  const headers = ["Tên hàng", "Tác nghiệp", "Mã màu", "Tên màu", "Chất liệu", "Kiểu dáng", "Size", "Tồn ban đầu", "Đã scan", "Còn lại", "Dư thừa", "Trạng thái", "Lý do", "Ghi chú"];
  const rows = items.map(i => [
    i.product_name, i.operation_key || i.operation_label, i.color, i.color_name || "", i.material || "", i.style || "", i.size,
    i.stock_qty, i.scanned_qty, Math.max(0, i.remaining_qty || 0),
    Math.max(0, i.difference || 0),
    i.status === "matched" ? "Khớp" : i.status === "over" ? "Dư" : "Thiếu",
    i.reason_code || "", [i.source_note, i.reason_note].filter(Boolean).join(" | ")
  ]);
  return { headers, rows, items };
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function saveFSReport(data) {
  const filename = `bao-cao-chenh-lech-${new Date().toISOString().substring(0, 10)}.xlsx`;
  const payload = {
    session: data.session || {},
    summary: buildDashboard(data).summary || {},
    rows: reportRows(data).rows,
  };
  const response = await fetch(`${window.location.origin}/api/export/discrepancies-stateless.xlsx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorPayload = await readResponsePayload(response);
    throw new Error(errorPayload.detail || "Không xuất được báo cáo Excel.");
  }
  const blob = await response.blob();
  if (dirHandle) {
    try {
      const fh = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fh.createWritable();
      await writable.write(blob);
      await writable.close();
      return `Đã lưu "${filename}" vào thư mục dữ liệu.`;
    } catch {}
  }
  saveBlob(blob, filename);
  return `Đã tải xuống "${filename}".`;
}

// ===== UI VIEWS =====
function hideAllViews() {
  folderView.classList.add("hidden");
  authView.classList.add("hidden");
  appView.classList.add("hidden");
}

function showFolderPicker(message = "") {
  hideAllViews();
  folderView.classList.remove("hidden");
  if (folderCaption) {
    folderCaption.textContent = fsModeSupported()
      ? "Chọn thư mục trên máy tính để lưu dữ liệu kiểm hàng. Dữ liệu không lưu trên server."
      : "Trình duyệt của bạn không hỗ trợ chọn thư mục local. Hãy dùng Chrome hoặc Edge phiên bản mới.";
  }
  pickFolderBtn.disabled = !fsModeSupported();
  setStatus(folderStatus, message);
}

function showAuthMode(mode, message = "") {
  hideAllViews();
  authView.classList.remove("hidden");
  adminPanel.classList.add("hidden");
  loginForm.classList.toggle("hidden", mode !== "login");
  setupForm.classList.toggle("hidden", mode !== "setup");
  authTitle.textContent = mode === "setup" ? "Tạo admin đầu tiên" : "Đăng nhập";
  if (storageMode === "fs") {
    authCaption.textContent = "Đăng nhập để dùng app. Sau khi đăng nhập bạn sẽ kết nối thư mục lưu dữ liệu.";
  } else if (mode === "setup") {
    authCaption.textContent = storageMode === "cloud"
      ? "Tạo tài khoản admin đầu tiên trên bản web. Dữ liệu được lưu trên server cloud của app."
      : "Tạo tài khoản admin trên máy local đang kết nối. Dữ liệu được lưu trong thư mục local của máy này.";
  } else if (storageMode === "cloud") {
    authCaption.textContent = "Đăng nhập để mở dữ liệu kiểm hàng trên server cloud của app.";
  } else if (storageMode === "bridge") {
    authCaption.textContent = "Đang dùng local bridge trên máy này để mở dữ liệu kiểm hàng.";
  } else {
    authCaption.textContent = "Đăng nhập để mở dữ liệu kiểm hàng của tài khoản này.";
  }
  setStatus(authStatus, message);
  const firstInput = mode === "setup"
    ? setupForm.querySelector("input[name='password']")
    : loginForm.querySelector("input");
  if (firstInput) firstInput.focus();
}

async function showApp(user) {
  currentUser = user;
  hideAllViews();
  appView.classList.remove("hidden");
  userLabel.textContent = `${user.display_name || user.username} (${user.role})`;
  const canManageUsers = Boolean(user.is_admin && storageMode !== "fs");
  adminToggle.classList.toggle("hidden", !canManageUsers);
  adminToggle.setAttribute("aria-expanded", "false");
  adminPanel.classList.add("hidden");
  if (storageMode === "fs" && dirHandle) {
    folderLabel.textContent = `📁 ${dirHandle.name}`;
    folderLabel.classList.remove("hidden");
    changeFolderButton?.classList.remove("hidden");
  } else {
    folderLabel.classList.add("hidden");
    changeFolderButton?.classList.add("hidden");
  }
  if (storageMode === "fs") {
    const data = await readFSData(user.username);
    fsData = data || { session: null, items: [], scan_events: [] };
    loadSheetCache().catch(() => {});
    renderDashboard(buildDashboard(fsData));
  } else {
    await loadCurrentSession();
  }
  barcodeInput.focus();
}

// ===== FS FOLDER INIT AFTER LOGIN =====
async function initFSFolderAfterLogin() {
  // Try to restore saved handle
  const saved = await loadDirHandleFromIDB();
  if (saved) {
    try {
      const granted = await requestFolderPermission(saved);
      if (granted) {
        dirHandle = saved;
        return true;
      }
    } catch {}
  }
  return false; // needs picker
}

// ===== AUTH STATUS CHECK =====
async function checkAuthStatus() {
  await detectStorageMode();

  if (storageMode === "fs") {
    // Check if user is already logged in via localStorage
    const savedUser = localStorage.getItem(FS_USER_KEY);
    if (savedUser) {
      try {
        const user = JSON.parse(savedUser);
        const folderOk = await initFSFolderAfterLogin();
        if (folderOk) {
          await showApp(user);
          return;
        }
        // Logged in but no folder yet
        showFolderPicker("Đã đăng nhập. Hãy chọn thư mục để tải dữ liệu.");
        return;
      } catch {
        localStorage.removeItem(FS_USER_KEY);
      }
    }
    showAuthMode("login");
    return;
  }

  // cloud / bridge / local — all use the server API
  if (storageMode === "cloud" && !authToken) {
    showAuthMode("login");
    return;
  }

  try {
    const data = await apiJson("/api/auth/status");
    if (data.desktop_required) {
      showDesktopOnly(data.message);
      return;
    }
    if (data.setup_required) { showAuthMode("setup"); return; }
    if (data.setup_locked) {
      showAuthMode("login", data.message || "Máy này không được tạo admin mới.");
      return;
    }
    if (!data.authenticated) { showAuthMode("login"); return; }
    await showApp(data.user);
  } catch (error) {
    if (storageMode === "cloud") {
      showAuthMode("login", "Không kết nối được server. Hãy kiểm tra kết nối mạng hoặc tải lại trang.");
      return;
    }
    if (USE_LOCAL_BRIDGE && error instanceof TypeError) {
      showBridgeRequired();
      return;
    }
    showAuthMode("login", getErrorMessage(error));
  }
}

function showDesktopOnly(message) {
  hideAllViews();
  authView.classList.remove("hidden");
  loginForm.classList.add("hidden");
  setupForm.classList.add("hidden");
  authTitle.textContent = "Dùng bản máy tính";
  authCaption.textContent = message;
  setStatus(authStatus, "Không ghi dữ liệu trên Vercel.", "error");
}

function showBridgeRequired() {
  hideAllViews();
  authView.classList.remove("hidden");
  loginForm.classList.add("hidden");
  setupForm.classList.add("hidden");
  authTitle.textContent = "Kết nối dữ liệu local";
  authCaption.textContent = "Mở Stock Audit App.exe trên máy này để tạo/kết nối thư mục lưu dữ liệu local, sau đó tải lại trang Vercel.";
  setStatus(authStatus, "Chưa kết nối được local bridge tại 127.0.0.1:8020.", "error");
}

// ===== RENDER FUNCTIONS =====
function renderStats(summary) {
  if (!summary) { statsGrid.innerHTML = ""; return; }
  const progress = summary.total_stock
    ? Math.min(100, Math.round((summary.total_scanned / summary.total_stock) * 100))
    : 0;
  const cards = [
    { label: "Tổng dòng", value: summary.total_lines, helper: "Biến thể trong file" },
    { label: "Tồn kho", value: summary.total_stock, helper: "Số lượng cần kiểm" },
    { label: "Đã scan", value: summary.total_scanned, helper: `${progress}% tiến độ`, progress },
    { label: "Khớp đúng", value: summary.matched_lines, helper: "Dòng cân bằng", tone: "green" },
    { label: "Dòng dư", value: summary.over_lines, helper: "Cần kiểm lại", tone: "red" },
    { label: "Dòng thiếu", value: summary.short_lines, helper: "Cần xử lý", tone: "orange" }
  ];
  statsGrid.innerHTML = cards.map(card => `
    <article class="stat-card ${card.tone ? `tone-${card.tone}` : ""}">
      <p class="stat-label">${card.label}</p>
      <p class="stat-value">${numberFormat(card.value)}</p>
      ${card.progress !== undefined ? `<div class="stat-progress" aria-label="Tiến độ scan"><span style="width:${card.progress}%"></span></div>` : ""}
      <p class="stat-helper">${card.helper}</p>
    </article>
  `).join("");
}

function renderItems(items, filterQuery = "") {
  const filtered = filterQuery ? filterBySearch(items, filterQuery) : items;
  const sorted = [...filtered].sort((a, b) => {
    const rank = i => i.status === "matched" ? 0 : i.last_scanned_at ? 1 : 2;
    const rd = rank(a) - rank(b);
    if (rd !== 0) return rd;
    const ta = a.last_scanned_at || "", tb = b.last_scanned_at || "";
    if (ta !== tb) return tb.localeCompare(ta);
    return `${a.color}-${a.size}-${a.operation_key || a.operation_label}`.localeCompare(
      `${b.color}-${b.size}-${b.operation_key || b.operation_label}`
    );
  });

  updateSearchUI(filterQuery, items.length, filtered.length);

  if (!filtered.length) {
    itemsBody.innerHTML = filterQuery
      ? `<tr><td colspan="12" class="search-no-results">Không tìm thấy kết quả nào cho "${escapeHtml(filterQuery)}".</td></tr>`
      : `<tr><td colspan="12" class="empty-cell">Chưa có dữ liệu.</td></tr>`;
    itemsPagination.classList.add("hidden");
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PAGE_SIZE));
  if (itemsPage >= totalPages) itemsPage = totalPages - 1;
  const start = itemsPage * ITEMS_PAGE_SIZE;
  const pageItems = sorted.slice(start, start + ITEMS_PAGE_SIZE);
  const globalStart = start + 1;

  itemsBody.innerHTML = pageItems.map((item, idx) => `
    <tr class="row-${badgeClass(item.status)}">
      <td class="col-stt">${globalStart + idx}</td>
      <td>${item.product_name || "-"}</td>
      <td>${item.operation_key || item.operation_label || "-"}</td>
      <td><code>${item.color || "-"}</code></td>
      <td>${item.color_name || "<span class=text-muted>—</span>"}</td>
      <td>${item.material || "<span class=text-muted>—</span>"}</td>
      <td>${item.style || "<span class=text-muted>—</span>"}</td>
      <td>${item.size || "-"}</td>
      <td class="col-num">${numberFormat(item.stock_qty)}</td>
      <td class="col-num">${numberFormat(item.scanned_qty)}</td>
      <td class="col-num">${numberFormat(Math.max(item.remaining_qty || 0, 0))}</td>
      <td><span class="badge ${badgeClass(item.status)}">${statusLabel(item.status)}</span></td>
    </tr>
  `).join("");

  // Pagination UI
  itemsPageInfo.textContent = `${start + 1}–${start + pageItems.length} / ${filtered.length} dòng`;
  itemsFirst.disabled = itemsPage === 0;
  itemsPrev.disabled = itemsPage === 0;
  itemsNext.disabled = itemsPage >= totalPages - 1;
  itemsLast.disabled = itemsPage >= totalPages - 1;
  itemsPagination.classList.toggle("hidden", totalPages <= 1);
}

async function saveReason(itemId, reasonCode, reasonNote) {
  if (storageMode === "fs") {
    const item = (fsData.items || []).find(i => i.id === itemId);
    if (!item) throw new Error("Không tìm thấy dòng hàng");
    item.reason_code = reasonCode;
    item.reason_note = reasonNote;
    await writeFSData(currentUser.username, fsData);
    return buildDashboard(fsData);
  }
  const response = await apiFetch(`/api/items/${itemId}/reason`, {
    method: "PUT",
    body: JSON.stringify({ reason_code: reasonCode, reason_note: reasonNote })
  });
  const data = await readResponsePayload(response);
  if (!response.ok) throw new Error(data.detail || "Không lưu được lý do");
  return data;
}

function renderDiscrepancySummary(items) {
  const shortItems = items.filter(i => i.difference < 0);
  const overItems = items.filter(i => i.difference > 0);
  const shortQty = shortItems.reduce((t, i) => t + Math.abs(i.difference), 0);
  const overQty = overItems.reduce((t, i) => t + i.difference, 0);

  if (!excessAlert) {
    // Older embedded HTML may not have the excess alert container.
  } else if (discrepancyMode !== "compact" && overItems.length > 0) {
    excessAlert.classList.remove("hidden");
    excessAlert.innerHTML = `
      <strong>⚠ Phát hiện ${overItems.length} dòng dư với tổng ${numberFormat(overQty)} sản phẩm dư</strong>
      Đây là hàng scan vào nhưng không có trong tồn kho hoặc vượt quá số lượng tồn. Cần kiểm tra và xác nhận lý do cho từng dòng.
    `;
  } else {
    excessAlert.classList.add("hidden");
  }

  discrepancySummary.innerHTML = `
    <strong>Tóm tắt hiện tại</strong><br />
    Dòng thiếu: ${numberFormat(shortItems.length)} | Số lượng thiếu: ${numberFormat(shortQty)}<br />
    Dòng dư: ${numberFormat(overItems.length)} | Số lượng dư: ${numberFormat(overQty)}
  `;
}

function renderDetailedDiscrepancies(items) {
  if (!items.length) {
    discrepancyList.innerHTML = `<div class="note-box empty-state">Tất cả dòng hàng đang khớp.</div>`;
    return;
  }
  discrepancyList.innerHTML = "";
  items.forEach(item => {
    const wrapper = document.createElement("div");
    wrapper.className = item.difference > 0 ? "reason-card reason-over" : "reason-card";
    wrapper.innerHTML = `
      <div>
        <div class="reason-title">${item.product_name || "-"} | ${item.color || "-"} | ${item.size || "-"} | TN ${item.operation_key || item.operation_label || "-"}</div>
        <div class="reason-meta">
          Tồn đầu ${numberFormat(item.stock_qty)} | Đã scan ${numberFormat(item.scanned_qty)} | Còn lại ${numberFormat(Math.max(0, item.remaining_qty || 0))} | Dư ${numberFormat(Math.max(0, item.difference || 0))}
        </div>
      </div>
      <div class="reason-actions">
        <select>
          ${reasonOptions.map(o => `<option value="${o}" ${item.reason_code === o ? "selected" : ""}>${o}</option>`).join("")}
        </select>
        <textarea rows="2" placeholder="Ví dụ: màu 0643 size L thiếu 2...">${item.reason_note || ""}</textarea>
        <button class="btn btn-secondary btn-sm" type="button">Lưu lý do</button>
      </div>
    `;
    const select = wrapper.querySelector("select");
    const textarea = wrapper.querySelector("textarea");
    const button = wrapper.querySelector("button");
    button.addEventListener("click", async () => {
      try {
        const data = await saveReason(item.id, select.value, textarea.value);
        setStatus(scanStatus, "Đã cập nhật lý do chênh lệch.", "success");
        renderDashboard(data);
      } catch (error) {
        setStatus(scanStatus, getErrorMessage(error), "error");
      }
    });
    discrepancyList.appendChild(wrapper);
  });
}

function renderDiscrepancies(items) {
  renderDiscrepancySummary(items);
  if (discrepancyMode === "compact") {
    discrepancyCaption.textContent = "Đang scan. Hệ thống chỉ hiển thị tổng số lượng thiếu và tổng số lượng dư.";
    discrepancyList.innerHTML = "";
    return;
  }
  discrepancyCaption.textContent = discrepancyMode === "final"
    ? "Chi tiết chênh lệch đã được mở sau khi chốt phiên."
    : "Chi tiết chênh lệch của lần tạm chốt.";
  renderDetailedDiscrepancies(items);
}

function renderUnmatched(scans, filterQuery = "") {
  const filtered = filterQuery ? filterScansBySearch(scans, filterQuery) : scans;
  if (!filtered.length) {
    recentScans.className = "note-box empty-state";
    recentScans.textContent = filterQuery
      ? `Không tìm thấy mã scan nào cho "${filterQuery}".`
      : "Chưa có mã scan nào.";
    recentPagination.classList.add("hidden");
    return;
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / RECENT_SCAN_PAGE_SIZE));
  if (recentScanPage >= totalPages) recentScanPage = totalPages - 1;
  const start = recentScanPage * RECENT_SCAN_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + RECENT_SCAN_PAGE_SIZE);
  recentScans.className = "stack";
  recentScans.innerHTML = pageItems.map(scan => `
    <div class="note-box ${scan.status === "unmatched" ? "scan-note-unmatched" : ""}">
      <strong>${scan.scan_code}</strong> | Số lượng ${numberFormat(scan.quantity)} | ${scan.status === "matched" ? "Khớp" : "Không khớp"}<br />
      <span>Màu ${scan.color_code || "-"} | Size ${scan.size_code || "-"} | TN ${scan.operation_key || scan.operation_code || "-"}</span><br />
      <span>${scan.note || "Đã ghi nhận scan"} - ${scan.created_at}</span>
    </div>
  `).join("");
  recentPagination.classList.toggle("hidden", totalPages <= 1);
  recentPrev.disabled = recentScanPage === 0;
  recentNext.disabled = recentScanPage >= totalPages - 1;
}

function renderSession(session) {
  if (!session) {
    sessionMeta.textContent = "Chưa có dữ liệu.";
    return;
  }
  sessionMeta.innerHTML = `
    <span class="meta-pill">${escapeHtml(session.name)}</span>
    <span class="meta-pill">File: ${escapeHtml(session.source_filename)}</span>
    <span class="meta-pill">Import: ${escapeHtml(session.imported_at)}</span>
  `;
}

function renderDashboard(data) {
  lastDashboard = data;
  renderSession(data.session || null);
  renderStats(data.summary || null);
  renderItems(data.items || [], searchQuery);
  renderDiscrepancies(data.discrepancies || []);
  renderUnmatched(data.recent_scans || [], searchQuery);
}

function applyScanPatch(data) {
  if (!lastDashboard) return false;
  if (data.session) lastDashboard.session = data.session;
  if (data.summary) lastDashboard.summary = data.summary;

  if (data.matched && data.item) {
    const items = lastDashboard.items || [];
    const idx = items.findIndex(i => i.id === data.item.id);
    if (idx >= 0) items[idx] = data.item;
    else items.push(data.item);
    lastDashboard.items = items;
    lastDashboard.discrepancies = items.filter(i => (i.difference || 0) !== 0 || i.reason_code);
  }

  if (data.scan_event) {
    const recent = [data.scan_event, ...(lastDashboard.recent_scans || [])].slice(0, 20);
    lastDashboard.recent_scans = recent;
    if (data.scan_event.status === "unmatched") {
      const unmatched = [data.scan_event, ...(lastDashboard.unmatched_scans || [])].slice(0, 20);
      lastDashboard.unmatched_scans = unmatched;
    }
  }

  renderSession(lastDashboard.session || null);
  renderStats(lastDashboard.summary || null);
  renderItems(lastDashboard.items || [], searchQuery);
  renderDiscrepancies(lastDashboard.discrepancies || []);
  renderUnmatched(lastDashboard.recent_scans || [], searchQuery);
  return true;
}

async function loadCurrentSession() {
  const response = await apiFetch("/api/session");
  const data = await readResponsePayload(response);
  if (response.status === 401) {
    currentUser = null;
    showAuthMode("login", data.detail || "Phiên đăng nhập đã hết hạn.");
    return;
  }
  if (!response.ok) throw new Error(data.detail || "Không tải được phiên kiểm hàng");
  renderDashboard(data);
}

function renderUserAudit(user) {
  const audit = user.login_audit || {};
  const activeIps = Array.isArray(audit.active_ips) ? audit.active_ips : [];
  const activeIpText = activeIps.length ? activeIps.join(", ") : "Không có phiên đang mở";
  const activeIpCount = Number(audit.active_ip_count || activeIps.length || 0);
  const lastIp = user.last_login_ip || audit.last_session_ip || "Chưa ghi nhận";
  const lastDevice = shortenUserAgent(user.last_login_user_agent || audit.last_session_user_agent || "");
  const lastAt = user.last_login_at || audit.last_session_at || "Chưa ghi nhận";
  return `
    <div class="user-audit">
      <span class="user-audit-line">Đăng nhập gần nhất: ${escapeHtml(lastAt)}</span>
      <span class="user-audit-line">IP gần nhất: ${escapeHtml(lastIp)}</span>
      <span class="user-audit-line">Thiết bị: ${escapeHtml(lastDevice)}</span>
      <span class="user-audit-line ${activeIpCount > 1 ? "audit-warning" : ""}">
        IP đang dùng: ${escapeHtml(activeIpText)}
        ${activeIpCount > 1 ? `<strong class="risk-badge">Nghi cho mượn nick</strong>` : ""}
      </span>
    </div>
  `;
}

async function loadUsers() {
  if (!currentUser?.is_admin) return;
  if (storageMode === "fs") {
    if (accountSheetPath) {
      accountSheetPath.textContent = "Bản web đang đăng nhập bằng Google Sheet. Hãy quản lý tài khoản trực tiếp trên Google Sheet.";
    }
    userList.innerHTML = "";
    return;
  }
  try {
    const data = await apiJson("/api/users");
    if (accountSheetPath) {
      accountSheetPath.textContent = data.account_sheet_path ? `Sheet tài khoản: ${data.account_sheet_path}` : "";
    }
    userList.innerHTML = (data.users || []).map(user => {
      const audit = user.login_audit || {};
      const activeIpCount = Number(audit.active_ip_count || 0);
      return `
      <div class="user-row ${user.is_active ? "" : "user-row-inactive"} ${activeIpCount > 1 ? "user-risk" : ""}">
        <div class="user-main">
          <strong>${escapeHtml(user.display_name || user.username)}</strong><br />
          <span>${escapeHtml(user.username)} | ${escapeHtml(user.role)} | ${user.is_active ? "Đang dùng" : "Đã khóa"}</span><br />
          <span>DB riêng: ${escapeHtml(user.data_path || "")}</span>
          ${renderUserAudit(user)}
        </div>
        <div class="user-actions">
          <input class="user-password-input" type="password" data-password-user="${user.id}" autocomplete="new-password" placeholder="Mật khẩu mới" minlength="8" />
          <button class="btn btn-secondary btn-sm" type="button" data-action="reset-password" data-user-id="${user.id}">Reset mật khẩu</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="toggle-status" data-user-id="${user.id}" data-active="${user.is_active ? "true" : "false"}" ${user.id === currentUser?.id ? "disabled" : ""}>
            ${user.is_active ? "Khóa" : "Mở khóa"}
          </button>
          <button class="btn btn-danger btn-sm" type="button" data-action="delete-user" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}" ${user.id === currentUser?.id ? "disabled" : ""}>
            Xóa
          </button>
        </div>
      </div>
    `;
    }).join("");
  } catch (error) {
    setStatus(adminStatus, getErrorMessage(error), "error");
  }
}

// ===== EVENT HANDLERS =====
pickFolderBtn.addEventListener("click", async () => {
  if (!fsModeSupported()) return;
  try {
    setStatus(folderStatus, "Đang mở hộp chọn thư mục...");
    await pickFolder();
    const user = JSON.parse(localStorage.getItem(FS_USER_KEY) || "null");
    if (user) {
      await showApp(user);
    } else {
      showAuthMode("login", "Thư mục đã kết nối. Hãy đăng nhập.");
    }
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus(folderStatus, "Chưa chọn thư mục.", "error");
    } else {
      setStatus(folderStatus, getErrorMessage(error), "error");
    }
  }
});

changeFolderButton?.addEventListener("click", async () => {
  if (!fsModeSupported()) return;
  try {
    setStatus(scanStatus, "Đang mở hộp chọn thư mục...");
    await pickFolder();
    if (currentUser) await showApp(currentUser);
    setStatus(scanStatus, "Đã đổi thư mục dữ liệu.", "success");
  } catch (error) {
    setStatus(
      scanStatus,
      error.name === "AbortError" ? "Chưa chọn thư mục." : getErrorMessage(error),
      "error",
    );
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(authStatus, "Đang đăng nhập...");
  const formData = new FormData(loginForm);
  const username = String(formData.get("username") || "");
  const password = String(formData.get("password") || "");

  if (storageMode === "fs") {
    try {
      const user = await fsLogin(username, password);
      localStorage.setItem(FS_USER_KEY, JSON.stringify(user));
      loginForm.reset();
      // Try to restore saved folder
      const folderOk = await initFSFolderAfterLogin();
      if (folderOk) {
        await showApp(user);
      } else {
        showFolderPicker("Đăng nhập thành công. Hãy chọn thư mục để lưu dữ liệu.");
      }
    } catch (error) {
      setStatus(authStatus, error.message, "error");
    }
    return;
  }

  try {
    const data = await apiJson("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    setAuthToken(data.session_token);
    setStatus(authStatus, data.message, "success");
    loginForm.reset();
    await showApp(data.user);
  } catch (error) {
    setStatus(authStatus, getErrorMessage(error), "error");
  }
});

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(authStatus, "Đang tạo admin...");
  const formData = new FormData(setupForm);
  try {
    const data = await apiJson("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({
        username: String(formData.get("username") || ""),
        display_name: String(formData.get("display_name") || ""),
        password: String(formData.get("password") || "")
      })
    });
    setAuthToken(data.session_token);
    setStatus(authStatus, data.message, "success");
    setupForm.reset();
    await showApp(data.user);
  } catch (error) {
    setStatus(authStatus, getErrorMessage(error), "error");
  }
});

logoutButton.addEventListener("click", async () => {
  if (storageMode === "fs") {
    localStorage.removeItem(FS_USER_KEY);
    currentUser = null;
    fsData = null;
    dirHandle = null;
    showAuthMode("login", "Đã đăng xuất.");
    return;
  }
  try {
    await apiJson("/api/auth/logout", { method: "POST" });
  } catch {}
  setAuthToken("");
  currentUser = null;
  showAuthMode("login", "Đã đăng xuất.");
});

adminToggle.addEventListener("click", async () => {
  adminPanel.classList.toggle("hidden");
  const isOpen = !adminPanel.classList.contains("hidden");
  adminToggle.setAttribute("aria-expanded", String(isOpen));
  adminToggle.classList.toggle("btn-primary", isOpen);
  if (isOpen) await loadUsers();
});

createUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(adminStatus, "Đang tạo tài khoản...");
  const formData = new FormData(createUserForm);
  try {
    const data = await apiJson("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: String(formData.get("username") || ""),
        display_name: String(formData.get("display_name") || ""),
        password: String(formData.get("password") || "")
      })
    });
    createUserForm.reset();
    setStatus(adminStatus, data.message, "success");
    await loadUsers();
  } catch (error) {
    setStatus(adminStatus, getErrorMessage(error), "error");
  }
});

userList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const userId = Number(button.dataset.userId);
  const action = button.dataset.action;
  if (!userId) return;
  try {
    if (action === "reset-password") {
      const passwordInput = userList.querySelector(`[data-password-user="${userId}"]`);
      const password = String(passwordInput?.value || "");
      if (password.length < 8) {
        setStatus(adminStatus, "Mật khẩu mới cần ít nhất 8 ký tự.", "error");
        passwordInput?.focus();
        return;
      }
      const data = await apiJson(`/api/users/${userId}/password`, { method: "PUT", body: JSON.stringify({ password }) });
      passwordInput.value = "";
      setStatus(adminStatus, data.message, "success");
      await loadUsers();
      return;
    }
    if (action === "toggle-status") {
      const isActive = button.dataset.active === "true";
      if (!window.confirm(isActive ? "Khóa tài khoản này sẽ đăng xuất user đó ngay. Tiếp tục?" : "Mở khóa tài khoản này?")) return;
      const data = await apiJson(`/api/users/${userId}/status`, { method: "PATCH", body: JSON.stringify({ is_active: !isActive }) });
      setStatus(adminStatus, data.message, "success");
      await loadUsers();
      return;
    }
    if (action === "delete-user") {
      const username = button.dataset.username || "user này";
      if (!window.confirm(`Xóa ${username} sẽ xóa cả file DB riêng của user này. Tiếp tục?`)) return;
      const data = await apiJson(`/api/users/${userId}`, { method: "DELETE" });
      setStatus(adminStatus, data.message, "success");
      await loadUsers();
    }
  } catch (error) {
    setStatus(adminStatus, getErrorMessage(error), "error");
    await loadUsers();
  }
});

exportButton.addEventListener("click", async () => {
  if (storageMode === "fs") {
    if (!fsData) { setStatus(scanStatus, "Chưa có dữ liệu để xuất.", "error"); return; }
    try {
      const msg = await saveFSReport(fsData);
      setStatus(scanStatus, msg, "success");
    } catch (error) {
      setStatus(scanStatus, getErrorMessage(error), "error");
    }
    return;
  }
  try {
    const response = await apiFetch("/api/export/discrepancies.xlsx");
    if (!response.ok) {
      const data = await readResponsePayload(response);
      throw new Error(data.detail || "Không xuất được báo cáo");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    const filename = filenameMatch ? filenameMatch[1] : "bao-cao-chenh-lech.xlsx";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    setStatus(scanStatus, getErrorMessage(error), "error");
  }
});

importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(importStatus, "Đang import file tồn kho...");
  const formData = new FormData(importForm);
  const sessionName = String(formData.get("session_name") || "Phiên kiểm hàng mới").trim() || "Phiên kiểm hàng mới";

  if (storageMode === "fs") {
    const file = formData.get("file");
    if (!file) { setStatus(importStatus, "Chưa chọn file.", "error"); return; }
    try {
      const uploadForm = new FormData();
      uploadForm.append("file", file);
      const res = await fetch(`${API_BASE}/api/parse-inventory`, { method: "POST", body: uploadForm });
      const data = await readResponsePayload(res);
      if (!res.ok) throw new Error(data.detail || "Import thất bại");
      const now = new Date().toISOString().replace("T", " ").substring(0, 19);
      fsData = {
        session: { id: Date.now(), name: sessionName, source_filename: file.name, imported_at: now, is_active: true },
        items: (data.items || []).map((item, idx) => ({ ...item, id: idx + 1, scanned_qty: 0, reason_code: "", reason_note: "", last_scanned_at: "" })),
        scan_events: [],
      };
      await writeFSData(currentUser.username, fsData);
      discrepancyMode = "compact";
      recentScanPage = 0;
      itemsPage = 0;
      searchQuery = "";
      searchInput.value = "";
      searchClear.classList.add("hidden");
      searchCount.classList.add("hidden");
      setStatus(importStatus, `Đã import ${data.count} biến thể tồn kho.`, "success");
      renderDashboard(buildDashboard(fsData));
      barcodeInput.focus();
    } catch (error) {
      setStatus(importStatus, getErrorMessage(error), "error");
    }
    return;
  }

  try {
    const sessionNameEncoded = encodeURIComponent(sessionName);
    const response = await apiFetch(`/api/session/import?session_name=${sessionNameEncoded}`, { method: "POST", body: formData });
    const data = await readResponsePayload(response);
    if (!response.ok) throw new Error(data.detail || "Import thất bại");
    discrepancyMode = "compact";
    recentScanPage = 0;
    itemsPage = 0;
    searchQuery = "";
    searchInput.value = "";
    searchClear.classList.add("hidden");
    searchCount.classList.add("hidden");
    setStatus(importStatus, data.message, "success");
    renderDashboard(data);
    barcodeInput.focus();
  } catch (error) {
    setStatus(importStatus, getErrorMessage(error), "error");
  }
});

async function submitScan(barcode) {
  if (!barcode) {
    setStatus(scanStatus, "Nhập hoặc quét barcode trước.", "error");
    barcodeInput.focus();
    return false;
  }

  if (storageMode === "fs") {
    try {
      if (!fsData) throw new Error("Chưa load dữ liệu. Hãy kết nối thư mục và import file tồn kho.");
      const result = fsScan(fsData, barcode, 1);
      await writeFSData(currentUser.username, fsData);
      discrepancyMode = "compact";
      setStatus(scanStatus, result.message, result.matched ? "success" : "error");
      renderDashboard(buildDashboard(fsData));
      barcodeInput.value = "";
      barcodeInput.focus();
      return result.matched;
    } catch (error) {
      setStatus(scanStatus, error.message, "error");
      barcodeInput.focus();
      return false;
    }
  }

  setStatus(scanStatus, "Đang ghi nhận scan...");
  try {
    const response = await apiFetch("/api/scan?compact=1", { method: "POST", body: JSON.stringify({ barcode, quantity: 1 }) });
    const data = await readResponsePayload(response);
    if (!response.ok) throw new Error(data.detail || "Không ghi nhận được scan");
    discrepancyMode = "compact";
    setStatus(scanStatus, data.message, data.matched ? "success" : "error");
    if (data.compact && lastDashboard) {
      applyScanPatch(data);
    } else {
      renderDashboard(data);
    }
    barcodeInput.value = "";
    barcodeInput.focus();
    return true;
  } catch (error) {
    setStatus(scanStatus, getErrorMessage(error), "error");
    barcodeInput.focus();
    return false;
  }
}

scanForm.addEventListener("submit", async (event) => { event.preventDefault(); await submitScan(barcodeInput.value.trim()); });
barcodeInput.addEventListener("keydown", async (event) => { if (event.key !== "Enter") return; event.preventDefault(); await submitScan(barcodeInput.value.trim()); });

let searchDebounceTimer = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = searchInput.value.trim();
    recentScanPage = 0;
    itemsPage = 0;
    if (storageMode === "fs") {
      renderDashboard(buildDashboard(fsData));
    } else {
      loadCurrentSession();
    }
  }, 200);
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  recentScanPage = 0;
  itemsPage = 0;
  searchClear.classList.add("hidden");
  searchCount.classList.add("hidden");
  if (storageMode === "fs") {
    renderDashboard(buildDashboard(fsData));
  } else {
    loadCurrentSession();
  }
  barcodeInput.focus();
});

previewButton.addEventListener("click", async () => {
  discrepancyMode = "preview";
  if (storageMode === "fs") { renderDashboard(buildDashboard(fsData)); return; }
  await loadCurrentSession();
});

finalizeButton.addEventListener("click", async () => {
  discrepancyMode = "final";
  if (storageMode === "fs") { renderDashboard(buildDashboard(fsData)); return; }
  await loadCurrentSession();
});

recentPrev.addEventListener("click", async () => {
  if (recentScanPage > 0) { recentScanPage -= 1; }
  if (storageMode === "fs") { renderDashboard(buildDashboard(fsData)); return; }
  await loadCurrentSession();
});

recentNext.addEventListener("click", async () => {
  recentScanPage += 1;
  if (storageMode === "fs") { renderDashboard(buildDashboard(fsData)); return; }
  await loadCurrentSession();
});

function goItemsPage(page) {
  itemsPage = page;
  if (storageMode === "fs") { renderDashboard(buildDashboard(fsData)); return; }
  loadCurrentSession();
}

itemsFirst.addEventListener("click", () => goItemsPage(0));
itemsPrev.addEventListener("click", () => { if (itemsPage > 0) goItemsPage(itemsPage - 1); });
itemsNext.addEventListener("click", () => goItemsPage(itemsPage + 1));
itemsLast.addEventListener("click", () => goItemsPage(999999));

window.addEventListener("load", async () => { await checkAuthStatus(); });
