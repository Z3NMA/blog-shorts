const clean = s => s.replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ')
  .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/[\u200b\ufeff]/g,'').replace(/\s+/g,' ').trim();

function attribute(tag, name) {
  const match = tag.match(new RegExp('\\s' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i'));
  return match ? clean(match[2]) : '';
}

function imageIdentity(src) {
  const url = URL.parse(src, 'https://m.blog.naver.com');
  if (!url) return src;
  if (/^(?:m?blogthumb(?:-phinf)?|blogfiles|postfiles)\.pstatic\.net$/i.test(url.hostname)) {
    // Naver serves the same upload with different hosts, sizes and filename encodings.
    const parent = url.pathname.slice(0, url.pathname.lastIndexOf('/'));
    const upload = /^MDA[\w-]*\.[\w.-]+$/i.test(parent.split('/').at(-1)) ? parent : url.pathname;
    return 'naver:' + upload;
  }
  return url.href;
}

function namedThumbnail(src) {
  const name = URL.parse(src, 'https://m.blog.naver.com')?.pathname.split('/').at(-1) || '';
  let filename = name;
  try { filename = decodeURIComponent(name); } catch { /* Some Naver filenames use legacy encoding. */ }
  return /썸네일|섬네일|(?:^|[\s_.-])thumbnail(?:$|[\s_.-])/i.test(filename);
}

export function parseBlogPost(html) {
  let title = '블로그 이야기';
  const covers = new Set();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attribute(tag, 'property') || attribute(tag, 'name')).toLowerCase();
    const value = attribute(tag, 'content');
    if (key === 'og:title' && value) title = value;
    if (/^(og:image(:url|:secure_url)?|twitter:image(:src)?)$/.test(key) && value) covers.add(imageIdentity(value));
  }
  const introduction = [];
  const photos = [];
  for (const [tag] of html.matchAll(/<img\b[^>]*se-image-resource[^>]*>|<p\b[^>]*se-text-paragraph[^>]*>[\s\S]*?<\/p>/gi)) {
    if (/^<img/i.test(tag)) {
      const src = attribute(tag, 'data-lazy-src') || attribute(tag, 'src');
      if (src) photos.push({src, lines:[]});
    } else {
      (photos.at(-1)?.lines ?? introduction).push(clean(tag));
    }
  }
  // A lone ordinary photo also serves as the link preview on many posts.
  const hasBodyPhoto = photos.some(p => !covers.has(imageIdentity(p.src)) && !namedThumbnail(p.src));
  for (const p of photos) p.isCover = namedThumbnail(p.src) || (hasBodyPhoto && covers.has(imageIdentity(p.src)));
  return {title, introduction, photos};
}
