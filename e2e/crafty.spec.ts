import { expect, test } from "./helpers/fixtures";

test.describe("Crafty Gerät - Verbindung", () => {
  test.beforeEach(async ({ page, bluetoothDevice }) => {
    await bluetoothDevice("CRAFTY");
    await page.goto("/");
  });

  test("sollte Verbindung zu Crafty-Gerät herstellen", async ({ page }) => {
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    // Nach erfolgreicher Verbindung sollte zur Crafty-View navigiert werden
    await page.waitForURL(/.*crafty.*/i, { timeout: 5000 });

    // Prüfe ob die Temperatur-Komponente sichtbar ist
    await expect(page.locator("text=/temperature/i").first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("sollte zur Crafty-Ansicht navigieren", async ({ page }) => {
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    // Prüfe ob die URL zur Crafty-View wechselt
    await page.waitForURL(/.*crafty.*/i, { timeout: 5000 });
  });

  test("sollte Temperatur anzeigen", async ({ page }) => {
    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();

    await page.waitForURL(/.*crafty.*/i, { timeout: 5000 });

    // Die gemockte Temperatur ist 180°C
    await expect(page.locator("text=/180/i").first()).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("Crafty Gerät - Steuerung", () => {
  test.beforeEach(async ({ page, bluetoothDevice }) => {
    await bluetoothDevice("CRAFTY");
    await page.goto("/");

    const connectButton = page.locator('button:has-text("Connect")').first();
    await connectButton.click();
    await page.waitForURL(/.*crafty.*/i, { timeout: 10000 });
  });

  test("sollte Heizungssteuerung anzeigen", async ({ page }) => {
    // Crafty zeigt "Crafty" Text und einen Button mit Fire-Icon
    await expect(page.locator("text=/crafty/i").first()).toBeVisible({
      timeout: 5000,
    });
    // Prüfe ob mindestens ein Button sichtbar ist (Heater Control)
    await expect(page.locator("button").first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Crafty on a compact French mobile screen", () => {
  test.use({
    viewport: { width: 360, height: 640 },
    locale: "fr-FR",
    isMobile: true,
    hasTouch: true,
  });

  test("shows heating and both boost buttons above the navigation without scrolling", async ({
    page,
    bluetoothDevice,
  }) => {
    await bluetoothDevice("CRAFTY");
    await page.goto("/");
    await page
      .getByRole("button", { name: /connecter/i })
      .first()
      .click();

    const heating = page.getByRole("button", { name: /^Chauffe/ });
    const boost = page.getByText("Puissance du boost", { exact: true });
    const boostCard = boost.locator("../..");
    const navigation = page.getByRole("navigation");
    await expect(heating).toBeVisible();
    await expect(boostCard.getByRole("button")).toHaveCount(2);
    const navTop = (await navigation.boundingBox())?.y ?? 0;
    for (const control of [heating, boostCard]) {
      const bounds = await control.boundingBox();
      expect(bounds?.y).toBeGreaterThanOrEqual(0);
      expect(bounds ? bounds.y + bounds.height : Infinity).toBeLessThan(navTop);
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});
