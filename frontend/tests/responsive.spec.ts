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

test('wide short viewport preserves the cover dog face', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wide-short', 'wide-short regression only')

  await page.goto('/')

  const heroImage = page.locator('.hero-image')
  const heroBand = page.locator('.hero-band')
  const [imageBox, bandBox] = await Promise.all([
    heroImage.boundingBox(),
    heroBand.boundingBox()
  ])

  expect(imageBox).not.toBeNull()
  expect(bandBox).not.toBeNull()
  expect(imageBox!.y).toBeGreaterThanOrEqual(bandBox!.y - 1)
  expect(imageBox!.height).toBeGreaterThan(0)
  expect(imageBox!.width / imageBox!.height).toBeCloseTo(1717 / 916, 1)
})

test('receive view keeps the QR large and removes technical facts', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('tab', { name: /receive/i }).click()

  await expect(page.locator('.fact-row')).toHaveCount(0)
  await expect(page.getByText('Protocol')).toHaveCount(0)

  const qrBox = await page.locator('.qr-shell').boundingBox()
  expect(qrBox).not.toBeNull()
  expect(qrBox!.width).toBeGreaterThanOrEqual(300)
  expect(qrBox!.height).toBeGreaterThanOrEqual(300)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
