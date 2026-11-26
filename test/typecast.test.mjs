import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {getTypecastVoice, listTypecastVoices, typecastClip} from '../engine/typecast-voice.mjs';
import {popularVoices} from '../desktop/ui/popular-voices.js';

const voice = {id:'tc_a', model:'ssfm-v31'};
function wav() {
  const bytes = Buffer.alloc(48);
  bytes.write('RIFF'); bytes.writeUInt32LE(40,4); bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(32000,24); bytes.writeUInt32LE(64000,28);
  bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34);
  bytes.write('data',36); bytes.writeUInt32LE(4,40);
  return bytes;
}
async function cache(t) {
  const dir = await mkdtemp(path.join(tmpdir(),'shorts-typecast-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  return dir;
}

test('인기 목록의 24개 고유 캐릭터 중 선택한 ID 하나만 조회한다', async () => {
  assert.equal(popularVoices.length,24);
  assert.equal(new Set(popularVoices.map(v => v.id)).size,24);
  assert.ok(popularVoices.every(v => /^tc_[0-9a-f]{24}$/.test(v.id) && v.name && v.english));
  const {id, name} = popularVoices[0];
  const detail = await getTypecastVoice(id, {apiKey:' key ', request:async (url,init) => {
    assert.equal(url,'https://api.typecast.ai/v3/voices/' + id);
    assert.equal(init.headers['X-API-KEY'],'key');
    return Response.json({voice_id:id,voice_name:{kor:name},models:[{version:'ssfm-v30'},{version:'ssfm-v31'}],
      preview_url:'https://static2.typecast.ai/demo.mp3'});
  }});
  assert.deepEqual(detail,{id,name,models:['ssfm-v31','ssfm-v30'],previewUrl:'https://static2.typecast.ai/demo.mp3'});
});

test('갤러리의 모든 캐릭터에 해당 ID의 로컬 WebP 썸네일과 용도가 있다', async () => {
  for (const voice of popularVoices) {
    assert.ok(voice.usage);
    const file = new URL('../desktop/ui/voice-portraits/' + voice.id.slice(3) + '.webp', import.meta.url);
    const data = await readFile(file);
    assert.equal(data.toString('ascii',0,4),'RIFF',voice.name);
    assert.equal(data.toString('ascii',8,12),'WEBP',voice.name);
    assert.equal(data.readUInt32LE(4) + 8,data.length,voice.name);
  }
});

test('전체 목록은 인증 요청 한 번으로 사용 가능한 목소리와 샘플 정보를 읽는다', async () => {
  let requests = 0;
  const original = {voice_id:'tc_first', voice_name:{kor:'가람',eng:'Garam'}, use_cases:['Narration'],
    models:[{version:'ssfm-v30'},{version:'ssfm-v31'}], preview_url:'https://static2.typecast.ai/garam.mp3'};
  const custom = {voice_id:'uc_other', voice_name:{eng:'Other'}, models:[{version:'ssfm-v21'}],
    voice_type:'custom', preview_url:'http://example.test/unsafe.mp3'};
  const catalog = await listTypecastVoices({apiKey:' test-key ', request:async (url,init) => {
    requests++;
    assert.equal(url,'https://api.typecast.ai/v3/voices');
    assert.equal(init.method ?? 'GET','GET');
    assert.equal(init.headers['X-API-KEY'],'test-key');
    return Response.json([custom, original, original, {...original,voice_id:'invalid'},
      {...original,voice_id:'tc_unsupported',models:[{version:'unsupported'}]}, null]);
  }});
  assert.equal(requests,1);
  assert.deepEqual(catalog, [
    {id:'tc_first',name:'가람',english:'Garam',usage:'Narration',models:['ssfm-v31','ssfm-v30'],previewUrl:original.preview_url},
    {id:'uc_other',name:'Other',english:'Other',usage:'내 보이스',models:['ssfm-v21'],previewUrl:''},
  ]);
});

test('빈 목록과 인증 오류, 잘못된 목록 응답을 구분한다', async () => {
  const list = response => listTypecastVoices({apiKey:'key',request:async () => response});
  assert.deepEqual(await list(Response.json([])),[]);
  await assert.rejects(list(Response.json({})),/목록을 읽을 수 없습니다/);
  await assert.rejects(list(new Response('',{status:401})),/API 키/);
});

test('예전 선택도 개별 조회하며 삭제되거나 호환되지 않는 캐릭터는 다른 캐릭터로 바꾸지 않는다',async () => {
  const lookup = body => getTypecastVoice('uc_old',{apiKey:'key',request:async url => {
    assert.ok(url.endsWith('/uc_old'));
    return body === null ? new Response('',{status:404}) : Response.json(body);
  }});
  const row = {voice_id:'uc_old',voice_name:{kor:'내 보이스'},models:[{version:'ssfm-v21'}]};
  assert.equal((await lookup(row)).previewUrl,'');
  await assert.rejects(lookup({...row,voice_id:'tc_other'}),/선택한 목소리/);
  await assert.rejects(lookup({...row,models:[]}),/지원되는 모델/);
  await assert.rejects(lookup(null),/404/);
});

test('미리 듣기와 제작은 문장·목소리·모델이 같은 완전한 WAV만 재사용한다', async t => {
  const dir = await cache(t), calls = [];
  const options = {apiKey:'key',request:async (url,init) => {
    assert.equal(url,'https://api.typecast.ai/v1/text-to-speech');
    assert.equal(init.method,'POST');
    calls.push(JSON.parse(init.body));
    return new Response(wav());
  }};
  const first = await typecastClip(' 한 문장 ',voice,dir,options);
  assert.equal(await typecastClip('한 문장',voice,dir,{apiKey:''}),first);
  for (const [text,selection] of [['수정',voice],['한 문장',{...voice,id:'tc_b'}],['한 문장',{...voice,model:'ssfm-v30'}]]) {
    assert.notEqual(await typecastClip(text,selection,dir,options),first);
  }
  await writeFile(first,wav().subarray(0,45));
  await typecastClip('한 문장',voice,dir,options);
  assert.deepEqual(await readFile(first),wav());
  assert.equal(calls.length,5);
  assert.deepEqual(calls[0],{voice_id:'tc_a',model:'ssfm-v31',language:'kor',text:'한 문장',output:{audio_format:'wav'}});
});

test('인증 실패·크레딧 부족·손상 응답은 재생 가능한 파일을 남기지 않는다',async t => {
  const dir = await cache(t);
  for (const [status,body,pattern] of [[401,'invalid',/API 키/],[402,'empty',/크레딧/],[200,wav().subarray(0,45),/WAV/]]) {
    await assert.rejects(typecastClip('대사',voice,dir,{apiKey:'test', request:async () => new Response(body,{status})}),pattern);
  }
  await assert.rejects(typecastClip('가'.repeat(2001),voice,dir),/2,000/);
  assert.deepEqual(await readdir(dir),[]);
});
