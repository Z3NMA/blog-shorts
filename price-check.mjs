// Currency is checked against a complete source statement so the item, unit,
// date and discount conditions travel with the amount.
const price = /(?:\d[\d.,]*(?:\s*[십백천만억]\s*[\d.,]*)*\s*원|[일이삼사오육칠팔구십백천만억]*[십백천만억][일이삼사오육칠팔구십백천만억]*\s*원|[₩￦$€¥]\s*\d|\d[\d,.]*\s*(?:달러|엔|유로|퍼센트\s*할인|%\s*할인)|무료|공짜|반값)/u;
const sentences = new Intl.Segmenter('ko', {granularity:'sentence'});

function clauses(line) {
  return [...sentences.segment(line)].map(part => part.segment.trim()).filter(Boolean);
}
function key(text) {
  return text.normalize('NFKC').replace(/(?<=\d),(?=\d{3}(?:\D|$))/gu,'')
    .replace(/[.!?。！？~]+$/u,'').replace(/(원)(?:이에요|이었어요|입니다|이랍니다|이에용)$/u,'$1')
    .replace(/\s+/gu,'').trim();
}
export class PriceMismatch extends Error {}

export function verifyPrices(text, sourceLines) {
  if (!price.test(text.normalize('NFKC'))) return;
  const originals = new Set(sourceLines.flatMap(clauses).map(key));
  for (const line of clauses(text.replaceAll('\n',' '))) {
    if (!price.test(line.normalize('NFKC'))) continue;
    const normalized = key(line);
    if (!originals.has(normalized) || !/[가-힣a-z]{2}/iu.test(normalized.replace(price,''))) {
      throw new PriceMismatch('가격의 대상·금액·조건을 원문에서 함께 확인할 수 없습니다. 가격을 빼거나 원문의 가격 문장을 그대로 사용하세요.');
    }
  }
}
