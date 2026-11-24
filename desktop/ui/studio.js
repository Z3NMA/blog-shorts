const $ = (id) => document.getElementById(id);
const { invoke } = window.__TAURI__.core;
const preferences = ["voice", "folder", "ffmpeg", "python", "model", "geminiVoice", "geminiStyle"];
let ready = false;
let defaults;

function status(kind, title, body) {
  $("result").hidden = false;
  $("result").dataset.kind = kind;
  $("state").textContent = title;
  $("message").textContent = body;
  $("open").hidden = kind !== "done";
}

function updateVoice() {
  const voice = $("voice").value;
  const gemini = voice === "gemini";
  const local = voice === "supertonic";
  $("gemini-options").hidden = !gemini;
  $("gemini-credentials").hidden = !gemini;
  $("geminiKey").required = gemini && !defaults.hasGeminiKey;
  $("local-options").hidden = !local;
  $("model").required = local;
  $("python").required = local;
  $("voice-hint").textContent = gemini ? "음성은 Google API 사용량에 따라 과금됩니다."
    : local || voice === "windows" ? "로컬 음성 · 대본에만 API 요금이 적용됩니다."
    : "대본과 음성에 DeepSeek API 요금이 적용됩니다.";
}

$("voice").addEventListener("change", updateVoice);
$("form").addEventListener("invalid", (event) => {
  if ($("settings").contains(event.target)) $("settings").open = true;
}, true);

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ready || $("inputs").disabled) return;
  let url;
  try { url = new URL($("url").value.trim()); } catch { return; }
  if (url.protocol !== "https:" || !["blog.naver.com", "m.blog.naver.com"].includes(url.hostname)
    || !/^\/[\w-]+\/\d+\/?$/.test(url.pathname)) {
    status("error", "글 주소를 확인하세요", "블로그 홈 대신 아이디와 글 번호가 있는 네이버 글 주소를 입력하세요.");
    $("url").focus();
    return;
  }
  const job = {
    url: url.href, apiKey: $("key").value.trim(), voice: $("voice").value,
    geminiKey: $("voice").value === "gemini" ? $("geminiKey").value.trim() : "",
    geminiVoice: $("geminiVoice").value, geminiStyle: $("geminiStyle").value,
    outputFolder: $("folder").value.trim(), ffmpeg: $("ffmpeg").value.trim(),
    python: $("python").value.trim(), model: $("model").value.trim()
  };
  try {
    localStorage.setItem("settings", JSON.stringify(Object.fromEntries(preferences.filter(p => $(p).value !== defaults[p]).map(p => [p, $(p).value]))));
  } catch { /* Rendering also works with browser storage disabled. */ }
  $("inputs").disabled = true;
  status("working", "숏츠 제작 중", "블로그 사진과 본문을 읽고 DeepSeek로 대본을 구성합니다.");
  $("create").textContent = "제작 중…";
  $("result").scrollIntoView({block: "nearest"});
  try {
    const file = await invoke("generate", { job });
    status("done", "영상이 완성됐습니다", file);
  } catch (error) {
    status("error", "영상을 완성하지 못했습니다", String(error));
  } finally {
    $("create").textContent = "숏츠 만들기";
    $("result").scrollIntoView({block: "nearest"});
    $("inputs").disabled = false;
  }
});

$("open").addEventListener("click", async () => {
  try { await invoke("open_output"); }
  catch (error) { $("message").textContent += "\n" + String(error); }
});

try {
  defaults = await invoke("defaults");
  if (defaults.hasGeminiKey) $("geminiKey").placeholder = "환경 변수 키 사용 중";
  $("key").required = !defaults.hasKey;
  if (defaults.hasKey) {
    $("key").placeholder = "환경 변수 키 사용 중";
    $("key-hint").textContent = "설정된 환경 변수 키로 대본을 만듭니다.";
  }
  $("folder").value = defaults.outputFolder;
  for (const id of ["ffmpeg","python","model"]) $(id).value = defaults[id];
  let saved;
  try { saved = JSON.parse(localStorage.getItem("settings") || "{}"); } catch { saved = {}; }
  for (const id of preferences) {
    if (typeof saved?.[id] === "string" && saved[id]) $(id).value = saved[id];
  }
  if (!$("geminiVoice").value) $("geminiVoice").value = "Kore";
  if (!$("geminiStyle").value) $("geminiStyle").value = "natural";
  if (!$("voice").value) $("voice").value = "stella";
  updateVoice();
  await window.__TAURI__.event.listen("render-progress", ({payload}) => {
    if ($("inputs").disabled) $("message").textContent = payload;
  });
  ready = true;
  $("inputs").disabled = false;
} catch (error) {
  status("error", "앱을 시작할 수 없습니다", String(error));
}
