const $ = (id) => document.getElementById(id);
const { invoke } = window.__TAURI__.core;
const preferences = ["voice", "folder", "ffmpeg", "python", "model"];
let ready = false;

function status(kind, title, body) {
  $("result").hidden = false;
  $("result").dataset.kind = kind;
  $("state").textContent = title;
  $("message").textContent = body;
  $("open").hidden = kind !== "done";
}

function updateVoice() {
  const local = $("voice").value === "supertonic";
  $("local-options").hidden = !local;
  $("model").required = local;
  $("python").required = local;
  if (local && !$("model").value) $("settings").open = true;
  $("voice-hint").textContent = ["supertonic", "windows"].includes($("voice").value)
    ? "대본에만 API 요금이 적용됩니다."
    : "대본과 음성에 API 요금이 적용됩니다.";
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
    outputFolder: $("folder").value.trim(), ffmpeg: $("ffmpeg").value.trim(),
    python: $("python").value.trim(), model: $("model").value.trim()
  };
  try {
    localStorage.setItem("settings", JSON.stringify(Object.fromEntries(preferences.map(p => [p, $(p).value]))));
  } catch { /* Rendering also works with browser storage disabled. */ }
  $("inputs").disabled = true;
  status("working", "숏츠 제작 중", "블로그 사진과 본문을 읽고 DeepSeek로 대본을 구성합니다.");
  try {
    const file = await invoke("generate", { job });
    status("done", "영상이 완성됐습니다", file);
  } catch (error) {
    status("error", "영상을 완성하지 못했습니다", String(error));
  } finally {
    $("inputs").disabled = false;
  }
});

$("open").addEventListener("click", async () => {
  try { await invoke("open_output"); }
  catch (error) { $("message").textContent += "\n" + String(error); }
});

try {
  const defaults = await invoke("defaults");
  $("key").required = !defaults.hasKey;
  if (defaults.hasKey) {
    $("key").placeholder = "환경 변수 키 사용 중";
    $("key-hint").textContent = "비워 두면 설정된 환경 변수 키를 사용합니다.";
  }
  $("folder").value = defaults.outputFolder;
  for (const id of ["ffmpeg","python","model"]) $(id).value = defaults[id];
  let saved;
  try { saved = JSON.parse(localStorage.getItem("settings") || "{}"); } catch { saved = {}; }
  for (const id of preferences) {
    if (typeof saved?.[id] === "string" && saved[id]) $(id).value = saved[id];
  }
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
