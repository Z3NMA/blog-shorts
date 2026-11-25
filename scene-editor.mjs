import {setReviewEnding} from './deepseek-planner.mjs';
import {verifyPrices} from './price-check.mjs';

export function sourceLines(photos, introduction, number) {
  return [...(photos[number - 2]?.lines ?? introduction), ...photos[number - 1].lines];
}

export function sceneSources(scene, photos, introduction) {
  const numbers = new Set([scene.photo, scene.evidencePhoto ?? scene.photo]);
  return [...numbers].flatMap(number => sourceLines(photos, introduction, number));
}

// The final experience and recommendation are edited separately and spoken together.
export function editScenes(original, edit, photos, introduction, {suggesting = false} = {}) {
  const plan = structuredClone(original);
  const last = plan.scenes.length - 1;
  if (edit.scenes !== undefined && (!Array.isArray(edit.scenes) || edit.scenes.length !== last + 1))
    throw Error('편집할 장면 수가 달라졌습니다. 대본을 다시 여세요.');
  for (const [index, scene] of plan.scenes.entries()) {
    const change = edit.scenes?.[index] ?? (index === 0 && edit.photo != null ? {photo:edit.photo} : {});
    const number = change.photo ?? scene.photo;
    if (!Number.isInteger(number) || !photos[number - 1] || (number !== scene.photo && photos[number - 1].isCover))
      throw Error(`${index + 1}번째 장면에 사용할 본문 사진을 선택하세요.`);
    if (scene.photo !== number) {
      scene.evidencePhoto ??= scene.photo;
      scene.photo = number;
      if (number === scene.evidencePhoto) delete scene.evidencePhoto;
    }
    if (change.text === undefined) continue;
    const body = index === last && plan.ending ? plan.ending.body : scene.text;
    const text = typeof change.text === 'string' ? change.text.trim() : '';
    if (!text || text.length > 180 || /[\x00-\x1f\x7f]/u.test(text))
      throw Error(`${index + 1}번째 장면 대사는 줄바꿈 없이 1~180자로 입력하세요.`);
    if (text !== body || number !== original.scenes[index].photo) {
      try { verifyPrices(text, sceneSources(scene, photos, introduction)); }
      catch (error) { throw Error(`${index + 1}번째 장면 · ${error.message}`); }
    }
    if (index === last && plan.ending) plan.ending.body = text;
    else scene.text = text;
  }
  if (!suggesting && (edit.ending !== undefined || (edit.scenes && plan.ending))) {
    const sources = plan.scenes.flatMap(scene => sceneSources(scene, photos, introduction));
    setReviewEnding(plan, edit.ending ?? plan.ending.text, sources);
  }
  return plan;
}
