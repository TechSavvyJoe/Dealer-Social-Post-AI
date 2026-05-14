import { test, expect } from '@playwright/test';

test.describe('Dealer Social Post AI Flow', () => {
  test('should load the login page and handle invalid login', async ({ page }) => {
    await page.goto('/');

    // Check that we are on the login page
    await expect(page.locator('text=Dealer Social Post AI').first()).toBeVisible();
    await expect(page.getByPlaceholder('Enter 4-digit dealer code')).toBeVisible();

    // Try invalid login
    await page.getByPlaceholder('Enter 4-digit dealer code').fill('9999');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Expect an error message (since 9999 is invalid)
    await expect(page.locator('text=Login failed')).toBeVisible();
  });

  // Note: To test the full generation flow, we would need to mock the API or seed the database with a valid dealer.
  // Because the PocketBase instance might not be running or have predictable data in CI,
  // we will limit this basic E2E test to the login failure flow for now.
});
