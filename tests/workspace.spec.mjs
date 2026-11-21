import { test, expect } from '@playwright/test';
import iconv from 'iconv-lite';
import { unzipSync, strFromU8 } from 'fflate';
import { readFile } from 'node:fs/promises';
import { odt, pdf, png, richHangul, sheet, slides, word } from './fixtures.mjs';

async function open(page, name, bytes) {
  await page.getByLabel('문서 파일 열기').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
}

async function save(page) {
  const button = page.getByRole('button', { name: '사본 저장' });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  const pending = page.waitForEvent('download');
  await button.click();
  const result = await pending;
  return { name: result.suggestedFilename(), bytes: await readFile(await result.path()) };
}

test.beforeEach(async ({ page, baseURL }) => {
  const external = [];
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== baseURL) external.push(request.url());
  });
  page.externalRequests = external;
  await page.goto('/');
});

test.afterEach(async ({ page }) => { expect(page.externalRequests).toEqual([]); });

test('작업 공간, 확장자 목록, CP949와 CRLF 사본, 미저장 확인', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '문서 작업 공간' })).toBeVisible();
  await page.getByRole('button', { name: '지원 파일 형식' }).click();
  const list = page.getByRole('dialog');
  await list.getByPlaceholder('확장자 또는 분류 검색').fill('.kfx');
  await expect(list.getByText('.kfx')).toBeVisible();
  await expect(list.getByText('준비 중')).toBeVisible();
  await list.getByRole('button', { name: '닫기' }).click();
  await open(page, '한글.txt', iconv.encode('한글\r\n두 번째 줄\r\n', 'cp949'));
  const editor = page.getByRole('textbox', { name: '텍스트 편집기' });
  await expect(editor).toContainText('한글');
  await page.getByRole('button', { name: '찾기', exact: true }).click();
  await expect(page.locator('.cm-search')).toBeVisible();
  await editor.fill('한글 편집');
  await expect(page.getByText('저장하지 않은 변경 사항')).toBeVisible();
  const saved = await save(page);
  expect(iconv.decode(saved.bytes, 'cp949')).toContain('한글 편집');
  await editor.press('End');
  await editor.press('Enter');
  await page.keyboard.insertText('새 줄');
  expect(iconv.decode((await save(page)).bytes, 'cp949')).toContain('\r\n새 줄');
  await page.keyboard.insertText(' 수정');
  await expect(page.getByText('저장하지 않은 변경 사항')).toBeVisible();
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('저장하지 않은'); await dialog.dismiss(); });
  await page.getByRole('button', { name: '한글.txt 닫기' }).click();
  await expect(editor).toBeVisible();
});

test('HWPX 작성, 한글 입력, 변경 표시와 사본 다시 열기', async ({ page }) => {
  await page.getByRole('button', { name: /한글 문서 글과 표/ }).click();
  const frame = page.frameLocator('iframe[title="한글 편집기"]');
  await expect(page.getByRole('button', { name: '사본 저장' })).toBeEnabled({ timeout: 35_000 });
  const surface = frame.locator('.document-page-canvas').first();
  await expect(surface).toBeVisible();
  await surface.click({ position: { x: 150, y: 115 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: '한' });
  await cdp.detach();
  await page.keyboard.insertText('글 저장 검증');
  await expect(page.getByText('저장하지 않은 변경 사항')).toBeVisible({ timeout: 12_000 });
  const saved = await save(page);
  expect(saved.name.endsWith('.hwpx')).toBe(true);
  const parts = unzipSync(saved.bytes);
  expect(strFromU8(parts['Contents/section0.xml'])).toContain('한글 저장 검증');
  await open(page, '사본.hwpx', saved.bytes);
  await expect(page.getByRole('button', { name: '사본 저장' })).toBeEnabled({ timeout: 35_000 });
  expect(strFromU8(unzipSync((await save(page)).bytes)['Contents/section0.xml'])).toContain('한글 저장 검증');
});

test('여러 쪽 HWPX와 HWP의 머리말·누름틀·표·이미지 보존', async ({ page }) => {
  const fixture = await richHangul();
  for (const extension of ['hwpx', 'hwp', 'hwt', 'owpml']) {
    await open(page, `공문.${extension}`, extension === 'hwp' || extension === 'hwt' ? fixture.hwp : fixture.hwpx);
    page.once('dialog', async dialog => { await dialog.accept(); });
    const saved = await save(page);
    expect(saved.name).toBe('공문.hwpx');
    const parts = unzipSync(saved.bytes);
    const section = strFromU8(parts['Contents/section0.xml']);
    for (const text of ['머리말 확인', '꼬리말 확인', '기안자', '표 내용', '두 번째 쪽']) expect(section).toContain(text);
    expect(Object.keys(parts).some(path => path.startsWith('BinData/'))).toBe(true);
    await page.getByRole('button', { name: `공문.${extension} 닫기` }).click();
  }
});

test('Python 입력, 오류, 무한 루프 중지 후 재실행', async ({ page }) => {
  await open(page, 'script.py', Buffer.from('print("안녕", input())'));
  const input = page.getByPlaceholder('input()에 전달할 값을 한 줄씩 입력');
  await input.fill('한글');
  const run = page.getByRole('button', { name: '실행', exact: true });
  const output = page.getByRole('log');
  await run.click();
  await expect(output).toContainText('안녕 한글', { timeout: 25_000 });
  const code = page.getByRole('textbox', { name: '텍스트 편집기' });
  await code.fill('raise ValueError("오류 검증")');
  await run.click();
  await expect(output).toContainText('ValueError: 오류 검증', { timeout: 20_000 });
  await code.fill('while True: pass');
  await run.click();
  await expect(page.getByText('실행 중', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '중지', exact: true }).click();
  await expect(page.getByText('실행 중지', { exact: true })).toBeVisible();
  await code.fill("from js import fetch\nawait fetch('https://example.invalid')\n");
  await run.click();
  await expect(output).toContainText('네트워크 접근은 사용할 수 없습니다.', { timeout: 20_000 });
  await code.fill('print(6 * 7)');
  await run.click();
  await expect(output).toContainText('42', { timeout: 20_000 });
});

test('DOCX 본문과 표 편집 및 변경하지 않은 파트 보존', async ({ page }) => {
  await open(page, '문서.docx', word);
  const body = page.getByRole('textbox', { name: '본문 텍스트' });
  await expect(body.first()).toHaveText('처음 문장');
  await body.first().fill('수정된 문서');
  await page.getByRole('button', { name: '굵게' }).click();
  await body.nth(1).fill('바뀐 표');
  const saved = await save(page);
  const parts = unzipSync(saved.bytes);
  expect(strFromU8(parts['word/document.xml'])).toContain('바뀐 표');
  expect(strFromU8(parts['word/document.xml'])).toContain('<w:b');
  expect(parts['word/styles.xml']).toEqual(unzipSync(word)['word/styles.xml']);
  await open(page, '다시.docx', saved.bytes);
  await expect(page.getByRole('tabpanel', { name: '다시.docx' }).getByText('수정된 문서')).toBeVisible();
});

test('XLSX 셀, 수식, 색상과 CSV 편집', async ({ page }) => {
  await open(page, '표.xlsx', sheet);
  const cell = address => page.getByRole('textbox', { name: address, exact: true });
  await cell('A1').fill('7');
  await expect(cell('C1')).toHaveValue('10');
  await cell('D1').fill('=A1*B1');
  const color = page.getByLabel('셀 배경색');
  await color.fill('#e0aaff');
  const saved = await save(page);
  const parts = unzipSync(saved.bytes);
  expect(strFromU8(parts['xl/worksheets/sheet1.xml'])).toContain('A1*B1');
  expect(strFromU8(parts['xl/styles.xml'])).toContain('FFE0AAFF');
  await open(page, '사본.xlsx', saved.bytes);
  await expect(cell('D1')).toHaveValue('21');
  await open(page, '표.csv', Buffer.from('품명,수량\r\n"종이, 펜",2\r\n'));
  await expect(cell('A2')).toHaveValue('종이, 펜');
  await cell('B2').fill('12');
  expect((await save(page)).bytes.toString()).toBe('품명,수량\r\n"종이, 펜",12\r\n');
});

test('PPTX 슬라이드 재정렬, 텍스트와 도형 추가', async ({ page }) => {
  await open(page, '발표.pptx', slides);
  const text = page.getByRole('textbox', { name: '슬라이드 텍스트' });
  await expect(text).toHaveText('첫 슬라이드');
  await text.fill('편집 슬라이드');
  await page.getByRole('button', { name: '사각형 삽입' }).click();
  await expect(text.nth(1)).toHaveText('텍스트');
  await page.getByRole('button', { name: '슬라이드 아래로' }).click();
  const saved = await save(page);
  const parts = unzipSync(saved.bytes);
  expect(strFromU8(parts['ppt/slides/slide1.xml'])).toContain('편집 슬라이드');
  expect(parts['ppt/slides/slide2.xml']).toEqual(unzipSync(slides)['ppt/slides/slide2.xml']);
  await open(page, '다시.pptx', saved.bytes);
  await expect(text).toHaveText('둘째 슬라이드');
});

test('PDF 검색과 확대, PNG와 ODF, 손상 파일', async ({ page }) => {
  await open(page, '본문.pdf', pdf());
  const query = page.getByRole('textbox', { name: 'PDF 텍스트 검색' });
  await query.fill('Sample');
  await query.press('Enter');
  await expect(page.getByLabel('검색 결과')).toHaveValue('1');
  await page.getByRole('button', { name: '확대', exact: true }).click();
  await expect(page.getByText('125%')).toBeVisible();
  await open(page, '이미지.png', png);
  await expect(page.getByRole('img', { name: '이미지 미리보기' })).toBeVisible();
  await open(page, '오픈문서.odt', odt);
  await expect(page.getByText('오픈문서 본문')).toBeVisible();
  await open(page, '손상.docx', Buffer.from('내용 없는 파일'));
  await expect(page.getByRole('alert')).toContainText('파일을 열 수 없습니다');
});
