/**
 * E2E 测试（需求文档 §10）：从「前端点对应的 bug」到后端（转换引擎、持久化、导出）全链路。
 * 覆盖：输入→转换→预览→多音字确认→导出 BRF 全流程、键盘流、刷新持久化、100 页长文滚动。
 */
import fs from 'node:fs';
import { expect, test } from '@playwright/test';

const NEW_DOC = '＋ 新建盲文文档';

async function createDoc(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: NEW_DOC }).click();
  await expect(page).toHaveURL(/\/editor\//);
  await expect(page.getByLabel('原文输入区')).toBeVisible();
}

test.describe('全流程', () => {
  test('输入 → 转换 → 预览 → 多音字确认 → 导出解锁 → BRF 下载', async ({ page }) => {
    await createDoc(page);
    const textarea = page.getByLabel('原文输入区');

    // 1. 输入含多音字的文本 → 预览与统计出现
    await textarea.fill('长大');
    await expect(page.getByLabel('盲文分页预览')).toBeVisible();
    await expect(page.getByText(/^\d+ 页 · \d+ 方$/)).toBeVisible();

    // 2. 多音字未确认 → 导出锁定
    await expect(page.getByText('导出已锁定')).toBeVisible();
    const exportBtn = page.getByRole('button', { name: '打印与导出 →' });
    await expect(exportBtn).toBeDisabled();

    // 3. 待确认面板列出候选（长、大）
    await expect(page.getByText(/项待确认/)).toBeVisible();

    // 4. 全部按默认读音确认 → 解锁
    await page.getByRole('button', { name: '全部按默认读音确认' }).click();
    await expect(page.getByText('没有待确认的读音。')).toBeVisible();
    await expect(exportBtn).toBeEnabled();

    // 5. 打印页：SVG 点阵渲染 + BRF 下载
    await exportBtn.click();
    await expect(page).toHaveURL(/\/print$/);
    await expect(page.locator('.print-page-wrap svg').first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '下载 BRF' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.brf$/);
    const content = fs.readFileSync(await download.path(), 'utf8');
    expect(content.endsWith('\f\n')).toBe(true);
    // 行宽不超过 32
    for (const line of content.replace(/\f\n$/, '').split('\n')) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
    await expect(page.getByText('BRF 已导出并通过结构校验。')).toBeVisible();
  });

  test('键盘流：Ctrl+Enter 转换并播报 + 焦点移动到预览', async ({ page }) => {
    await createDoc(page);
    const textarea = page.getByLabel('原文输入区');
    await textarea.fill('你好世界');
    await textarea.press('Control+Enter');
    // aria-live 播报
    await expect(page.locator('p[aria-live="polite"]')).toContainText('转换完成');
    // 焦点移到预览容器
    await expect(page.locator('.pages')).toBeFocused();
  });

  test('刷新持久化：文档内容与设置保留（IndexedDB / localStorage）', async ({ page }) => {
    await createDoc(page);
    const textarea = page.getByLabel('原文输入区');
    await textarea.fill('持久化测试内容。');
    await expect(page.getByText('已保存')).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByLabel('原文输入区')).toHaveValue(/持久化测试内容/, { timeout: 10_000 });
    await expect(page.getByText(/^\d+ 页 · \d+ 方$/)).toBeVisible();
  });

  test('逐方编辑：点击方 → 所选方显示字符 → 指定拼音', async ({ page }) => {
    await createDoc(page);
    const textarea = page.getByLabel('原文输入区');
    await textarea.fill('好');
    // 预览中第一个汉字方（声母 h）
    const firstCell = page.locator('.cell-btn[aria-label^="汉字"]').first();
    await firstCell.click();
    await expect(page.getByText(/字符「好」/)).toBeVisible();
    // 指定拼音并应用
    const input = page.getByPlaceholder('拼音（如 chang2），留空清除');
    await input.fill('hao3');
    await page.getByRole('button', { name: '应用' }).click();
    await expect(page.locator('p[aria-live="polite"]')).toContainText('已确认 好 读音为 hao3');
  });

  test('违规报告：超长词在编辑器显示警告', async ({ page }) => {
    await createDoc(page);
    const textarea = page.getByLabel('原文输入区');
    await textarea.fill('A'.repeat(40));
    await expect(page.getByRole('alert')).toContainText('超过行宽');
  });
});

test.describe('长文与滚动', () => {
  test('100+ 页长文转换与滚动到底（content-visibility 虚拟渲染）', async ({ page }) => {
    test.setTimeout(300_000);
    await createDoc(page);
    const sentence = '盲文排版是把文字转成凸点符号的过程，特殊教育学校需要大量点字教材。';
    const text = sentence.repeat(1250); // ≈ 41,000 字 → 远超 100 页
    const textarea = page.getByLabel('原文输入区');
    await textarea.fill(text);
    // 统计显示 >100 页
    await expect(page.getByText(/^[1-9]\d{2} 页 · \d+ 方$/)).toBeVisible({ timeout: 60_000 });
    // 滚动预览到底部，最后一页已渲染
    const pagesBox = page.locator('.pages');
    await pagesBox.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(pagesBox.locator('.page').last().getByText(/页 · /)).toBeVisible();
  });
});

test.describe('模板与词语表', () => {
  test('从模板新建文档并进入编辑器', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '从模板新建' }).click();
    await expect(page).toHaveURL(/\/library/);
    await page.locator('.template-card').first().getByRole('button', { name: '用此模板新建' }).click();
    await expect(page).toHaveURL(/\/editor\//);
    const textarea = page.getByLabel('原文输入区');
    await expect(textarea).not.toBeEmpty();
    await expect(page.getByLabel('盲文分页预览')).toBeVisible();
  });

  test('词语表添加自定义读音词条', async ({ page }) => {
    await page.goto('/library');
    await page.getByPlaceholder('如：长城').fill('长大');
    await page.getByPlaceholder('如：chang2 cheng2').fill('zhang3 da4');
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await expect(page.getByText('zhang3 da4')).toBeVisible();
    // 刷新后仍在（localStorage）
    await page.reload();
    await expect(page.getByText('zhang3 da4')).toBeVisible();
  });
});

test.describe('设置', () => {
  test('标调模式修改并持久化', async ({ page }) => {
    await page.goto('/settings');
    const select = page.getByLabel('标调模式');
    await expect(select).toBeVisible();
    await select.selectOption('all');
    await page.reload();
    await expect(page.getByLabel('标调模式')).toHaveValue('all');
  });
});
