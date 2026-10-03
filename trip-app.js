
var _hmt = _hmt || [];
(function() {
  var hm = document.createElement("script");
  hm.src = "https://hm.baidu.com/hm.js?d227d7adabbefe411e9e9d4620a61216";
  var s = document.getElementsByTagName("script")[0];
  s.parentNode.insertBefore(hm, s);
})();


function trackEvent(category, action, label, value) {
  try {
    if (window._hmt) {
      window._hmt.push(['_trackEvent', category, action, label || '', value || 0]);
    }
  } catch (e) {
    console.warn('百度统计事件发送失败', e);
  }
}

const FEEDBACK_API_URL = 'https://deepseek-proxy-three.vercel.app/api/feedback';
const ITINERARY_STORAGE_KEY = "currentItinerary";
const ITINERARY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MY_TRIPS_STORAGE_KEY = "myTrips";
const MY_TRIPS_MAX_COUNT = 20;
const IS_TRIP_PAGE = /\/trip\.html$/.test(location.pathname);

function fillExampleInput() {
  const input = document.getElementById("inputText");
  input.value = "东京到大阪6天自由行，3人，8月1日到6日，以美食和文化体验为主，预算每人1万元人民币，行程轻松不要太赶";
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  trackEvent('input_assist', 'click', 'fill_example');
}

function addQuickRequirement(requirement) {
  const input = document.getElementById("inputText");
  const current = input.value.trim();
  if (current.includes(requirement)) {
    input.focus();
    return;
  }
  input.value = current ? current.replace(/[，,。\s]+$/, "") + "，" + requirement : requirement;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  trackEvent('input_assist', 'click', requirement);
}


// Every untrusted HTML boundary uses the same policy, including legacy localStorage data.
function sanitizeItineraryHTML(html) {
  if (!window.DOMPurify || !window.DOMPurify.isSupported) {
    throw new Error("安全组件加载失败，请刷新页面后重试。");
  }
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'id', 'name']
  });
}

function createItineraryId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return `itinerary-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`localStorage 数据损坏，已忽略：${key}`, e);
    localStorage.removeItem(key);
    return fallback;
  }
}

function getStoredItinerary() {
  const itinerary = safeReadJson(ITINERARY_STORAGE_KEY, null);
  if (!itinerary || typeof itinerary !== "object") return null;
  if (!itinerary.id || typeof itinerary.id !== "string") return null;
  if (!itinerary.outputHTML || typeof itinerary.outputHTML !== "string") return null;
  if (typeof itinerary.createdAt !== "number" || typeof itinerary.expiresAt !== "number") return null;
  if (Date.now() > itinerary.expiresAt) {
    localStorage.removeItem(ITINERARY_STORAGE_KEY);
    return null;
  }
  itinerary.outputHTML = sanitizeItineraryHTML(itinerary.outputHTML);
  return itinerary;
}

function saveItinerary(userInput, outputHTML, id = createItineraryId()) {
  outputHTML = sanitizeItineraryHTML(outputHTML);
  const now = Date.now();
  const itinerary = { id, input: userInput, outputHTML, createdAt: now, expiresAt: now + ITINERARY_TTL_MS };
  localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify(itinerary));
  localStorage.setItem("hasGenerated", "true");
  return itinerary;
}

function getMyTrips() {
  const trips = safeReadJson(MY_TRIPS_STORAGE_KEY, []);
  if (!Array.isArray(trips)) return [];
  return trips.filter(trip => trip && typeof trip === "object" && typeof trip.id === "string" && typeof trip.title === "string" && typeof trip.input === "string" && typeof trip.outputHTML === "string" && typeof trip.createdAt === "number").sort((a, b) => b.createdAt - a.createdAt).slice(0, MY_TRIPS_MAX_COUNT).map(trip => ({ ...trip, outputHTML: sanitizeItineraryHTML(trip.outputHTML) }));
}

function saveTripToHistory(userInput, outputHTML) {
  outputHTML = sanitizeItineraryHTML(outputHTML);
  const trip = { id: createItineraryId(), title: userInput.slice(0, 30), input: userInput, outputHTML, createdAt: Date.now() };
  const trips = [trip, ...getMyTrips()].slice(0, MY_TRIPS_MAX_COUNT);
  localStorage.setItem(MY_TRIPS_STORAGE_KEY, JSON.stringify(trips));
  renderMyTrips();
  return trip;
}

function renderMyTrips() {
  const container = document.getElementById("myTripsContent");
  if (!container) return;
  const trips = getMyTrips();
  container.innerHTML = "";
  if (trips.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "my-trips-empty";
    emptyMessage.innerHTML = "还没有保存的旅行计划<br>生成一次旅行后，它会自动保存在这里。";
    container.appendChild(emptyMessage);
    return;
  }
  const list = document.createElement("ul");
  list.className = "my-trips-list";
  trips.forEach(trip => {
    const item = document.createElement("li");
    const row = document.createElement("div");
    const button = document.createElement("button");
    const title = document.createElement("strong");
    const date = document.createElement("span");
    row.className = "my-trip-row";
    button.type = "button";
    button.className = "my-trip-item";
    button.addEventListener("click", () => loadTripFromHistory(trip.id));
    title.textContent = trip.title;
    date.className = "my-trip-date";
    date.textContent = new Date(trip.createdAt).toLocaleString("zh-CN");
    button.append(title, date);
    row.appendChild(button);
    item.appendChild(row);
    list.appendChild(item);
  });
  container.appendChild(list);
}

function loadTripFromHistory(id) {
  const trip = getMyTrips().find(item => item.id === id);
  if (!trip) return;
  saveItinerary(trip.input, trip.outputHTML, trip.id);
  location.assign('/trip.html?id=' + encodeURIComponent(trip.id));
}

function toggleFeedback() {
  const panel = document.getElementById('feedbackPanel');
  const button = document.getElementById('feedbackToggle');
  const isOpening = panel.hidden;
  panel.hidden = !panel.hidden;
  button.setAttribute('aria-expanded', String(isOpening));
  if (isOpening) {
    trackEvent('feedback', 'open', 'inline_feedback');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function submitFeedback(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('feedbackMessage');
  const submitButton = document.getElementById('feedbackSubmit');
  const helpfulness = new FormData(form).get('helpfulness');
  const payment = new FormData(form).get('payment');
  const features = Array.from(form.querySelectorAll('input[name="features"]:checked'), input => input.value);
  const comment = form.elements.comment.value.trim();

  if (!helpfulness || !payment) {
    message.textContent = '请先选择“是否有帮助”和“付费意愿”。';
    message.className = 'feedback-message error';
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = '送信中…';
  message.textContent = '';
  message.className = 'feedback-message';

  try {
    const response = await fetch(FEEDBACK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpfulness, payment, features, comment })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    form.reset();
    message.textContent = '✓ 感谢您的反馈！';
    message.className = 'feedback-message success';
    trackEvent('feedback', 'submit', `${helpfulness}_${payment}`);
  } catch (error) {
    console.warn('反馈送信失败', error);
    message.textContent = '送信失败，请稍后再试。';
    message.className = 'feedback-message error';
    trackEvent('feedback', 'error', 'submit_failed');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = '确认送信';
  }
}


function trackPDFDownload() {
  trackEvent('button', 'click', 'download_pdf_success');
  let downloadCount = parseInt(localStorage.getItem("downloadCount") || "0");
  downloadCount++;
  localStorage.setItem("downloadCount", downloadCount);
}


async function generate() {
  const rawUserInput = document.getElementById('inputText').value;
  const userInput = rawUserInput.trim();
  if (!userInput) {
    alert("⚠️ 请输入您的旅行需求");
    trackEvent('generate', 'error', 'empty_input');
    return;
  }
  trackEvent('button', 'click', 'generate_trip');
  const output = document.getElementById('generationStatus');
  const generateBtn = document.getElementById('generateBtn');
  closePaymentPanel();
  output.innerHTML = `<div class="loading-road">⏳ AI正在生成行程，请稍等 <span id="roadTrack">🚗</span></div>`;
  localStorage.removeItem(ITINERARY_STORAGE_KEY);
  localStorage.setItem("hasGenerated", "false");
  generateBtn.disabled = true;
  generateBtn.innerText = "📝️ AI生成中…";
  const prompt = `
你是一位专业的中文旅行规划师，请根据下方旅行需求，制定详细的旅行行程：
${userInput}

请提供每天的活动安排，并以 Markdown 表格输出。
表格必须为5列：日期、行程内容、交通工具、餐食推荐、住宿推荐（不要增加或减少列）。
要求内容结构清晰、语言自然，加入适量 emoji 图标增强可读性。

每天行程的住宿安排推荐具体的真实存在的酒店或旅馆名称。
请列出预算汇总和预约清单。
`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90 * 1000);
  try {
    const response = await fetch("https://deepseek-proxy-three.vercel.app/api/deepseek", {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: "deepseek-flash", messages: [{ role: "system", content: "你是一位专业中文旅行规划师" }, { role: "user", content: prompt }], temperature: 0.7, userInput: rawUserInput })
    });
    if (!response.ok) {
      const error = new Error('AI request failed');
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    if (data && data.choices && data.choices.length > 0) {
      const parsedHtml = sanitizeItineraryHTML(marked.parse(data.choices[0].message.content.trim()));
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = parsedHtml;
      const children = Array.from(tempDiv.children);
      let outputHTML = '';
      let currentBlock = [];
      children.forEach(child => {
        if (/^day\s*\d+/i.test(child.textContent.trim().toLowerCase()) || /第\s*\d+\s*天/.test(child.textContent.trim())) {
          if (currentBlock.length > 0) {
            outputHTML += '<div class="day-plan">' + currentBlock.map(el => el.outerHTML).join('') + '</div>';
            currentBlock = [];
          }
        }
        currentBlock.push(child);
      });
      if (currentBlock.length > 0) outputHTML += '<div class="day-plan">' + currentBlock.map(el => el.outerHTML).join('') + '</div>';
      outputHTML = sanitizeItineraryHTML(outputHTML);
      output.textContent = "✓ 行程已生成，正在打开结果页…";
      const trip = saveTripToHistory(userInput, outputHTML);
      saveItinerary(userInput, outputHTML, trip.id);
      trackEvent('generate', 'success', 'trip_plan');
      location.assign('/trip.html?id=' + encodeURIComponent(trip.id));
    } else {
      output.innerText = "⚠️ AI未返回有效内容，请稍后再试。";
      trackEvent('generate', 'error', 'empty_ai_response');
    }
  } catch (error) {
    console.error("Error:", error);
    output.innerText = error.name === 'AbortError'
      ? "⏳ 生成超时（约90秒），请稍后重试。"
      : error.status === 429
        ? "⏳ 请求过于频繁，请稍等一分钟后重试。"
        : error.status >= 500
          ? "⚠️ AI服务暂时不可用，请稍后重试。"
          : "❌ AI请求出错，请检查网络连接或刷新页面后重试。";
    trackEvent('generate', 'error', 'request_failed');
    localStorage.setItem("hasGenerated", "false");
  } finally {
    clearTimeout(timeoutId);
    generateBtn.disabled = false;
    generateBtn.innerText = "📖️ AI生成旅游行程";
  }
}


function doDownloadPDF() {
  const itinerary = getStoredItinerary();
  if (!itinerary) return;
  trackEvent('payment', 'click', 'pdf_download_intent');
  const panel = document.getElementById('paymentPanel');
  panel.hidden = false;
  document.getElementById('paidDownloadButton').focus();
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  trackEvent('payment', 'view', 'qr_9_90');
}
function closePaymentPanel() {
  const panel = document.getElementById('paymentPanel');
  if (panel) panel.hidden = true;
}
function confirmPaymentAndDownload() {
  const itinerary = getStoredItinerary();
  if (!itinerary || document.getElementById('paymentPanel').hidden) return;
  trackEvent('payment', 'self_declared', 'qr_9_90');
  closePaymentPanel();
  return exportPDF();
}
function exportPDF() {
  const element = document.getElementById("pdf-content");
  const pdfButton = document.getElementById("pdfButton");
  const originalButtonHTML = pdfButton.innerHTML;
  pdfButton.disabled = true;
  pdfButton.innerHTML = "⏳ 正在生成PDF...";
  element.classList.add("pdf-export");
  let userInput = (getStoredItinerary()?.input || "").trim();
  let filename = "旅行行程.pdf";
  if (userInput) {
    const cleaned = userInput.replace(/[^\u4e00-\u9fa5\w]+/g, "").slice(0, 30);
    if (cleaned) filename = `${cleaned}.pdf`;
  }
  const opt = { margin: 0.5, filename, image: { type: "jpeg", quality: 0.98 }, html2canvas: { scale: 2, useCORS: true, scrollY: 0 }, jsPDF: { unit: "in", format: "a4", orientation: "portrait" } };
  return html2pdf().set(opt).from(element).save().then(() => { trackPDFDownload(); }).catch((error) => {
    console.error("PDF下载失败", error);
    alert("❌ PDF下载失败，请稍后重试，或检查浏览器是否阻止了下载。");
    trackEvent('download', 'error', 'pdf_export_failed');
  }).finally(() => {
    element.classList.remove("pdf-export");
    pdfButton.disabled = false;
    pdfButton.innerHTML = originalButtonHTML;
  });
}


window.onload = function () {
  try {
    // Discard obsolete payment data from earlier versions; it is not proof of payment.
    ['paidItineraries', 'pdfPaid', 'lastOrderNumber'].forEach(key => localStorage.removeItem(key));
    if (IS_TRIP_PAGE) {
      const id = new URLSearchParams(location.search).get('id');
      const trip = id ? getMyTrips().find(item => item.id === id) : getStoredItinerary();
      if (trip) {
        saveItinerary(trip.input, trip.outputHTML, trip.id);
        document.getElementById('output').innerHTML = sanitizeItineraryHTML(trip.outputHTML);
        document.getElementById('tripTitle').textContent = trip.input || '我的旅行行程';
        updateButtonDisplayAfterGenerate();
      } else {
        document.getElementById('output').textContent = '这份行程未找到或已过期，请返回首页重新生成。';
        document.querySelector('.feedback-wrap').hidden = true;
      }
    } else {
      const itinerary = getStoredItinerary();
      if (itinerary) document.getElementById('inputText').value = itinerary.input || '';
    }
    renderMyTrips();
  } catch (e) {
    console.warn("恢复行程状态失败", e);
    localStorage.removeItem(ITINERARY_STORAGE_KEY);
    localStorage.setItem("hasGenerated", "false");
    if (IS_TRIP_PAGE) document.getElementById("output").textContent = "行程读取失败，请返回首页重试。";
    renderMyTrips();
  }
}


function updateButtonDisplayAfterGenerate() {
  const hasGenerated = Boolean(getStoredItinerary()) || localStorage.getItem("hasGenerated") === "true";
  const pdfButton = document.getElementById("pdfButton");
  if (hasGenerated) pdfButton.style.display = "inline-block";
  else pdfButton.style.display = "none";
}


let carPosition = 0;
let direction = 1;
let maxSteps = 8;
let intervalId;
function updateRoadTrack() {
  const car = document.getElementById("roadTrack");
  if (!car) return;
  carPosition += direction;
  if (carPosition >= maxSteps || carPosition <= 0) direction *= -1;
  car.innerHTML = ".".repeat(carPosition) + "🚗";
}
const observer = new MutationObserver(() => {
  const car = document.getElementById("roadTrack");
  if (car && !intervalId) intervalId = setInterval(updateRoadTrack, 200);
});
observer.observe(document.body, { childList: true, subtree: true });
