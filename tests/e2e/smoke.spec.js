import { test, expect } from '@playwright/test';

test.describe('Smoke Test', () => {
    test('should load the page and show main canvas', async ({ page }) => {
        // Navigate to the local dev server
        await page.goto('/');

        // Check if the page title is correct (or at least the page loads)
        await expect(page).toHaveTitle(/THE HANGOUT/i);

        // Check if the Three.js canvas exists
        const canvas = page.locator('canvas');
        await expect(canvas).toBeVisible();
    });

    test('should show UI overlay', async ({ page }) => {
        await page.goto('/');

        // Check for a known UI element, e.g., the room name or a button
        const container = page.locator('#ui-overlay');
        await expect(container).toBeVisible();
    });
});
