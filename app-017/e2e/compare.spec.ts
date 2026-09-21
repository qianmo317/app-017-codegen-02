/**
 * E2E：版本对比全流程。
 * 建两版稿子 → 按方比对（新加计数、页/行/方）→ 勾选搬到另一版 → 搬完自动重比确认剩余差异；
 * 整段移动不算改动；两篇无关稿子给出错位/对不上号警告。
 */
import { expect, test } from '@playwright/test';

async function makeDoc(page: import('@playwright/test').Page, title: string, raw: string) {
  await page.goto('/');
  await page.getByRole('button', { name: '＋ 新建盲文文档' }).click();
  await page.getByLabel('文档标题').fill(title);
  await page.getByLabel('原文输入区').fill(raw);
  await expect(page.getByText('已保存').first()).toBeVisible({ timeout: 10_000 });
}

async function openCompare(page: import('@playwright/test').Page, oldTitle: string, newTitle: string) {
  await page.goto('/compare');
  await page.getByLabel('选择旧版文档').selectOption({ label: oldTitle });
  await page.getByLabel('选择新版文档').selectOption({ label: newTitle });
}

test.describe('版本对比', () => {
  test('新增两处 → 勾选搬到旧版 → 自动重比归零', async ({ page }) => {
    await makeDoc(page, '对比旧版', '你好世界');
    await makeDoc(page, '对比新版', '你好美丽世界');
    await openCompare(page, '对比旧版', '对比新版');

    // 总览：新加 2、删除 0
    await expect(page.locator('.compare-summary .chip-added')).toContainText('新加 2');
    await expect(page.locator('.compare-summary .chip-removed')).toContainText('删除 0');

    // 改动清单给出页/行/方，并可筛选
    await expect(page.getByText(/第 1 页第 \d+ 行第 \d+ 方/).first()).toBeVisible();
    await page.getByRole('button', { name: '只看新加', pressed: false }).click();

    // 勾选全部可见（美、丽 两处）
    await page.getByRole('button', { name: '全选当前筛选' }).click();

    // 搬到旧版
    await page.getByRole('button', { name: /^把所选搬到旧版/ }).click();

    // 搬完自动重比：新加归零，并提示已重新对比
    await expect(page.getByText('已重新对比')).toBeVisible();
    await expect(page.locator('.compare-summary .chip-added')).toContainText('新加 0');
    await expect(page.locator('.compare-summary .chip-removed')).toContainText('删除 0');
    await expect(page.getByText(/内容相似度 100%/)).toBeVisible();

    // 旧版原文确实被改
    await page.goto('/');
    await page.getByText('对比旧版').click();
    await expect(page.getByLabel('原文输入区')).toHaveValue('你好美丽世界');
  });

  test('整段互换位置 → 报告位移，不算内容改动', async ({ page }) => {
    await makeDoc(page, '位移旧版', '第一段内容。\n\n第二段内容。');
    await makeDoc(page, '位移新版', '第二段内容。\n\n第一段内容。');
    await openCompare(page, '位移旧版', '位移新版');

    await expect(page.locator('.compare-summary .chip-added')).toContainText('新加 0');
    await expect(page.locator('.compare-summary .chip-removed')).toContainText('删除 0');
    await expect(page.getByText('结构位移（不算改动）：2 处')).toBeVisible();
  });

  test('一段拆成两段 → 报告拆分，零内容改动', async ({ page }) => {
    await makeDoc(page, '拆分旧版', '盲文是触觉文字，特殊教育学校常用。');
    await makeDoc(page, '拆分新版', '盲文是触觉文字，\n\n特殊教育学校常用。');
    await openCompare(page, '拆分旧版', '拆分新版');

    await expect(page.locator('.compare-summary .chip-added')).toContainText('新加 0');
    await expect(page.getByText('结构位移（不算改动）')).toBeVisible();
  });

  test('两篇无关稿子 → 错位/对不上号警告', async ({ page }) => {
    await makeDoc(page, '无关甲', '春天来了花儿开了大雁往南飞');
    await makeDoc(page, '无关乙', '今天午餐吃红烧肉和米饭汤');
    await openCompare(page, '无关甲', '无关乙');

    await expect(page.locator('.compare-warning.error')).toContainText(/对不上号|不是同一份稿子/);
  });
});
