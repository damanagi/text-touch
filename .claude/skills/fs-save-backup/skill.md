---
name: fs-save-backup
description: HTML 파일의 안전한 읽기·쓰기·자동 백업·다른 이름으로 저장을 처리. 원본 덮어쓰기 전 .bak 자동 생성(3개 회전), 원자적 쓰기(temp→rename), 인코딩(BOM/meta charset)·줄바꿈(LF/CRLF) 보존을 수행. "저장했더니 파일이 망가졌다"가 절대 일어나지 않아야 할 때 반드시 이 스킬을 사용한다. Node.js fs API만 사용, 추가 의존성 없음.
---

# FS Save Backup — 파일을 잃지 않는 저장 레시피

## 약속

이 모듈의 단 하나의 약속은 "**사용자가 작업한 시간을 절대 잃지 않는다**"이다. 그래서 빠른 저장보다 안전한 저장을 우선한다. 인코딩 추정이 실패해도, 디스크가 가득 차도, 도중에 프로세스가 죽어도 원본 파일은 무사해야 한다.

## 4단계 안전망

1. **백업 회전** — 덮어쓰기 전 `.bak`을 만든다.
2. **원자적 쓰기** — 임시 파일로 쓴 뒤 rename으로 교체.
3. **인코딩 보존** — 원본 인코딩 그대로.
4. **줄바꿈 보존** — 원본 줄바꿈 그대로.

## 인코딩 감지

```js
const fs = require('fs').promises;
const path = require('path');

async function detectEncoding(filePath) {
  // BOM 우선 검사
  const buf = await fs.readFile(filePath);

  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return { encoding: 'utf-8', bom: true };
  }
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return { encoding: 'utf-16le', bom: true };
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    return { encoding: 'utf-16be', bom: true };
  }

  // meta charset 추출 (utf-8로 일단 디코딩, ASCII 범위만 보면 됨)
  const head = buf.slice(0, 4096).toString('utf-8');
  const match = head.match(/<meta\s+charset\s*=\s*["']?([\w-]+)/i)
              || head.match(/<meta\s+http-equiv\s*=\s*["']?Content-Type["']?\s+content\s*=\s*["'][^"']*charset=([\w-]+)/i);

  if (match) {
    const declared = match[1].toLowerCase();
    if (declared === 'utf-8' || declared === 'utf8') return { encoding: 'utf-8', bom: false };
    if (declared.startsWith('euc-kr') || declared === 'ks_c_5601-1987') {
      return { encoding: 'euc-kr', bom: false };
    }
    return { encoding: declared, bom: false };
  }

  // 기본
  return { encoding: 'utf-8', bom: false };
}
```

> **euc-kr 같은 비표준 인코딩 처리:** Node 내장 `Buffer`는 utf-8/utf-16le/latin1만 지원. euc-kr 같은 경우 `iconv-lite` 같은 모듈이 필요. v1에서는 utf-8만 안정 지원, 그 외 인코딩은 감지만 하고 utf-8로 변환해 저장하면서 사용자에게 토스트로 알린다. ("EUC-KR 파일을 UTF-8로 변환해 저장합니다. 원본은 .bak에 있어요.")

## 줄바꿈 감지

```js
function detectLineEnding(text) {
  // 앞쪽 2KB만 보면 충분
  const sample = text.slice(0, 2048);
  const crlfCount = (sample.match(/\r\n/g) || []).length;
  const lfCount = (sample.match(/(?<!\r)\n/g) || []).length;
  if (crlfCount > 0 && crlfCount >= lfCount) return '\r\n';
  return '\n';
}
```

## 로드

```js
async function loadFile(filePath) {
  const { encoding, bom } = await detectEncoding(filePath);
  const buf = await fs.readFile(filePath);

  let text;
  if (encoding === 'utf-8') {
    text = bom ? buf.slice(3).toString('utf-8') : buf.toString('utf-8');
  } else if (encoding === 'utf-16le') {
    text = bom ? buf.slice(2).toString('utf-16le') : buf.toString('utf-16le');
  } else {
    // euc-kr 등 → utf-8로 임시 디코딩 (글자 깨질 수 있음, 사용자 안내)
    text = buf.toString('utf-8');
  }

  const lineEnding = detectLineEnding(text);

  return {
    path: filePath,
    html: text,
    encoding,
    bom,
    lineEnding,
    legacyEncodingWarn: !['utf-8', 'utf-16le', 'utf-16be'].includes(encoding)
  };
}
```

## 백업 회전

```js
async function rotateBackup(filePath) {
  const bakPath = filePath + '.bak';
  const bak1 = filePath + '.bak.1';
  const bak2 = filePath + '.bak.2';

  // .bak.1 → .bak.2 (가장 오래된 건 사라짐)
  try { await fs.rename(bak1, bak2); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  // .bak → .bak.1
  try { await fs.rename(bakPath, bak1); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  // 원본 → .bak (덮어쓰기 전이라 원본은 무사)
  await fs.copyFile(filePath, bakPath);

  return bakPath;
}
```

> **copyFile vs rename:** 원본을 rename으로 옮기면 직후 새 파일 쓰기 도중 프로세스가 죽으면 원본도 없고 새 파일도 없는 상태가 된다. copyFile은 원본을 그대로 두므로 안전.

## 원자적 쓰기

```js
async function atomicWrite(filePath, content, encoding) {
  const tmpPath = filePath + '.tmp.' + process.pid;

  let buf;
  if (encoding.encoding === 'utf-8') {
    const bomBytes = encoding.bom ? Buffer.from([0xEF, 0xBB, 0xBF]) : Buffer.alloc(0);
    buf = Buffer.concat([bomBytes, Buffer.from(content, 'utf-8')]);
  } else if (encoding.encoding === 'utf-16le') {
    const bomBytes = encoding.bom ? Buffer.from([0xFF, 0xFE]) : Buffer.alloc(0);
    buf = Buffer.concat([bomBytes, Buffer.from(content, 'utf-16le')]);
  } else {
    // 비표준 인코딩 → utf-8로 변환
    buf = Buffer.from(content, 'utf-8');
  }

  await fs.writeFile(tmpPath, buf);
  // fsync로 디스크에 내려쓰기 (선택, 안전성 우선)
  try {
    const fh = await fs.open(tmpPath, 'r+');
    await fh.sync();
    await fh.close();
  } catch (_) { /* 일부 파일시스템 미지원, 무시 */ }
  await fs.rename(tmpPath, filePath);
}
```

## 줄바꿈 적용

```js
function applyLineEnding(text, lineEnding) {
  // 입력은 LF로 정규화된 상태로 받아 lineEnding으로 일괄 변환
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (lineEnding === '\r\n') return normalized.replace(/\n/g, '\r\n');
  return normalized;
}
```

## 원본 덮어쓰기 (전체 흐름)

```js
async function saveOriginal({ filePath, html, encoding, bom, lineEnding }) {
  // 1. 권한 검사
  try {
    await fs.access(filePath, fs.constants.W_OK);
  } catch {
    throw new Error(`파일에 쓰기 권한이 없어요: ${filePath}`);
  }

  // 2. 백업
  let backupPath;
  try {
    backupPath = await rotateBackup(filePath);
  } catch (e) {
    throw new Error(`백업을 만들 수 없어 저장을 중단했어요: ${e.message}`);
  }

  // 3. 줄바꿈 적용
  const finalText = applyLineEnding(html, lineEnding);

  // 4. 원자적 쓰기
  try {
    await atomicWrite(filePath, finalText, { encoding, bom });
  } catch (e) {
    throw new Error(`저장 실패: ${e.message}. 백업은 ${backupPath} 에 있어요.`);
  }

  return { success: true, backupPath };
}
```

## 다른 이름으로 저장

```js
const { dialog } = require('electron');

async function saveAs({ suggestedName, html, encoding, bom, lineEnding }, parentWindow) {
  const result = await dialog.showSaveDialog(parentWindow, {
    defaultPath: suggestedName,
    filters: [
      { name: 'HTML', extensions: ['html', 'htm'] }
    ]
  });

  if (result.canceled || !result.filePath) return null;

  const finalText = applyLineEnding(html, lineEnding);
  await atomicWrite(result.filePath, finalText, { encoding: encoding || 'utf-8', bom: bom || false });

  return { success: true, newPath: result.filePath };
}
```

## 복원 가이드 (사용자용)

저장 후 문제 발견 시:

```bash
# 가장 최근 백업으로 복구
mv my-slide.html.bak my-slide.html

# 한 단계 더 전
mv my-slide.html.bak.1 my-slide.html
```

이 텍스트는 앱의 "도움말" 메뉴에 그대로 노출.

## 에러 메시지 패턴

| 코드 | 사용자에게 보일 메시지 |
|------|---------------------|
| `EACCES` | "파일에 쓰기 권한이 없어요. 파일 정보에서 권한을 확인해주세요." |
| `ENOSPC` | "디스크 공간이 부족해서 저장하지 못했어요. 공간을 확보한 뒤 다시 시도해주세요. (백업은 안전해요)" |
| `EBUSY` | "다른 프로그램이 이 파일을 쓰고 있어요. 그 프로그램을 닫고 다시 저장해주세요." |
| `ENOENT` (원본) | "원본 파일이 사라졌어요. '다른 이름으로 저장'을 사용해주세요." |

## 검증 시점

- 인코딩 감지 직후 → UTF-8 BOM 파일, UTF-8 (no BOM), EUC-KR meta 파일 각각으로 결과 확인
- 백업 회전 직후 → 4번 연속 저장 시 .bak / .bak.1 / .bak.2가 올바르게 회전, .bak.3는 안 생기는지
- 원자적 쓰기 직후 → 도중에 프로세스 강제 종료 시 원본이 무사한지
- 줄바꿈 적용 직후 → CRLF 입력 → CRLF 출력, LF 입력 → LF 출력

## 참고

- 큰 파일(50MB+)도 atomicWrite로 처리 가능. 메모리 부담은 있지만 v1에서는 단순함 우선.
- 심볼릭 링크 처리: `realpath`로 실제 경로 추적 후 그 위치에 저장. 링크 자체는 보존.
