import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const templates = JSON.parse(readFileSync(new URL('./layouts/styles.json', import.meta.url), 'utf8'));

const sentences = new Intl.Segmenter('ko', {granularity:'sentence'});
const graphemes = new Intl.Segmenter('ko', {granularity:'grapheme'});
const width = text => [...graphemes.segment(text)].length;
const captionLimit = 15;

function breakCost(left, right) {
  if (/[,，:;]$/u.test(left)) return -3;
  if (/^(?:보세요|봐요|보면|보니|주세요|싶|왔어요|있어요|없어요|거예요|수[가도는]?\b)/u.test(right) ||
      /^(?:금방|한|두|세|제|더|덜|꼭|잘|안|못|한번|가장)$/u.test(left)) return 20;
  if (/^(?:끼|번|분|개|수|때|것|곳)(?:[은는이가을를에도]|[.!?,]|$)/u.test(right)) return 16;
  if (/(?:다면|는데|라서|니까|지만|으면|고)$/u.test(left)) return -1;
  return 1;
}

function captionParts(chars, limit, fitLimit) {
  const parts = [];
  let start = 0;
  for (let end = 0; end <= chars.length; end++) {
    if (end < chars.length && chars[end] !== ' ') continue;
    const length = end - start;
    const anchor = parts.at(-1);
    const room = anchor ? fitLimit - (anchor.to-anchor.from) - 1 : 0;
    const cut = Math.min(Math.ceil(length/2),room);
    if (end === chars.length && length > fitLimit && cut > 0 && length-cut <= fitLimit) {
      // A long final code/name can still share a two-line cue with its label.
      parts.push({from:start,to:start+cut},{from:start+cut,to:end});
    } else {
      const count = length <= fitLimit ? 1 : Math.ceil(length / limit);
      for (let i = 0; i < count; i++) {
        parts.push({from:start + Math.ceil(i*length/count), to:start + Math.ceil((i+1)*length/count)});
      }
    }
    start = end+1;
  }
  const last = parts.at(-1), previous = parts.at(-2);
  // Protect the final pair in every language. Offsets preserve source spacing,
  // including when a long unspaced word has to span more than one row.
  if (previous && previous.to < last.from && last.to - previous.from <= fitLimit) {
    const third = parts.at(-3);
    if (third && last.to - third.from <= limit && /^수(?:도|가|는)?$/u.test(chars.slice(previous.from,previous.to).join(''))) {
      third.to = last.to;
      parts.splice(-2);
    } else {
      previous.to = last.to;
      parts.pop();
    }
  }
  return parts;
}

// Prefer layouts without a one-word cue before comparing rhythm and type size.
export function captionCards(text, limit = captionLimit) {
  const output = [];
  const fitLimit = limit + 8;
  for (const {segment} of sentences.segment(text.trim().replace(/\s+/gu,' '))) {
    const chars = [...graphemes.segment(segment.trim())].map(g => g.segment);
    const parts = captionParts(chars,limit,fitLimit);
    const n = parts.length;
    const rowWidth = (from,to) => parts[to-1].to - parts[from].from;
    const rowText = (from,to) => chars.slice(parts[from].from,parts[to-1].to).join('');
    const words = parts.map((_,i) => rowText(i,i+1));
    const best = new Array(n+1);
    best[n] = {singles:0,cost:0};
    const keepLastPair = n > 1 && !words[n-1].includes(' ');
    for (let start = n-1; start >= 0; start--) {
      for (let end = start+1; end <= n; end++) {
        if (keepLastPair && end === n-1) continue;
        const size = rowWidth(start,end);
        if (size > 2*fitLimit+1) break;
        let rows, layoutCost = Infinity;
        if (size <= fitLimit) {
          rows = [rowText(start,end)];
          layoutCost = 5 * Math.max(0,size-limit)**2;
        }
        if (size > limit) for (let cut = start+1; cut < end; cut++) {
          const wa = rowWidth(start,cut), wb = rowWidth(cut,end);
          const longest = Math.max(wa,wb);
          if (longest > fitLimit) continue;
          const cost = 5 * Math.max(0,longest-limit)**2 + Math.abs(wa-wb)*0.6 + breakCost(words[cut-1],words[cut]);
          if (cost < layoutCost) {
            rows = [rowText(start,cut),rowText(cut,end)];
            layoutCost = cost;
          }
        }
        if (!rows) continue;
        const boundary = end < n ? 3*breakCost(words[end-1],words[end]) : 0;
        const cost = 24 + layoutCost + boundary + Math.max(0,12-size)**2 + best[end].cost;
        const singleWordCue = !rowText(start,end).includes(' ');
        const singles = best[end].singles + Number(singleWordCue);
        const current = best[start];
        if (!current || singles < current.singles || (singles === current.singles && cost < current.cost))
          best[start] = {singles,cost,rows,end};
      }
    }
    for (let i = 0; i < n; i = best[i].end) output.push(best[i].rows);
  }
  return output;
}
function assText(s) {
  // Break literal ASS escape sequences without changing the visible dialogue.
  return s.replaceAll('\\', '\\\u2060').replace(/[{}]/g, char => '\\' + char);
}
function stamp(sec) {
  const cs=Math.floor(sec*100 + 1e-8);
  return '0:'+String(Math.floor(cs/6000)).padStart(2,'0')+':'+String(Math.floor(cs/100)%60).padStart(2,'0')+'.'+String(cs%100).padStart(2,'0');
}

function color(rgb) {
  return '&H00' + rgb.slice(4,6) + rgb.slice(2,4) + rgb.slice(0,2);
}

function styleRow([name, s]) {
  const spacing = name === 'Caption' ? 0 : -1;
  return 'Style: ' + [name, s.font, s.size, color(s.color), color(s.color), color(s.edge), color(s.edge),
    s.bold ? -1 : 0, 0, 0, 0, 100, 100, spacing, 0, s.box ? 3 : 1, s.outline, 0,
    s.align, 18, 18, 0, 1].join(',');
}

export function sceneAss(template, title, text, speech, end) {
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 720', 'PlayResY: 1280', 'WrapStyle: 2',
    '[V4+ Styles]', 'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    ...Object.entries(template.text).map(styleRow), '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text'
  ];
  function add(name, start, stop, content, size) {
    const s = template.text[name];
    const tags = '\\pos(' + s.x + ',' + s.y + ')' + (size ? '\\fs' + size : '');
    lines.push('Dialogue: 0,' + stamp(start) + ',' + stamp(stop) + ',' + name + ',,0,0,0,,{' + tags + '}' + content);
  }
  const [subject, ...rest] = title.split('\n').filter(Boolean);
  for (const [name, line] of [['Subject', subject], ['Hook', rest.join(' ')]]) {
    if (!line) continue;
    const units = Array.from(line).reduce((n, ch) => n + (ch === ' ' ? .35 : 1), 0);
    const width = template.text[name].align === 4 ? 630 : 660;
    add(name, 0, end, assText(line), Math.min(template.text[name].size, Math.floor(width / Math.max(1, units))));
  }
  const chunks = captionCards(text);
  const total = chunks.reduce((n, chunk) => n + chunk.join('').length, 0);
  let elapsed = 0;
  chunks.forEach((chunk, i) => {
    const until = elapsed + speech * chunk.join('').length / total;
    const longest = Math.max(...chunk.map(width));
    const size = longest > captionLimit ? Math.floor(template.text.Caption.size * captionLimit / longest) : undefined;
    add('Caption', elapsed, i === chunks.length - 1 ? end : until, chunk.map(assText).join('\\N'), size);
    elapsed = until;
  });
  return lines.join('\n') + '\n';
}

// Both outputs composite the same 720x1280 frame and burn the same ASS script.
export function sceneArgs(template, photo, audio = null) {
  const preview = !audio;
  const overlay = fileURLToPath(new URL('./layouts/' + template.id + '.png', import.meta.url));
  const base = '[0:v]scale=720:' + template.photoHeight + ':force_original_aspect_ratio=increase,crop=720:' +
    template.photoHeight + ',setsar=1,pad=720:1280:0:' + template.photoTop + '[p];[p][1:v]overlay=0:0,format=yuv420p';
  const time = preview ? '' : ',loop=loop=-1:size=1:start=0,settb=1/30,setpts=N,fps=30';
  const size = preview ? ',scale=360:640' : '';
  return ['-loglevel','error','-y','-i',photo,'-i',overlay,...(audio ? ['-i',audio] : []),'-filter_complex',base + time + ',ass=scene.ass:fontsdir=fonts' + size + '[v]','-map','[v]'];
}
