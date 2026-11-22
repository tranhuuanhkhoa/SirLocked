import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './helpers/adminSession';

const activity = {
  onlineConnections: 4, onlineUsers: 3, activeRooms: 2, requests5m: 40, errorRate5m: 0.025,
  dau: 12, wau: 31, mau: 80,
  daily: Array.from({ length: 30 }, (_, index) => ({
    day: `2026-06-${String(index + 1).padStart(2, '0')}`,
    activeUsers: index === 29 ? 12 : 0,
    newUsers: index === 29 ? 3 : 0,
  })),
  retention: [{ cohortDay: '2026-06-01', cohortSize: 10, d1: 0.4, d7: 0.2 }],
};

async function stubDashboard(page: Page) {
  await page.route('**/api/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/dashboard') ? {}
      : path.endsWith('/users') ? []
        : path.endsWith('/metrics/activity') ? activity
          : path.endsWith('/metrics/revenue') ? {
            currency: 'VND', totalPaid: 125000, paidOrders: 5,
            daily: activity.daily.map((day, index) => ({
              day: day.day, amount: index === 29 ? 125000 : 0, orders: index === 29 ? 5 : 0,
            })),
          }
            : null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
}

test('dashboard shows activity cards, daily chart, retention, and economy revenue', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await signInAs(page, 'ADMIN');
  await stubDashboard(page);
  await page.goto('/admin');

  await expect(page.getByTestId('ops-metrics')).toBeVisible();
  await expect(page.getByText('Đang trực tuyến')).toBeVisible();
  await expect(page.getByText('DAU', { exact: true })).toBeVisible();
  await expect(page.locator('.adp-chart')).toHaveCount(2);
  await expect(page.getByText('Giữ chân người dùng')).toBeVisible();
  await expect(page.getByTestId('ops-revenue')).toBeVisible();
  await page.screenshot({ path: '/home/ubuntu/reports/ops/dashboard-super-admin-revenue.png', fullPage: true });
});

test('CONTENT admins see activity but not revenue', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await signInAs(page, 'ADMIN');
  await page.addInitScript(() => localStorage.setItem('sirlocked.user', JSON.stringify({
    userId: 'content-admin', fullName: 'Content Admin', role: 'ADMIN',
    adminRole: 'CONTENT', adminPermissions: ['content'], isEmailVerified: true,
  })));
  await stubDashboard(page);
  await page.goto('/admin');

  await expect(page.getByTestId('ops-metrics')).toBeVisible();
  await expect(page.getByTestId('ops-revenue')).toHaveCount(0);
  await page.screenshot({ path: '/home/ubuntu/reports/ops/dashboard-content-no-revenue.png', fullPage: true });
});
