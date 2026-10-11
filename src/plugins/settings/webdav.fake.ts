/**
 * 内存里的假 WebDAV 服务器，只给测试用：HEAD / GET / PUT（认 If-Match / If-None-Match）/ DELETE / MKCOL / PROPFIND。
 * 以 FetchLike 的形状暴露，塞给 WebDav / Sync 就能跑，不开端口。
 */
import type { FetchLike } from './webdav';

export interface FakeFile { body: string; etag: string; modified: string }

export class FakeDav {
  files = new Map<string, FakeFile>();
  dirs = new Set<string>();
  /** 每个请求一行：METHOD path [status] */
  requests: string[] = [];
  /** 为 true 时所有请求都像断网一样抛 TypeError */
  offline = false;
  private seq = 0;

  constructor(public base = 'https://dav.test/dav/', public user = 'me', public pass = 'secret') {}

  get fetch(): FetchLike {
    return async (input, init) => this.handle(input, init ?? {});
  }

  private path(url: string): string {
    if (!url.startsWith(this.base)) throw new Error('bad base ' + url);
    return decodeURIComponent(url.slice(this.base.length));
  }

  private async handle(url: string, init: RequestInit): Promise<Response> {
    if (this.offline) throw new TypeError('Failed to fetch');
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers as HeadersInit);
    const path = this.path(url);
    const res = this.route(method, path, headers, typeof init.body === 'string' ? init.body : '');
    this.requests.push(`${method} ${path} ${res.status}`);
    return res;
  }

  private route(method: string, path: string, headers: Headers, body: string): Response {
    const auth = headers.get('authorization') ?? '';
    const want = 'Basic ' + btoa(`${this.user}:${this.pass}`);
    if (auth !== want) return new Response('', { status: 401 });
    const f = this.files.get(path);
    // 204 / 304 这类状态 Response 构造器不许带 body，哪怕是空串
    const out = (status: number, b = '', h: Record<string, string> = {}) => new Response(b && status !== 204 && status !== 304 ? b : null, { status, headers: h });
    switch (method) {
      case 'HEAD':
        if (path.endsWith('/')) return this.dirs.has(path) ? out(200) : out(404);
        return f ? out(200, '', { ETag: f.etag, 'Last-Modified': f.modified, 'Content-Length': String(f.body.length) }) : out(404);
      case 'GET':
        return f ? out(200, f.body, { ETag: f.etag, 'Last-Modified': f.modified }) : out(404);
      case 'PUT': {
        const ifMatch = headers.get('if-match');
        const ifNone = headers.get('if-none-match');
        if (ifNone === '*' && f) return out(412);
        if (ifMatch && (!f || f.etag !== ifMatch)) return out(412);
        const dir = path.slice(0, path.lastIndexOf('/') + 1);
        if (dir && !this.dirs.has(dir)) return out(409);
        const nf: FakeFile = { body, etag: `"e${++this.seq}"`, modified: new Date().toUTCString() };
        this.files.set(path, nf);
        return out(f ? 204 : 201, '', { ETag: nf.etag });
      }
      case 'DELETE':
        if (!f) return out(404);
        this.files.delete(path);
        return out(204);
      case 'MKCOL': {
        const dir = path.endsWith('/') ? path : path + '/';
        if (this.dirs.has(dir)) return out(405);
        const parent = dir.slice(0, dir.lastIndexOf('/', dir.length - 2) + 1);
        if (parent && !this.dirs.has(parent)) return out(409);
        this.dirs.add(dir);
        return out(201);
      }
      case 'PROPFIND': {
        const dir = path.endsWith('/') ? path : path + '/';
        if (!this.dirs.has(dir)) return out(404);
        const entries = [...this.files.entries()].filter(([p]) => p.startsWith(dir) && !p.slice(dir.length).includes('/'));
        const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">` +
          `<d:response><d:href>${this.href(dir)}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>` +
          entries.map(([p, file]) => `<d:response><d:href>${this.href(p)}</d:href><d:propstat><d:prop><d:getlastmodified>${file.modified}</d:getlastmodified><d:getcontentlength>${file.body.length}</d:getcontentlength><d:resourcetype/></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('') +
          `</d:multistatus>`;
        return out(207, xml, { 'Content-Type': 'application/xml' });
      }
      default:
        return out(405);
    }
  }

  private href(p: string): string {
    return new URL(this.base).pathname + p.split('/').map(encodeURIComponent).join('/');
  }

  /** 直接从外面改一个文件（模拟别的设备写了），ETag 会变 */
  write(path: string, body: string) {
    this.files.set(path, { body, etag: `"e${++this.seq}"`, modified: new Date().toUTCString() });
  }
}
