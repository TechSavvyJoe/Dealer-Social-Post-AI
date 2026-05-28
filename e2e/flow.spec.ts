import { test, expect } from '@playwright/test';

test.describe('Dealer Social Post AI Flow', () => {
  test('should load the login page and handle invalid login', async ({ page }) => {
    await page.goto('/');

    // Check that we are on the Enter Dealer Code screen
    await expect(page.locator('text=Enter Dealer Code')).toBeVisible();

    // Try invalid login by tapping 9-9-9-9-9-9 on the security dialpad
    await page.getByRole('button', { name: '9' }).click();
    await page.getByRole('button', { name: '9' }).click();
    await page.getByRole('button', { name: '9' }).click();
    await page.getByRole('button', { name: '9' }).click();
    await page.getByRole('button', { name: '9' }).click();
    await page.getByRole('button', { name: '9' }).click();

    // Expect an error message "Dealer code not found." since 999999 is invalid
    await expect(page.locator('text=Dealer code not found.')).toBeVisible();
  });

  // Note: To test the full generation flow, we would need to mock the API or seed the database with a valid dealer.
  // Because the PocketBase instance might not be running or have predictable data in CI,
  // we will limit this basic E2E test to the login failure flow for now.
});
