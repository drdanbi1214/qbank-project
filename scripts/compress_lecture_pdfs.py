"""강의록 PDF 안의 이미지를 다시 인코딩해 용량을 줄인다.

객체 경로와 Content-Type 은 그대로 두고 내용만 바꾼다. DB 에는
`<bucket>/<path>` 가 박혀 있으므로 경로가 유지되면 DB 는 손댈 필요가 없다.

표본 강의록은 12쪽에 이미지 83개, 전체 바이트의 94% 가 이미지였다.
그래서 이미지만 다시 인코딩해도 78% 가 줄어든다. 4배 확대해도 본문 글자와
도식이 원본과 구별되지 않아 품질 85 / 150dpi 로 정했다.

exam-sources 는 건드리지 않는다. 인게스천의 원본 대조 자료인데다 전부
합쳐야 3.6MB 라 줄일 실익이 없다.
"""
import os, sys, json, pathlib, subprocess, tempfile, time
import urllib.request, urllib.error, urllib.parse
import fitz

from supabase_credentials import load_supabase_credentials

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKUP = ROOT / 'tmp' / 'pdf-backup'
QUALITY, DPI_TARGET = 85, 150
RETRY_WAITS = (2, 5, 15)

def load_env():
    return load_supabase_credentials()

BASE, KEY = load_env()
H = {'Authorization': f'Bearer {KEY}', 'apikey': KEY}

def req(method, path, data=None, headers=None):
    last = None
    for attempt in range(len(RETRY_WAITS) + 1):
        try:
            r = urllib.request.Request(f'{BASE}{path}', data=data, method=method,
                                       headers={**H, **(headers or {})})
            with urllib.request.urlopen(r, timeout=300) as resp:
                return resp.read()
        except urllib.error.HTTPError:
            raise
        except Exception as e:
            last = e
            if attempt < len(RETRY_WAITS): time.sleep(RETRY_WAITS[attempt])
    raise last

def _shrink_here(src, dst):
    d = fitz.open(src)
    d.rewrite_images(dpi_threshold=int(DPI_TARGET * 1.3), dpi_target=DPI_TARGET,
                     quality=QUALITY, lossy=True)
    d.save(dst, garbage=4, deflate=True, clean=True)
    d.close()

def shrink(src: pathlib.Path, dst: pathlib.Path):
    """변환은 반드시 자식 프로세스에서 돌린다.

    rewrite_images 는 큰 PDF 를 연달아 처리하면 세그폴트로 죽는다(파일 자체는
    멀쩡하고 단독 실행하면 성공한다 — 프로세스에 상태가 누적되는 문제다).
    파일마다 프로세스를 새로 띄우면 누적이 없고, 죽더라도 그 한 건만 실패한다.
    """
    r = subprocess.run([sys.executable, __file__, '--shrink', str(src), str(dst)],
                       capture_output=True, timeout=900)
    if r.returncode != 0 or not dst.exists():
        detail = r.stderr.decode(errors='replace').strip().splitlines()[-1:] or ['']
        raise RuntimeError(f'변환 실패(exit {r.returncode}) {detail[0][:120]}')

def main():
    targets = json.loads(pathlib.Path(sys.argv[1]).read_text())
    dry = '--apply' not in sys.argv
    donelog = BACKUP / '_done.txt'
    already = set(donelog.read_text().splitlines()) if donelog.exists() else set()
    print(f"{'[검증만]' if dry else '[실제 적용]'} 대상 {len(targets)}건 · 품질 {QUALITY} / {DPI_TARGET}dpi")
    if already: print(f'  완료된 {len(already)}건은 건너뜁니다.')
    print()
    ob = ow = 0; done = fail = 0; streak = 0
    for i, t in enumerate(targets, 1):
        bucket, name = t['bucket_id'], t['name']
        key = f'{bucket}/{name}'
        if key in already: continue
        dest = BACKUP / bucket / name
        try:
            if dest.exists():
                raw = dest.read_bytes()
            else:
                raw = req('GET', f'/storage/v1/object/{bucket}/{urllib.parse.quote(name)}')
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(raw)          # 백업 먼저
            with tempfile.TemporaryDirectory() as tmp:
                a, b = pathlib.Path(tmp)/'i.pdf', pathlib.Path(tmp)/'o.pdf'
                a.write_bytes(raw); shrink(a, b); out = b.read_bytes()
            if len(out) >= len(raw):
                print(f'  [{i}/{len(targets)}] 건너뜀(절감 없음) {name}')
                continue
            ob += len(raw); ow += len(out); done += 1
            if not dry:
                req('PUT', f'/storage/v1/object/{bucket}/{urllib.parse.quote(name)}', data=out,
                    headers={'Content-Type': 'application/pdf', 'x-upsert': 'true',
                             'cache-control': '3600'})
                with donelog.open('a') as fh: fh.write(key + '\n')
            streak = 0
            print(f'  [{i}/{len(targets)}] {len(raw)/1048576:5.1f}MB → {len(out)/1048576:4.1f}MB '
                  f'({(1-len(out)/len(raw))*100:2.0f}%)  {name.split("/")[-1]}')
        except Exception as e:
            fail += 1; streak += 1
            print(f'  ✗ [{i}] {key}: {type(e).__name__} {e}')
            if streak >= 4:
                print('\n  ⛔ 연속 실패 — 중단합니다. 복구 후 같은 명령을 다시 실행하세요.')
                break
    print(f'\n변환 {done}건 / 실패 {fail}건')
    if ob: print(f'{ob/1048576:.0f}MB → {ow/1048576:.0f}MB  ({(1-ow/ob)*100:.1f}% 절감)')
    print(f'백업: {BACKUP}')

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--shrink':
        _shrink_here(sys.argv[2], sys.argv[3])
    else:
        main()
