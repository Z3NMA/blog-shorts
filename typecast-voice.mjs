import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {retryRateLimit} from './rate-limit.mjs';

const models = ['ssfm-v31', 'ssfm-v30', 'ssfm-v21'];
const validId = id => typeof id === 'string' && /^(tc|uc)_[a-zA-Z0-9_-]+$/.test(id);

async function callApi(endpoint, init, label, {apiKey = process.env.TYPECAST_API_KEY, request = fetch, sleep} = {}) {
  if (!apiKey?.trim()) throw Error('설정에 타입캐스트 API 키를 입력하세요.');
  const response = await retryRateLimit(async () => {
    try {
      return await request('https://api.typecast.ai' + endpoint, {
        ...init, headers:{'X-API-KEY':apiKey.trim(), ...init.headers},
        redirect:'error', signal:AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw Error(label + ' 요청이 완료되지 않았습니다. 인터넷 연결을 확인하고 다시 시도하세요.', {cause:error});
    }
  }, label, sleep);
  if (!response.ok) {
    const advice = {
      400:'목소리와 대사를 확인하세요.', 401:'타입캐스트 API 키를 확인하세요.',
      402:'타입캐스트 API 크레딧을 확인하세요.', 403:'이 키의 사용 권한과 크레딧을 확인하세요.',
      404:'이 목소리를 현재 API에서 찾을 수 없습니다. 다른 목소리를 선택하세요.', 422:'선택한 목소리의 모델과 대사를 확인하세요.',
    };
    throw Error(label + ' 요청 실패 (HTTP ' + response.status + '). ' + (advice[response.status] || '잠시 후 다시 시도하세요.'));
  }
  return response;
}

function voiceDetails(row) {
  const id = row?.voice_id;
  if (!validId(id) || !Array.isArray(row.models)) return null;
  const supported = models.filter(m => row.models.some(item => item?.version === m));
  if (!supported.length) return null;
  return {id, name:row.voice_name?.kor || row.voice_name?.eng || id, models:supported,
    previewUrl:/^https:\/\//i.test(row.preview_url || '') ? row.preview_url : ''};
}

export async function listTypecastVoices(options) {
  const response = await callApi('/v3/voices', {}, '타입캐스트 전체 목소리 목록', options);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error('타입캐스트 목소리 목록을 읽을 수 없습니다. 다시 시도하세요.');
  const voices = new Map();
  for (const row of rows) {
    const voice = voiceDetails(row);
    if (voice) voices.set(voice.id, {...voice, english:row.voice_name?.eng || '',
      usage:row.voice_type === 'custom' ? '내 보이스' : row.use_cases?.[0] || ''});
  }
  return [...voices.values()].sort((a,b) => a.name.localeCompare(b.name, 'ko'));
}

export async function getTypecastVoice(id, options) {
  if (!validId(id)) throw Error('조회할 목소리를 다시 선택하세요.');
  const response = await callApi('/v3/voices/' + id, {}, '타입캐스트 목소리 조회', options);
  const row = await response.json();
  if (row?.voice_id !== id) throw Error('선택한 목소리 정보를 확인할 수 없습니다.');
  const voice = voiceDetails(row);
  if (!voice) throw Error('이 목소리에 지원되는 모델이 없습니다. 다른 목소리를 선택하세요.');
  return voice;
}

export function typecastSelection(id, model) {
  if (!validId(id) || !models.includes(model)) throw Error('타입캐스트 목소리 목록에서 사용할 목소리를 선택하세요.');
  return {id, model};
}

function validWav(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii',0,4) !== 'RIFF' ||
      bytes.toString('ascii',8,12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 > bytes.length) return false;
  let hasFormat = false;
  for (let i = 12; i + 8 <= bytes.length;) {
    const chunk = bytes.toString('ascii',i,i+4), length = bytes.readUInt32LE(i+4);
    if (i + 8 + length > bytes.length) return false;
    if (chunk === 'fmt ' && length >= 16) hasFormat = true;
    if (chunk === 'data' && length > 0 && hasFormat) return true;
    i += 8 + length + length % 2;
  }
  return false;
}

export async function typecastClip(text, voice, directory, options) {
  const {id, model} = typecastSelection(voice.id, voice.model);
  text = text.trim();
  if (!text || [...text].length > 2000) throw Error('타입캐스트에 보낼 대사를 1~2,000자로 입력하세요.');
  const body = JSON.stringify({voice_id:id, model, language:'kor', text, output:{audio_format:'wav'}});
  const file = path.join(directory, createHash('sha256').update(body).digest('hex') + '.wav');
  try {
    if (validWav(await readFile(file))) return file;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(directory, {recursive:true});
  const response = await callApi('/v1/text-to-speech', {method:'POST', headers:{'Content-Type':'application/json'}, body},
    '타입캐스트 음성', options);
  const wav = Buffer.from(await response.arrayBuffer());
  if (!validWav(wav)) throw Error('타입캐스트에서 완전한 WAV 음성을 받지 못했습니다. 다시 시도하세요.');
  const partial = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(partial, wav);
    await rename(partial, file);
  } finally { await rm(partial, {force:true}); }
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'list') console.log(JSON.stringify(await listTypecastVoices()));
    else if (process.argv[2] === 'detail') console.log(JSON.stringify(await getTypecastVoice(process.env.TYPECAST_VOICE_ID)));
    else if (process.argv[2] === 'preview') {
      const file = await typecastClip(process.env.TYPECAST_TEXT || '',
        {id:process.env.TYPECAST_VOICE_ID, model:process.env.TYPECAST_MODEL}, process.env.SHORTS_TYPECAST_CACHE);
      console.log(path.basename(file));
    } else throw Error('목소리 조회 또는 미리 듣기를 선택하세요.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
