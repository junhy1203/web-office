import { test, expect } from '@playwright/test';

async function runPython(page, code) {
  await page.getByLabel('문서 파일 열기').setInputFiles({
    name: 'main.py', mimeType: 'text/x-python', buffer: Buffer.from(code),
  });
  const output = page.getByRole('log', { name: 'Python 입출력' });
  await page.getByRole('button', { name: '실행', exact: true }).click();
  return output;
}

test('Python executes print and waits for input only when called', async ({ page }) => {
  await page.goto('/');
  const output = await runPython(page, 'print("ready")\nnumber = input("Value: ")\nprint(int(number) + 1)');
  await expect(output).toContainText('ready', { timeout: 50_000 });
  const input = page.getByRole('textbox', { name: 'Python input 입력' });
  await expect(input).toBeVisible({ timeout: 20_000 });
  await expect(output).toContainText('Value: ');
  await input.fill('41');
  await input.press('Enter');
  await expect(output).toContainText('42', { timeout: 20_000 });
  await expect(page.getByText('실행 완료', { exact: true })).toBeVisible();
  await expect(input).toHaveCount(0);
});

test('Python console starts without an input field', async ({ page }) => {
  await page.goto('/');
  const output = await runPython(page, 'print(6 * 7)');
  await expect(output).toContainText('42', { timeout: 50_000 });
  await expect(page.getByRole('textbox', { name: 'Python input 입력' })).toHaveCount(0);
  await expect(page.getByText('실행 완료', { exact: true })).toBeVisible();
});
