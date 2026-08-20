"""스토리지의 PNG 를 WebP 로 다시 인코딩한다.

객체 경로는 그대로 두고 내용과 Content-Type 만 바꾼다.
DB 에는 `<bucket>/<path>` 가 박혀 있고 표시 시점에 서명 URL 을 발급하므로,
경로가 유지되면 DB 는 한 줄도 건드릴 필요가 없다. 브라우저는 확장자가 아니라
Content-Type 을 보고 렌더링한다.

원본은 반드시 tmp/png-backup 에 먼저 내려받는다. WebP 는 되돌릴 수 없다.
"""
import os, sys, json, subprocess, tempfile, urllib.request, urllib.error, pathlib, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKUP = ROOT / 'tmp' / 'png-backup'
QUALITY = 95

def load_env():
    env = ROOT / 'scripts' / '.env'
    if env.exists():
        for line in env.read_text(encoding='utf-8').splitlines():
            if '=' in line and not line.strip().startswith('#'):
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())
    url, key = os.environ.get('SUPABASE_URL'), os.environ.get('SUPABASE_SERVICE_KEY')
    if not (url and key): sys.exit('SUPABASE_URL / SUPABASE_SERVICE_KEY 필요')
    return url.rstrip('/'), key

BASE, KEY = load_env()
H = {'Authorization': f'Bearer {KEY}', 'apikey': KEY}

RETRY_WAITS = (2, 5, 15)

def req(method, path, data=None, headers=None, raw=False):
    """네트워크 오류는 재시도한다. 한 번의 끊김으로 목록 전체를 태우면 안 된다."""
    last = None
    for attempt in range(len(RETRY_WAITS) + 1):
        try:
            r = urllib.request.Request(f'{BASE}{path}', data=data, method=method,
                                       headers={**H, **(headers or {})})
            with urllib.request.urlopen(r, timeout=120) as resp:
                body = resp.read()
                return body if raw else json.loads(body or b'null')
        except urllib.error.HTTPError:
            raise                      # 4xx/5xx 는 재시도해도 같다
        except Exception as e:         # URLError, timeout, 연결 끊김
            last = e
            if attempt < len(RETRY_WAITS):
                time.sleep(RETRY_WAITS[attempt])
    raise last

def download(bucket, name):
    return req('GET', f'/storage/v1/object/{bucket}/{urllib.parse.quote(name)}', raw=True)

def upload(bucket, name, blob, mime):
    return req('PUT', f'/storage/v1/object/{bucket}/{urllib.parse.quote(name)}',
               data=blob, headers={'Content-Type': mime, 'x-upsert': 'true',
                                   'cache-control': '3600'}, raw=True)

def convert(png_bytes):
    with tempfile.TemporaryDirectory() as d:
        p, w = pathlib.Path(d)/'i.png', pathlib.Path(d)/'o.webp'
        p.write_bytes(png_bytes)
        subprocess.run(['cwebp', '-quiet', '-q', str(QUALITY), str(p), '-o', str(w)],
                       check=True, capture_output=True)
        return w.read_bytes()

def main():
    targets = json.loads(pathlib.Path(sys.argv[1]).read_text())
    dry = '--apply' not in sys.argv
    print(f"{'[검증만]' if dry else '[실제 적용]'} 대상 {len(targets)}건, 품질 q{QUALITY}\n")
    donelog = BACKUP / '_done.txt'
    already = set(donelog.read_text().splitlines()) if donelog.exists() else set()
    if already: print(f'  이미 완료된 {len(already)}건은 건너뜁니다.\n')
    ob = ow = 0; done = fail = 0; streak = 0
    for i, t in enumerate(targets, 1):
        bucket, name = t['bucket_id'], t['name']
        key = f'{bucket}/{name}'
        if key in already: continue
        dest = BACKUP / bucket / name
        try:
            if dest.exists():
                png = dest.read_bytes()
            else:
                png = download(bucket, name)
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(png)          # 백업 먼저
            webp = convert(png)
            if len(webp) >= len(png):          # 안 줄면 건드리지 않는다
                print(f'  [{i}/{len(targets)}] 건너뜀(절감 없음) {name}')
                continue
            ob += len(png); ow += len(webp); done += 1
            if not dry:
                upload(bucket, name, webp, 'image/webp')
                with donelog.open('a') as fh: fh.write(key + '\n')
            streak = 0
            if i % 100 == 0 or i == len(targets):
                print(f'  [{i}/{len(targets)}] 누적 {ob//1048576}MB → {ow//1048576}MB '
                      f'({(1-ow/ob)*100:.1f}% 절감)')
        except Exception as e:
            fail += 1; streak += 1
            print(f'  ✗ [{i}] {key}: {type(e).__name__} {e}')
            if streak >= 8:
                print(f'\n  ⛔ 연속 {streak}건 실패 — 네트워크 문제로 보고 중단합니다.')
                print(f'     복구되면 같은 명령을 다시 실행하세요. 완료분은 건너뜁니다.')
                break
    print(f'\n변환 {done}건 / 실패 {fail}건')
    if ob: print(f'{ob/1048576:.0f}MB → {ow/1048576:.0f}MB  ({(1-ow/ob)*100:.1f}% 절감)')
    print(f'백업: {BACKUP}')

if __name__ == '__main__':
    import urllib.parse
    main()
