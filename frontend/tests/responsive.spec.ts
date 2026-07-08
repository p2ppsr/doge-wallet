import { expect, test } from '@playwright/test'

test('wallet shell is responsive and non-overflowing', async ({ page }) => {
  const errors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Doge Wallet' })).toBeVisible()
  await expect(page.getByText('Why? For the memes.')).toBeVisible()
  await expect(page.getByRole('button', { name: /connect doge wallet/i })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
})

