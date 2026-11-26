import {setTimeout as delay} from 'node:timers/promises';

export async function retryRateLimit(send, label, sleep = delay) {
  const retries = 3;
  for (let attempt = 0; ; attempt++) {
    const response = await send();
    if (response.status !== 429) return response;
    const body = await response.json().catch(() => ({}));
    const error = body?.error ?? body;
    const details = Array.isArray(error?.details) ? error.details : [];
    const description = JSON.stringify(error) || '';
    if (/per[ _-]?day|daily|\bRPD\b|perdayperproject/i.test(description)) {
      throw Error(label + ' (HTTP 429). 일일 할당량에 도달했습니다. 한도가 갱신된 후 다시 시도하세요.');
    }
    if (/insufficient_quota|insufficient[_ ]balance|billing[_ ]disabled|limit:\s*0\b/i.test(description) ||
        details.some(d => d.violations?.some(v => String(v.quotaValue) === '0'))) {
      throw Error(label + ' (HTTP 429). 프로젝트의 할당량 또는 결제 설정을 확인하세요.');
    }
    const header = response.headers.get('Retry-After')?.trim();
    const fromHeader = !header ? 0 : /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
    const hint = details.find(d => /^\d+(?:\.\d+)?s$/.test(d?.retryDelay))?.retryDelay;
    const fromBody = hint ? parseFloat(hint) * 1000 : 0;
    const suggested = Math.max(0, fromHeader || 0, fromBody);
    if (suggested > 120000 || attempt === retries) {
      const advice = suggested ? `${Math.ceil(suggested / 1000)}초 후 다시 시도하세요.` : '잠시 후 다시 시도하세요.';
      throw Error(`${label} (HTTP 429). 요청 한도가 계속 적용되고 있습니다. ${advice}`);
    }
    const wait = suggested || (10000 * 2 ** attempt + Math.floor(Math.random() * 1000));
    console.log(`${label} · 요청 한도 대기 · ${Math.ceil(wait / 1000)}초 후 자동 재시도 (${attempt + 1}/${retries})`);
    await sleep(wait);
  }
}
