/**
 * 够用就好的 WebDAV 客户端：HEAD / GET / PUT / DELETE / MKCOL / PROPFIND，Basic 认证，全部走 fetch。
 * 纯函数式的一层，不碰界面和库；fetch 可以注入，单测用假服务器。
 *
 * 浏览器里直连 WebDAV 受跨域限制：服务器得返回 Access-Control-Allow-Origin，并允许 PUT / PROPFIND / MKCOL
 * 和 Authorization / If-Match / If-None-Match / Depth 这些头，还要把 ETag 暴露出来（Access-Control-Expose-Headers）。
 * 自建的 Nextcloud（装 WebAppPassword 之类放开跨域）、rclone serve webdav、dufs 都能配；坚果云不放跨域，网页里连不上。
 */

export interface WebDavConfig {
  /** 目录地址，比如 https://dav.example.com/remote.php/dav/files/me/ */
  url: string;
  username: string;
  password: string;
}

export interface Stat {
  etag: string;
  /** 服务器给的最后修改时间；可能没有 */
  lastModified?: string;
  size?: number;
}

export interface Entry {
  /** 相对目录的名字（文件名），不含斜杠 */
  name: string;
  lastModified?: string;
  size?: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class DavError extends Error {
  constructor(message: string, public kind: 'auth' | 'network' | 'conflict' | 'notfound' | 'http', public status = 0) {
    super(message);
    this.name = 'DavError';
  }
}

/** 把中文也能编进 Basic 认证 */
function basic(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return 'Basic ' + btoa(s);
}

/** 目录地址规范化：补上末尾斜杠 */
export function normalizeUrl(url: string): string {
  const u = url.trim();
  if (!u) return '';
  return u.endsWith('/') ? u : u + '/';
}

export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

export class WebDav {
  private base: string;
  private auth: string;
  constructor(cfg: WebDavConfig, private fetchFn: FetchLike = (i, init) => fetch(i, init)) {
    this.base = normalizeUrl(cfg.url);
    this.auth = basic(cfg.username, cfg.password);
  }

  /** 拼完整地址；path 里的每一段都编码，目录以斜杠结尾 */
  href(path: string): string {
    const parts = path.split('/').filter(Boolean).map(encodeURIComponent);
    return this.base + parts.join('/') + (path.endsWith('/') && parts.length ? '/' : '');
  }

  private async send(method: string, path: string, init: { body?: string; headers?: Record<string, string> } = {}): Promise<Response> {
    const headers: Record<string, string> = { Authorization: this.auth, ...(init.headers ?? {}) };
    let res: Response;
    try {
      res = await this.fetchFn(this.href(path), { method, headers, body: init.body, credentials: 'omit' });
    } catch (e) {
      throw new DavError('连不上服务器：地址不对、网络不通，或者服务器没放开跨域（CORS）', 'network');
    }
    if (res.status === 401 || res.status === 403) throw new DavError('账号或密码不对，或者没有这个目录的权限', 'auth', res.status);
    if (res.status === 412) throw new DavError('服务器上的文件刚被别的设备改过', 'conflict', 412);
    return res;
  }

  /** 文件在不在、ETag 是什么；不存在返回 null */
  async stat(path: string): Promise<Stat | null> {
    const res = await this.send('HEAD', path);
    if (res.status === 404) return null;
    if (!res.ok) throw new DavError(`服务器返回 ${res.status}`, 'http', res.status);
    const len = res.headers.get('content-length');
    return { etag: res.headers.get('etag') ?? '', lastModified: res.headers.get('last-modified') ?? undefined, size: len ? Number(len) : undefined };
  }

  async get(path: string): Promise<{ text: string; etag: string } | null> {
    const res = await this.send('GET', path, { headers: { 'Cache-Control': 'no-cache' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new DavError(`下载失败：服务器返回 ${res.status}`, 'http', res.status);
    return { text: await res.text(), etag: res.headers.get('etag') ?? '' };
  }

  /**
   * 写文件。ifMatch 给上次的 ETag：别的设备先写了就 412；ifNoneMatch 为 true 表示"只在不存在时创建"。
   * 返回新 ETag；服务器 PUT 不回 ETag 的话再 HEAD 一次拿。
   */
  async put(path: string, body: string, opts: { ifMatch?: string; ifNoneMatch?: boolean; contentType?: string } = {}): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': opts.contentType ?? 'application/json' };
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
    if (opts.ifNoneMatch) headers['If-None-Match'] = '*';
    const res = await this.send('PUT', path, { body, headers });
    if (!res.ok) throw new DavError(`上传失败：服务器返回 ${res.status}`, 'http', res.status);
    const etag = res.headers.get('etag');
    if (etag) return etag;
    const st = await this.stat(path);
    return st?.etag ?? '';
  }

  async delete(path: string): Promise<void> {
    const res = await this.send('DELETE', path);
    if (res.status === 404) return;
    if (!res.ok) throw new DavError(`删除失败：服务器返回 ${res.status}`, 'http', res.status);
  }

  /** 建目录；已经有了也算成功 */
  async mkcol(path: string): Promise<void> {
    const res = await this.send('MKCOL', path.endsWith('/') ? path : path + '/');
    if (res.ok || res.status === 405 || res.status === 301 || res.status === 409) return;
    throw new DavError(`建目录失败：服务器返回 ${res.status}`, 'http', res.status);
  }

  /** 列目录里的文件（不含子目录）；服务器不让 PROPFIND 就抛错，调用方自己决定要不要吞 */
  async list(dir: string): Promise<Entry[]> {
    const body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>';
    const res = await this.send('PROPFIND', dir.endsWith('/') ? dir : dir + '/', { body, headers: { Depth: '1', 'Content-Type': 'application/xml' } });
    if (res.status === 404) return [];
    if (!res.ok && res.status !== 207) throw new DavError(`列目录失败：服务器返回 ${res.status}`, 'http', res.status);
    return parsePropfind(await res.text(), this.href(dir.endsWith('/') ? dir : dir + '/'));
  }
}

/** 从 PROPFIND 的 207 回包里挑出文件；不依赖 DOMParser，正则够用（命名空间前缀不定，所以匹配 <任意前缀:href>） */
export function parsePropfind(xml: string, dirHref: string): Entry[] {
  const out: Entry[] = [];
  const dirPath = pathOf(dirHref);
  const responses = xml.split(/<[\w-]*:?response[\s>]/i).slice(1);
  for (const chunk of responses) {
    const href = pick(chunk, 'href');
    if (!href) continue;
    const isDir = /<[\w-]*:?collection\s*\/?>/i.test(chunk);
    if (isDir) continue;
    let p: string;
    try { p = decodeURIComponent(href.startsWith('http') ? new URL(href).pathname : href); } catch { p = href; }
    if (!p.startsWith(dirPath)) continue;
    const rest = p.slice(dirPath.length);
    if (!rest || rest.includes('/')) continue;
    const len = pick(chunk, 'getcontentlength');
    out.push({ name: rest, lastModified: pick(chunk, 'getlastmodified') || undefined, size: len ? Number(len) : undefined });
  }
  return out;
}

function pick(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<[\\w-]*:?${tag}[^>]*>([^<]*)<`, 'i'));
  return m ? decodeXml((m[1] ?? '').trim()) : '';
}
function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function pathOf(href: string): string {
  try { return decodeURIComponent(new URL(href).pathname); } catch { return href; }
}
