import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const templates = JSON.parse(readFileSync(new URL('./layouts/styles.json', import.meta.url), 'utf8'));

function wrap(line,limit) {
  const words = line.split(/\s+/).flatMap(w=>w.match(new RegExp('.{1,'+limit+'}','gu')) || []);
  const rows = [];
  for (const w of words) {
    if (rows.length && (rows.at(-1)+' '+w).length <= limit) rows[rows.length-1]+=' '+w;
    else rows.push(w);
  }
  return rows;
}
function assText(s) {
  // Break literal ASS escape sequences without changing the visible dialogue.
  return s.replaceAll('\\', '\\\u2060').replace(/[{}]/g, char => '\\' + char);
}
function stamp(sec) {
  const cs=Math.floor(sec*100);
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
  const rows = wrap(text, 15);
  const chunks = [];
  for (let i = 0; i < rows.length; i += 2) chunks.push(rows.slice(i, i + 2));
  const total = chunks.reduce((n, chunk) => n + chunk.join('').length, 0);
  let elapsed = 0;
  chunks.forEach((chunk, i) => {
    const until = elapsed + speech * chunk.join('').length / total;
    add('Caption', elapsed, i === chunks.length - 1 ? end : until, chunk.map(assText).join('\\N'));
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
