import { expect, test } from '@playwright/test';

test.describe('authentication boundaries', () => {
    test('shows the Discord sign-in link and consent requirements on /login', async ({
        page,
    }) => {
        await page.goto('/login');

        await expect(
            page.getByRole('heading', { name: 'Backline' })
        ).toBeVisible();
        await expect(
            page.getByRole('link', { name: 'Login with Discord' })
        ).toHaveAttribute(
            'href',
            'http://localhost:3001/api/auth/discord/start'
        );
        await expect(
            page.getByText('By logging in, you agree to our terms of service')
        ).toBeVisible();
        await expect(
            page.getByRole('heading', { name: 'Analytics & Privacy' })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Accept' })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Decline' })
        ).toBeVisible();
    });

    test('redirects an anonymous server route to login after navigation and reload', async ({
        page,
    }) => {
        await page.goto('/servers');

        await expect(page).toHaveURL(/\/login$/);
        await expect(
            page.getByRole('link', { name: 'Login with Discord' })
        ).toBeVisible();

        await page.reload();

        await expect(page).toHaveURL(/\/login$/);
        await expect(
            page.getByRole('heading', { name: 'Backline' })
        ).toBeVisible();
    });
});

test.describe('landing page', () => {
    test('loads the published Backline title and hero heading', async ({
        page,
    }) => {
        await page.goto('/');

        await expect(page).toHaveTitle(
            'Backline — The tools behind your community'
        );
        await expect(
            page.getByRole('heading', {
                name: /KEEP YOUR\s+PEOPLE\s+TOGETHER\./,
            })
        ).toBeVisible();
    });
});
