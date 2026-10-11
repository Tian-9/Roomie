import { describe, it, expect } from 'vitest';
import { WebDav, DavError, parsePropfind, normalizeUrl, isValidUrl } from './webdav';
import { FakeDav } from './webdav.fake';

function client(server: FakeDav, pass = server.pass) {
  return new WebDav({ url: server.base, username: server.user, password: pass }, server.fetch);
}

describe('webdav client', () => {
  it('地址规范化、路径编码', () => {
    expect(normalizeUrl(' https://x.y/dav ')).toBe('https://x.y/dav/');
    expect(isValidUrl('https://x.y/dav/')).toBe(true);
    expect(isValidUrl('x.y/dav')).toBe(false);
    const dav = new WebDav({ url: 'https://x.y/dav', username: 'u', password: 'p' }, async () => new Response(''));
    expect(dav.href('roomie/冲突 1.json')).toBe('https://x.y/dav/roomie/%E5%86%B2%E7%AA%81%201.json');
    expect(dav.href('roomie/')).toBe('https://x.y/dav/roomie/');
  });

  it('stat / put / get / delete 往返，PUT 带 If-Match 认 412', async () => {
    const s = new FakeDav();
    const dav = client(s);
    expect(await dav.stat('roomie/roomie.json')).toBeNull();
    await dav.mkcol('roomie');
    await dav.mkcol('roomie'); // 已有也算成功
    const e1 = await dav.put('roomie/roomie.json', '{"a":1}', { ifNoneMatch: true });
    expect(e1).toBe('"e1"');
    await expect(dav.put('roomie/roomie.json', 'x', { ifNoneMatch: true })).rejects.toMatchObject({ kind: 'conflict' });
    const st = await dav.stat('roomie/roomie.json');
    expect(st?.etag).toBe('"e1"');
    expect(st?.size).toBe(7);
    const got = await dav.get('roomie/roomie.json');
    expect(got).toEqual({ text: '{"a":1}', etag: '"e1"' });
    s.write('roomie/roomie.json', '{"a":2}');
    await expect(dav.put('roomie/roomie.json', 'y', { ifMatch: '"e1"' })).rejects.toBeInstanceOf(DavError);
    const e3 = await dav.put('roomie/roomie.json', 'y', { ifMatch: '"e2"' });
    expect(e3).toBe('"e3"');
    await dav.delete('roomie/roomie.json');
    expect(await dav.get('roomie/roomie.json')).toBeNull();
    await dav.delete('roomie/roomie.json'); // 没有也不报错
  });

  it('列目录只给文件，按名字拿', async () => {
    const s = new FakeDav();
    const dav = client(s);
    await dav.mkcol('roomie');
    await dav.mkcol('roomie/conflicts');
    await dav.put('roomie/conflicts/20261011-0900-手机-本机.json', '{}');
    await dav.put('roomie/conflicts/b.json', '{"x":1}');
    const list = await dav.list('roomie/conflicts');
    expect(list.map((e) => e.name).sort()).toEqual(['20261011-0900-手机-本机.json', 'b.json']);
    expect(list.find((e) => e.name === 'b.json')?.size).toBe(7);
    expect(await dav.list('roomie/nothing')).toEqual([]);
  });

  it('密码错是 auth，断网是 network', async () => {
    const s = new FakeDav();
    await expect(client(s, 'wrong').stat('x')).rejects.toMatchObject({ kind: 'auth' });
    s.offline = true;
    await expect(client(s).stat('x')).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('parsePropfind', () => {
  it('认不同前缀和绝对地址，跳过目录本身和子目录', () => {
    const xml = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">
      <D:response><D:href>/dav/roomie/conflicts/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
      <D:response><D:href>https://h.example/dav/roomie/conflicts/a%20b.json</D:href><D:propstat><D:prop><D:getlastmodified>Sat, 11 Oct 2026 02:00:00 GMT</D:getlastmodified><D:getcontentlength>12</D:getcontentlength><D:resourcetype/></D:prop></D:propstat></D:response>
      <D:response><D:href>/dav/roomie/conflicts/sub/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
      <D:response><D:href>/dav/roomie/conflicts/sub/deep.json</D:href><D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat></D:response>
    </D:multistatus>`;
    expect(parsePropfind(xml, 'https://h.example/dav/roomie/conflicts/')).toEqual([{ name: 'a b.json', lastModified: 'Sat, 11 Oct 2026 02:00:00 GMT', size: 12 }]);
  });
});
