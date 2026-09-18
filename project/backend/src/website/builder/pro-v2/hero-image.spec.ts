import { extractHeroImageUrl } from './hero-image';

function file(path: string, text: string) {
  return { path, bytes: Buffer.from(text, 'utf8') };
}

describe('extractHeroImageUrl', () => {
  it('finds a Pexels URL inlined in a built JS bundle', () => {
    const url = extractHeroImageUrl([
      file('index.html', '<!doctype html><html></html>'),
      file(
        'assets/index-abc123.js',
        'const e=n("img",{src:"https://images.pexels.com/photos/123/photo.jpeg?auto=compress"});',
      ),
    ]);
    expect(url).toBe('https://images.pexels.com/photos/123/photo.jpeg?auto=compress');
  });

  it('finds an uploaded-asset URL', () => {
    const url = extractHeroImageUrl([
      file('assets/index-abc.js', 'src:"/api/v1/website-assets/9c1f2a3b-1111-2222-3333-444455556666"'),
    ]);
    expect(url).toBe('/api/v1/website-assets/9c1f2a3b-1111-2222-3333-444455556666');
  });

  it('prefers index.html first regardless of array order', () => {
    const url = extractHeroImageUrl([
      file('assets/index-abc.js', 'https://images.pexels.com/photos/999/second.jpeg'),
      file('index.html', '<img src="https://images.pexels.com/photos/111/first.jpeg">'),
    ]);
    expect(url).toBe('https://images.pexels.com/photos/111/first.jpeg');
  });

  it('ignores binary/font files and only scans text-based ones', () => {
    const url = extractHeroImageUrl([
      file('assets/font.woff2', 'https://images.pexels.com/photos/should-not-match/x.jpeg'),
    ]);
    expect(url).toBeNull();
  });

  it('returns null when no recognizable image URL is found', () => {
    const url = extractHeroImageUrl([
      file('index.html', '<html><body>Hello</body></html>'),
      file('assets/index.js', 'console.log("no images here")'),
    ]);
    expect(url).toBeNull();
  });
});
